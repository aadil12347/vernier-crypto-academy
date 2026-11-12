import crypto from 'node:crypto';
import { Router } from 'express';
import {
  calculateQuote,
  generateOrderRef,
  settleOrderAndGrantAccess,
  refundOrderAndRevokeAccess,
} from '../services/entitlementService.js';
import { registerUser, createSession } from '../services/authService.js';
import { setSessionCookie } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { SandboxAdapter } from '../services/payments/SandboxAdapter.js';
import { CryptoManualAdapter } from '../services/payments/CryptoManualAdapter.js';
import { CryptoAutoAdapter } from '../services/payments/CryptoAutoAdapter.js';
import { LocalPkAdapter } from '../services/payments/LocalPkAdapter.js';
import { WhopAdapter } from '../services/payments/WhopAdapter.js';
import { config } from '../config.js';

const router = Router();
const checkoutLimiter = createRateLimiter({ windowMs: 60_000, max: 40, keyPrefix: 'checkout' });

const adapters = {
  sandbox: new SandboxAdapter(),
  crypto_manual: new CryptoManualAdapter(),
  crypto_auto: new CryptoAutoAdapter(),
  local_pk: new LocalPkAdapter(),
  whop: new WhopAdapter(),
};

function isProviderActive(provider) {
  if (provider === 'whop') return Boolean(config.payments.whopEnabled);
  if (provider === 'sandbox') return Boolean(config.payments.allowSandbox);
  if (provider === 'crypto_manual') return Boolean(config.payments.enableCryptoManual);
  if (provider === 'crypto_auto') return Boolean(config.payments.enableCryptoAuto);
  if (provider === 'local_pk') return Boolean(config.payments.enableLocalPk);
  return false;
}

router.post('/quote', async (req, res, next) => {
  try {
    const { packageSlug, couponCode } = req.body || {};
    const quote = await calculateQuote(req.store, {
      packageSlug,
      userId: req.user?.id || null,
      couponCode,
    });
    res.json({ quote });
  } catch (err) {
    next(err);
  }
});

router.post('/session', checkoutLimiter, async (req, res, next) => {
  try {
    const { packageSlug, provider = 'whop', couponCode = '', email, fullName, password, network } = req.body || {};

    const adapter = adapters[provider];
    if (!adapter) {
      return res.status(400).json({ error: `Unsupported payment provider: ${provider}` });
    }
    if (!isProviderActive(provider)) {
      return res.status(403).json({
        error: 'Only Whop Checkout is active at this time. Other payment options will be enabled after testing.',
        code: 'PAYMENT_OPTION_DISABLED',
      });
    }

    let activeUser = req.user;
    if (!activeUser) {
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail) {
        return res.status(400).json({ error: 'Please enter your email address to create your course account.' });
      }
      const existing = await req.store.getUserByEmail(cleanEmail);
      if (existing) {
        return res.status(401).json({
          error: 'An account with this email already exists. Please log in first so your upgrade credit applies cleanly.',
          code: 'ACCOUNT_EXISTS_LOGIN',
        });
      }
      const userId = await registerUser(req.store, {
        email: cleanEmail,
        password: password || `Temp${crypto.randomBytes(6).toString('hex')}!9`,
        fullName: fullName || cleanEmail.split('@')[0],
      });
      const { rawToken } = await createSession(req.store, userId);
      setSessionCookie(res, rawToken);
      activeUser = await req.store.getPublicUserById(userId);
    }

    const quote = await calculateQuote(req.store, {
      packageSlug,
      userId: activeUser.id,
      couponCode,
    });

    const orderRef = generateOrderRef();
    const order = await req.store.createOrder({
      orderRef,
      userId: activeUser.id,
      packageId: quote.package.id,
      provider,
      grossCents: quote.gross_cents,
      upgradeCreditCents: quote.upgrade_credit_cents,
      discountCents: quote.discount_cents,
      finalCents: quote.final_cents,
      couponCode: quote.coupon_code || '',
      status: 'pending',
      metadataJson: JSON.stringify({ network: network || '', initiated_from: 'whop_checkout' }),
    });

    // If 100% coupon made total $0.00, settle immediately
    if (quote.final_cents === 0 && quote.coupon_code) {
      await settleOrderAndGrantAccess(req.store, {
        orderRef,
        providerPaymentId: `COUPON-${quote.coupon_code}`,
        metadata: { settled_via: '100pct_coupon' },
      });
      return res.status(201).json({
        session: {
          mode: 'instant_coupon',
          orderRef,
          redirectUrl: `/checkout/success?ref=${encodeURIComponent(orderRef)}`,
        },
        quote,
      });
    }

    const session = await adapter.createSession({
      order,
      pkg: quote.package,
      user: activeUser,
      couponCode: quote.coupon_code || '',
      network,
    });

    res.status(201).json({ session, quote });
  } catch (err) {
    next(err);
  }
});

router.post('/whop/complete', checkoutLimiter, async (req, res, next) => {
  try {
    const {
      orderRef: reqOrderRef = '',
      paymentId: reqPaymentId = '',
      sessionId = '',
      packageSlug = 'starter-pass',
      email = '',
      fullName = '',
    } = req.body || {};

    let order = null;
    if (reqOrderRef) {
      order = await req.store.getOrderByRef(reqOrderRef);
    }
    if (!order && reqPaymentId) {
      order = await req.store.getOrderByPaymentId(reqPaymentId);
    }

    if (order && order.status === 'paid') {
      if (!req.user) {
        const { rawToken } = await createSession(req.store, order.user_id);
        setSessionCookie(res, rawToken);
      }
      return res.json({
        ok: true,
        status: 'paid',
        order,
        redirectUrl: `/checkout/success?ref=${encodeURIComponent(order.order_ref)}`,
      });
    }

    if (reqPaymentId && config.payments.whop.apiKey) {
      const payment = await WhopAdapter.fetchPayment(String(reqPaymentId).trim());
      const paymentStatus = String(payment?.status || '').toLowerCase();
      const paymentSubstatus = String(payment?.substatus || '').toLowerCase();
      const isPaid = paymentStatus === 'paid' || paymentStatus === 'succeeded' || paymentSubstatus === 'succeeded';

      if (isPaid) {
        const meta = payment?.metadata || {};
        let resolvedRef = order?.order_ref || String(meta.orderRef || reqOrderRef || '').trim();
        let targetUserId = order?.user_id || req.user?.id || null;

        if (!resolvedRef) {
          const buyerEmail = WhopAdapter.extractEmail(payment, email);
          if (buyerEmail) {
            let user = await req.store.getUserByEmail(buyerEmail);
            if (!user) {
              const uid = await registerUser(req.store, {
                email: buyerEmail,
                password: `Whop${crypto.randomBytes(8).toString('hex')}!`,
                fullName: String(payment?.user?.name || payment?.user?.username || fullName || buyerEmail.split('@')[0]),
              });
              user = await req.store.getPublicUserById(uid);
            }
            targetUserId = user.id;
          }

          if (targetUserId) {
            const planId = WhopAdapter.extractPlanId(payment);
            let pkg = planId ? await req.store.getPackageByWhopPlanId(planId) : null;
            if (!pkg) {
              pkg = await req.store.getPackageBySlug(meta.packageSlug || packageSlug || 'starter-pass');
            }
            if (pkg) {
              resolvedRef = generateOrderRef();
              const paidCents = WhopAdapter.extractCents(payment, pkg.price_cents);
              await req.store.createOrder({
                orderRef: resolvedRef,
                userId: targetUserId,
                packageId: pkg.id,
                provider: 'whop',
                providerPaymentId: String(payment.id || reqPaymentId),
                grossCents: pkg.price_cents,
                finalCents: paidCents,
                status: 'pending',
                metadataJson: JSON.stringify({ sessionId, verified_via: 'whop_api_v1', planId }),
              });
            }
          }
        }

        if (resolvedRef) {
          const settled = await settleOrderAndGrantAccess(req.store, {
            orderRef: resolvedRef,
            providerPaymentId: String(payment.id || reqPaymentId),
            metadata: { sessionId, completed_via: 'whop_complete_api' },
          });
          if (!req.user && settled?.order?.user_id) {
            const { rawToken } = await createSession(req.store, settled.order.user_id);
            setSessionCookie(res, rawToken);
          }
          return res.json({
            ok: true,
            status: 'paid',
            order: settled.order,
            redirectUrl: `/checkout/success?ref=${encodeURIComponent(resolvedRef)}`,
          });
        }
      }
    }

    if (order && reqPaymentId && !order.provider_payment_id) {
      const existingMeta = JSON.parse(order.metadata_json || '{}');
      await req.store.updateOrderPaymentMeta(order.id, {
        providerPaymentId: String(reqPaymentId).trim(),
        metadataJson: JSON.stringify({ ...existingMeta, sessionId }),
      });
    }

    const fallbackRef = order?.order_ref || reqOrderRef || reqPaymentId || '';
    res.json({
      ok: true,
      status: order?.status || 'pending',
      awaitingWebhook: true,
      orderRef: order?.order_ref || null,
      redirectUrl: fallbackRef
        ? `/checkout/success?ref=${encodeURIComponent(fallbackRef)}`
        : '/checkout/success',
    });
  } catch (err) {
    next(err);
  }
});

router.post('/sandbox/confirm', checkoutLimiter, async (req, res, next) => {
  try {
    if (!config.payments.allowSandbox) {
      return res.status(403).json({ error: 'Sandbox mode is disabled. Whop Checkout is the sole active option.' });
    }
    const { orderRef, outcome = 'approve', methodLabel = 'US Visa (Simulated)' } = req.body || {};
    const order = await req.store.getOrderByRef(orderRef);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (order.provider !== 'sandbox') {
      return res.status(400).json({ error: 'Only sandbox orders can be confirmed via sandbox simulator.' });
    }
    if (req.user && req.user.id !== order.user_id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Order belongs to another user.' });
    }

    if (outcome === 'decline') {
      await req.store.markOrderDeclined(order.id, `Simulated card decline (${methodLabel})`);
      return res.status(402).json({
        error: 'Simulated decline: insufficient funds or bank block test triggered.',
        code: 'CARD_DECLINED',
        orderRef,
      });
    }

    if (outcome === 'refund') {
      const refunded = await refundOrderAndRevokeAccess(req.store, {
        orderId: order.id,
        reason: 'Simulated sandbox refund test',
      });
      return res.json({ ok: true, order: refunded });
    }

    const settled = await settleOrderAndGrantAccess(req.store, {
      orderRef,
      providerPaymentId: `SBX-${Date.now()}`,
      metadata: { simulated_method: methodLabel },
    });

    res.json({
      ok: true,
      order: settled.order,
      redirectUrl: `/checkout/success?ref=${encodeURIComponent(orderRef)}`,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/:ref/proof', async (req, res) => {
  if (!config.payments.enableCryptoManual && !config.payments.enableLocalPk) {
    return res.status(403).json({ error: 'Manual payment proof submission is currently disabled.' });
  }
  const { txId, senderNote = '' } = req.body || {};
  const order = await req.store.getOrderByRef(req.params.ref);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (!txId || String(txId).trim().length < 6) {
    return res.status(400).json({ error: 'Please paste a valid Transaction Hash / Reference ID (min 6 characters).' });
  }
  const cleanProof = `${String(txId).trim()} | ${String(senderNote).trim()}`.slice(0, 300);
  await req.store.markOrderAwaitingReview(order.id, cleanProof);
  res.json({ ok: true, status: 'awaiting_review', orderRef: order.order_ref });
});

router.get('/orders/:ref/status', async (req, res) => {
  const row = await req.store.getOrderStatusDetails(req.params.ref);
  if (!row) return res.status(404).json({ error: 'Order not found.' });

  const meta = JSON.parse(row.metadata_json || '{}');
  res.json({
    order: {
      ...row,
      metadata: meta,
      cryptoWallets: row.provider === 'crypto_manual' ? config.payments.cryptoWallets : undefined,
      localPkBank: row.provider === 'local_pk' ? config.payments.localPk : undefined,
    },
  });
});

export default router;
