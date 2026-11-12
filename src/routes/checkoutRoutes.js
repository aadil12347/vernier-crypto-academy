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

router.post('/quote', (req, res, next) => {
  try {
    const { packageSlug, couponCode } = req.body || {};
    const quote = calculateQuote(req.db, {
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
    const { packageSlug, provider = 'sandbox', couponCode = '', email, fullName, password, network } = req.body || {};

    let activeUser = req.user;
    if (!activeUser) {
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail) {
        return res.status(400).json({ error: 'Please enter your email address to create your course account.' });
      }
      const existing = req.db.prepare('SELECT id, email, full_name, role FROM users WHERE email = ?').get(cleanEmail);
      if (existing) {
        return res.status(401).json({
          error: 'An account with this email already exists. Please log in first so your upgrade credit applies cleanly.',
          code: 'ACCOUNT_EXISTS_LOGIN',
        });
      }
      const userId = registerUser(req.db, {
        email: cleanEmail,
        password: password || `Temp${Math.random().toString(36).slice(2, 10)}!9`,
        fullName: fullName || cleanEmail.split('@')[0],
      });
      const { rawToken } = createSession(req.db, userId);
      setSessionCookie(res, rawToken);
      activeUser = req.db.prepare('SELECT id, email, full_name, role FROM users WHERE id = ?').get(userId);
    }

    const adapter = adapters[provider];
    if (!adapter) {
      return res.status(400).json({ error: `Unsupported payment provider: ${provider}` });
    }

    const quote = calculateQuote(req.db, {
      packageSlug,
      userId: activeUser.id,
      couponCode,
    });

    const orderRef = generateOrderRef();
    req.db
      .prepare(`
        INSERT INTO orders (
          order_ref, user_id, package_id, provider, gross_cents,
          upgrade_credit_cents, discount_cents, final_cents, currency, coupon_code, status, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, 'pending', ?)
      `)
      .run(
        orderRef,
        activeUser.id,
        quote.package.id,
        provider,
        quote.gross_cents,
        quote.upgrade_credit_cents,
        quote.discount_cents,
        quote.final_cents,
        quote.coupon_code || '',
        JSON.stringify({ network: network || '', initiated_from: 'checkout_hub' })
      );

    const order = req.db.prepare('SELECT * FROM orders WHERE order_ref = ?').get(orderRef);

    // If 100% coupon made total $0.00, settle immediately regardless of rail!
    if (quote.final_cents === 0 && quote.coupon_code) {
      settleOrderAndGrantAccess(req.db, {
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
      network,
    });

    res.status(201).json({ session, quote });
  } catch (err) {
    next(err);
  }
});

router.post('/sandbox/confirm', checkoutLimiter, (req, res, next) => {
  try {
    if (!config.payments.allowSandbox) {
      return res.status(403).json({ error: 'Sandbox mode is disabled.' });
    }
    const { orderRef, outcome = 'approve', methodLabel = 'US Visa (Simulated)' } = req.body || {};
    const order = req.db.prepare('SELECT * FROM orders WHERE order_ref = ?').get(orderRef);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (order.provider !== 'sandbox') {
      return res.status(400).json({ error: 'Only sandbox orders can be confirmed via sandbox simulator.' });
    }
    if (req.user && req.user.id !== order.user_id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Order belongs to another user.' });
    }

    if (outcome === 'decline') {
      req.db.prepare("UPDATE orders SET status = 'failed', proof_text = ? WHERE id = ?").run(
        `Simulated card decline (${methodLabel})`,
        order.id
      );
      return res.status(402).json({
        error: 'Simulated decline: insufficient funds or bank block test triggered.',
        code: 'CARD_DECLINED',
        orderRef,
      });
    }

    if (outcome === 'refund') {
      const refunded = refundOrderAndRevokeAccess(req.db, {
        orderId: order.id,
        reason: 'Simulated sandbox refund test',
      });
      return res.json({ ok: true, order: refunded });
    }

    const settled = settleOrderAndGrantAccess(req.db, {
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

router.post('/orders/:ref/proof', (req, res) => {
  const { txId, senderNote = '' } = req.body || {};
  const order = req.db.prepare('SELECT * FROM orders WHERE order_ref = ?').get(req.params.ref);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (!txId || String(txId).trim().length < 6) {
    return res.status(400).json({ error: 'Please paste a valid Transaction Hash / Reference ID (min 6 characters).' });
  }
  const cleanProof = `${String(txId).trim()} | ${String(senderNote).trim()}`.slice(0, 300);
  req.db
    .prepare("UPDATE orders SET status = 'awaiting_review', proof_text = ? WHERE id = ?")
    .run(cleanProof, order.id);
  res.json({ ok: true, status: 'awaiting_review', orderRef: order.order_ref });
});

router.get('/orders/:ref/status', (req, res) => {
  const row = req.db
    .prepare(`
      SELECT o.order_ref, o.provider, o.gross_cents, o.upgrade_credit_cents, o.discount_cents,
             o.final_cents, o.currency, o.status, o.proof_text, o.created_at, o.paid_at,
             o.metadata_json, p.slug AS package_slug, p.name AS package_name, p.tier_level
      FROM orders o
      JOIN packages p ON p.id = o.package_id
      WHERE o.order_ref = ?
    `)
    .get(req.params.ref);

  if (!row) return res.status(404).json({ error: 'Order not found.' });

  const meta = JSON.parse(row.metadata_json || '{}');
  res.json({
    order: {
      ...row,
      metadata: meta,
      cryptoWallets: row.provider === 'crypto_manual' ? config.payments.cryptoWallets : undefined,
      localPkBank: row.provider === 'local_pk' ? config.payments.localPk : undefined,
      pkrAmount: Math.round((row.final_cents / 100) * config.payments.pkrUsdRate),
    },
  });
});

export default router;

