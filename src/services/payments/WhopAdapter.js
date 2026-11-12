import crypto from 'node:crypto';
import { PaymentAdapter } from './PaymentAdapter.js';
import { config } from '../../config.js';

export class WhopAdapter extends PaymentAdapter {
  constructor() {
    super('whop');
  }

  async createSession({ order, pkg, user }) {
    if (!config.payments.whopEnabled) {
      const err = new Error(
        'Whop live integration is queued for the final launch step (Phase 6). Use Developer Sandbox or Crypto TxID right now to test end-to-end.'
      );
      err.status = 400;
      err.code = 'WHOP_NOT_ENABLED_YET';
      throw err;
    }
    const planId = pkg.whop_plan_id || config.payments.whop.plans[pkg.slug];
    if (!planId || planId.includes('placeholder')) {
      const err = new Error(`Whop Plan ID missing for package ${pkg.slug}. Set it in .env or Admin Console.`);
      err.status = 400;
      throw err;
    }
    return {
      mode: 'whop_embed',
      orderRef: order.order_ref,
      planId,
      email: user.email,
      metadata: {
        orderRef: order.order_ref,
        userId: String(user.id),
        packageSlug: pkg.slug,
      },
      returnUrl: `${config.appUrl}/checkout/success?ref=${encodeURIComponent(order.order_ref)}`,
    };
  }

  /**
   * Verifies Whop HMAC-SHA256 webhook signature (supports raw hex or t=...,v1=... format).
   */
  static verifyWebhookSignature(rawBodyBuffer, signatureHeader, secretOverride = '') {
    const secret = secretOverride || config.payments.whop.webhookSecret;
    if (!secret || !signatureHeader || !rawBodyBuffer) return false;
    const rawStr = Buffer.isBuffer(rawBodyBuffer) ? rawBodyBuffer.toString('utf8') : String(rawBodyBuffer);
    const sig = String(signatureHeader).trim();

    let candidateHex = sig;
    let payloadToHash = rawStr;

    // Standard v1 signature scheme: "t=1700000000,v1=<hex>"
    if (sig.includes('v1=')) {
      const parts = Object.fromEntries(sig.split(',').map((p) => p.split('=')));
      if (parts.t && parts.v1) {
        candidateHex = parts.v1;
        payloadToHash = `${parts.t}.${rawStr}`;
      }
    }

    const expectedHex = crypto.createHmac('sha256', secret).update(payloadToHash).digest('hex');
    const expectedDirectHex = crypto.createHmac('sha256', secret).update(rawStr).digest('hex');

    const safeEq = (a, b) => {
      const ba = Buffer.from(a);
      const bb = Buffer.from(b);
      return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
    };

    return safeEq(expectedHex, candidateHex) || safeEq(expectedDirectHex, candidateHex);
  }
}

