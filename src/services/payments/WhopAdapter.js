import crypto from 'node:crypto';
import { PaymentAdapter } from './PaymentAdapter.js';
import { config } from '../../config.js';
import { resolveWhopPlanId } from '../entitlementService.js';

export class WhopAdapter extends PaymentAdapter {
  constructor() {
    super('whop');
  }

  async createSession({ order, pkg, user, couponCode = '' }) {
    if (!config.payments.whopEnabled) {
      const err = new Error('Whop Checkout is currently disabled.');
      err.status = 403;
      err.code = 'WHOP_DISABLED';
      throw err;
    }
    const planId = resolveWhopPlanId(pkg);
    if (!planId) {
      const err = new Error(`Whop Plan ID missing for package ${pkg.slug}. Set WHOP_PLAN_* or WHOP_DEFAULT_PLAN_ID in .env.`);
      err.status = 400;
      throw err;
    }
    return {
      mode: 'whop_embed',
      orderRef: order.order_ref,
      planId,
      email: user.email,
      promoCode: couponCode ? String(couponCode).trim().toUpperCase() : undefined,
      metadata: {
        orderRef: order.order_ref,
        userId: String(user.id),
        packageSlug: pkg.slug,
      },
      returnUrl: `${config.appUrl}/checkout/success?ref=${encodeURIComponent(order.order_ref)}`,
    };
  }

  /**
   * Verifies Whop webhook signatures across both Standard Webhooks (webhook-id / webhook-timestamp / webhook-signature)
   * and legacy x-whop-signature / whop-signature headers.
   */
  static verifyWebhookSignature(rawBodyBuffer, headersOrSig, secretOverride = '') {
    const secret = secretOverride || config.payments.whop.webhookSecret;
    if (!secret || !headersOrSig || !rawBodyBuffer) return false;

    const rawStr = Buffer.isBuffer(rawBodyBuffer) ? rawBodyBuffer.toString('utf8') : String(rawBodyBuffer);

    const safeEqBuf = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

    // 1. Standard Webhooks specification (webhook-id + webhook-timestamp + webhook-signature: v1,<base64>)
    if (typeof headersOrSig === 'object' && !Array.isArray(headersOrSig)) {
      const whId = headersOrSig['webhook-id'];
      const whTs = headersOrSig['webhook-timestamp'];
      const whSig = headersOrSig['webhook-signature'];

      if (whId && whTs && whSig) {
        const tsNum = Number(whTs);
        if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
          return false;
        }
        const secretStr = String(secret);
        // Whop v1 (`ws_...`) HMACs with literal UTF-8 bytes of the secret; legacy Standard Webhooks (`whsec_...`) base64-decodes.
        const candidateKeys = secretStr.startsWith('ws_')
          ? [Buffer.from(secretStr, 'utf8')]
          : [Buffer.from(secretStr.replace(/^whsec_/, ''), 'base64'), Buffer.from(secretStr, 'utf8')];

        const expectedDigests = candidateKeys.map((keyBytes) =>
          crypto.createHmac('sha256', keyBytes).update(`${whId}.${whTs}.`).update(rawBodyBuffer).digest()
        );

        return String(whSig)
          .split(/\s+/)
          .some((part) => {
            const [ver, sigB64] = part.split(',');
            if (ver !== 'v1' || !sigB64) return false;
            const got = Buffer.from(sigB64, 'base64');
            return expectedDigests.some((expected) => safeEqBuf(got, expected));
          });
      }
    }

    // 2. Legacy Whop HMAC header (x-whop-signature: t=...,v1=<hex> or direct hex)
    const sigHeader =
      typeof headersOrSig === 'string'
        ? headersOrSig
        : headersOrSig['x-whop-signature'] || headersOrSig['whop-signature'] || '';

    const sig = String(sigHeader).trim();
    if (!sig) return false;

    let candidateHex = sig;
    let payloadToHash = rawStr;
    if (sig.includes('v1=')) {
      const parts = Object.fromEntries(sig.split(',').map((p) => p.split('=')));
      if (parts.t && parts.v1) {
        candidateHex = parts.v1;
        payloadToHash = `${parts.t}.${rawStr}`;
      }
    }

    const expectedHex = crypto.createHmac('sha256', secret).update(payloadToHash).digest('hex');
    const expectedDirectHex = crypto.createHmac('sha256', secret).update(rawStr).digest('hex');

    return (
      safeEqBuf(Buffer.from(expectedHex), Buffer.from(candidateHex)) ||
      safeEqBuf(Buffer.from(expectedDirectHex), Buffer.from(candidateHex))
    );
  }

  /**
   * Normalizes Whop payment buyer email across v1 (`customer_email`) and legacy payloads.
   */
  static extractEmail(data, fallback = '') {
    return String(data?.customer_email || data?.user?.email || data?.email || fallback || '')
      .trim()
      .toLowerCase();
  }

  /**
   * Normalizes Whop plan ID (`plan_...`) across v1 (`variant_id`), webhook, and line-item payloads.
   */
  static extractPlanId(data) {
    return String(
      data?.plan?.id || data?.plan_id || data?.variant_id || data?.line_items?.[0]?.plan_id || ''
    ).trim();
  }

  /**
   * Extracts minor cents from Whop v1 Money objects (`{ amount: "1.00", decimals: 2 }`) or legacy integer cents.
   */
  static extractCents(data, fallbackCents = 0) {
    for (const candidate of [data?.total, data?.usd_total, data?.subtotal]) {
      if (candidate && typeof candidate === 'object' && candidate.amount !== undefined) {
        const parsed = Number(candidate.amount);
        if (Number.isFinite(parsed) && parsed > 0) {
          const factor = Math.pow(10, Number.isInteger(candidate.decimals) ? candidate.decimals : 2);
          return Math.round(parsed * factor);
        }
      }
    }
    const legacy = Number(data?.final_amount ?? data?.subtotal);
    if (Number.isFinite(legacy) && legacy > 0) {
      return Math.round(legacy);
    }
    return Number(fallbackCents || 0);
  }

  /**
   * Fetches a live payment record directly from Whop API v1 when WHOP_API_KEY is configured.
   */
  static async fetchPayment(paymentId) {
    const apiKey = config.payments.whop.apiKey;
    if (!apiKey) return null;
    const res = await fetch(`https://api.whop.com/api/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Whop API payment lookup failed (${res.status}): ${text || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
}
