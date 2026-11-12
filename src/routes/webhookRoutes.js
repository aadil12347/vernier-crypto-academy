import { Router } from 'express';
import crypto from 'node:crypto';
import { WhopAdapter } from '../services/payments/WhopAdapter.js';
import { CryptoAutoAdapter } from '../services/payments/CryptoAutoAdapter.js';
import { settleOrderAndGrantAccess, refundOrderAndRevokeAccess, generateOrderRef } from '../services/entitlementService.js';
import { registerUser } from '../services/authService.js';

const router = Router();

/**
 * POST /api/v1/webhooks/whop
 * Activated in Phase 6 (also fully unit-testable right now with WHOP_WEBHOOK_SECRET).
 */
router.post('/whop', (req, res) => {
  const sigHeader = req.headers['x-whop-signature'] || req.headers['whop-signature'] || '';
  const rawBody = req.rawBody;

  let payload;
  try {
    payload = Buffer.isBuffer(rawBody) ? JSON.parse(rawBody.toString('utf8')) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  const sigValid = WhopAdapter.verifyWebhookSignature(rawBody || JSON.stringify(payload), sigHeader);
  const eventId = String(payload?.id || payload?.event_id || `whop_${crypto.randomBytes(8).toString('hex')}`);
  const eventType = String(payload?.action || payload?.type || 'unknown');

  if (!sigValid) {
    const rejectKey = `invalid_${eventId}_${crypto.randomBytes(4).toString('hex')}`;
    req.db
      .prepare(`
        INSERT INTO webhook_events (provider, event_id, event_type, signature_valid, payload_json, processed, error_message)
        VALUES ('whop', ?, ?, 0, ?, 0, 'Invalid Whop HMAC signature')
      `)
      .run(rejectKey, eventType, JSON.stringify(payload));
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // Idempotency check (strictly after valid HMAC verification so invalid attempts cannot poison event_id)
  const existing = req.db.prepare('SELECT id, processed FROM webhook_events WHERE event_id = ?').get(eventId);
  if (existing) {
    return res.json({ received: true, duplicate: true, processed: Boolean(existing.processed) });
  }

  req.db
    .prepare(`
      INSERT INTO webhook_events (provider, event_id, event_type, signature_valid, payload_json, processed)
      VALUES ('whop', ?, ?, 1, ?, 0)
    `)
    .run(eventId, eventType, JSON.stringify(payload));

  try {
    const data = payload?.data || payload;
    const meta = data?.metadata || {};
    const orderRef = meta.orderRef || null;
    const paymentId = String(data?.id || data?.payment_id || eventId);

    if (eventType === 'payment.succeeded' || eventType === 'membership.went_valid') {
      if (orderRef) {
        settleOrderAndGrantAccess(req.db, {
          orderRef,
          providerPaymentId: paymentId,
          metadata: { whop_event: eventType, whop_membership_id: data?.membership_id || '' },
        });
      } else if (data?.user?.email && (data?.plan?.id || data?.plan_id)) {
        // Direct Whop link fallback (if someone bought directly on whop.com without starting at /checkout)
        const planId = String(data?.plan?.id || data?.plan_id);
        const pkg = req.db.prepare('SELECT * FROM packages WHERE whop_plan_id = ?').get(planId);
        if (pkg) {
          let user = req.db.prepare('SELECT * FROM users WHERE email = ?').get(data.user.email.toLowerCase());
          if (!user) {
            const uid = registerUser(req.db, {
              email: data.user.email,
              password: `Whop${crypto.randomBytes(8).toString('hex')}!`,
              fullName: data.user.username || data.user.email.split('@')[0],
            });
            user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
          }
          const createdRef = generateOrderRef();
          req.db
            .prepare(`
              INSERT INTO orders (order_ref, user_id, package_id, provider, provider_payment_id, gross_cents, final_cents, status)
              VALUES (?, ?, ?, 'whop', ?, ?, ?, 'pending')
            `)
            .run(createdRef, user.id, pkg.id, paymentId, pkg.price_cents, pkg.price_cents);
          settleOrderAndGrantAccess(req.db, { orderRef: createdRef, providerPaymentId: paymentId });
        }
      }
    } else if (eventType === 'payment.refunded' || eventType === 'membership.went_invalid') {
      const targetOrder = orderRef
        ? req.db.prepare('SELECT id FROM orders WHERE order_ref = ?').get(orderRef)
        : req.db.prepare('SELECT id FROM orders WHERE provider_payment_id = ?').get(paymentId);
      if (targetOrder) {
        refundOrderAndRevokeAccess(req.db, { orderId: targetOrder.id, reason: `Whop event: ${eventType}` });
      }
    }

    req.db.prepare('UPDATE webhook_events SET processed = 1 WHERE event_id = ?').run(eventId);
    res.json({ received: true, processed: true });
  } catch (err) {
    req.db.prepare('UPDATE webhook_events SET error_message = ? WHERE event_id = ?').run(err.message, eventId);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

router.post('/crypto', (req, res) => {
  const sigHeader = req.headers['x-nowpayments-sig'] || '';
  const payload = req.body || {};
  const sigValid = CryptoAutoAdapter.verifyIpnSignature(payload, sigHeader);
  const eventId = `crypto_${payload.payment_id || crypto.randomBytes(6).toString('hex')}_${payload.payment_status || 'init'}`;

  if (!sigValid) {
    const rejectKey = `invalid_${eventId}_${crypto.randomBytes(4).toString('hex')}`;
    req.db
      .prepare(`
        INSERT INTO webhook_events (provider, event_id, event_type, signature_valid, payload_json, processed, error_message)
        VALUES ('crypto_auto', ?, ?, 0, ?, 0, 'Invalid IPN signature')
      `)
      .run(rejectKey, String(payload.payment_status || 'ipn'), JSON.stringify(payload));
    return res.status(401).json({ error: 'Invalid IPN signature' });
  }

  const existing = req.db.prepare('SELECT id FROM webhook_events WHERE event_id = ?').get(eventId);
  if (existing) return res.json({ received: true, duplicate: true });

  req.db
    .prepare(`
      INSERT INTO webhook_events (provider, event_id, event_type, signature_valid, payload_json, processed)
      VALUES ('crypto_auto', ?, ?, 1, ?, 0)
    `)
    .run(eventId, String(payload.payment_status || 'ipn'), JSON.stringify(payload));

  if (payload.payment_status === 'finished' || payload.payment_status === 'confirmed') {
    if (payload.order_id) {
      settleOrderAndGrantAccess(req.db, {
        orderRef: payload.order_id,
        providerPaymentId: String(payload.payment_id || ''),
      });
    }
  }
  req.db.prepare('UPDATE webhook_events SET processed = 1 WHERE event_id = ?').run(eventId);
  res.json({ received: true });
});

export default router;
