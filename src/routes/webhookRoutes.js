import { Router } from 'express';
import crypto from 'node:crypto';
import { WhopAdapter } from '../services/payments/WhopAdapter.js';
import { CryptoAutoAdapter } from '../services/payments/CryptoAutoAdapter.js';
import { settleOrderAndGrantAccess, refundOrderAndRevokeAccess, generateOrderRef } from '../services/entitlementService.js';
import { registerUser } from '../services/authService.js';
import { config } from '../config.js';

const router = Router();

const WHOP_PAID_EVENTS = new Set([
  'payment.succeeded',
  'payment_succeeded',
  'membership.went_valid',
  'membership.activated',
  'membership_activated',
]);

const WHOP_REFUND_EVENTS = new Set([
  'payment.refunded',
  'refund.created',
  'membership.went_invalid',
  'membership.deactivated',
  'membership_deactivated',
]);

async function resolveWhopPackage(store, planId, packageSlugHint = '') {
  if (packageSlugHint) {
    const byHint = await store.getPackageBySlug(packageSlugHint);
    if (byHint) return byHint;
  }
  if (planId) {
    const byDbPlan = await store.getPackageByWhopPlanId(planId);
    if (byDbPlan) return byDbPlan;

    const matchedSlug = Object.entries(config.payments.whop.plans || {}).find(([, pid]) => pid === planId)?.[0];
    if (matchedSlug) {
      const byConfig = await store.getPackageBySlug(matchedSlug);
      if (byConfig) return byConfig;
    }

    if (planId === config.payments.whop.defaultPlanId) {
      return store.getPackageBySlug('starter-pass');
    }
  }
  return null;
}

/**
 * POST /api/v1/webhooks/whop
 * Supports both Standard Webhooks (webhook-id/timestamp/signature) and legacy x-whop-signature headers.
 */
router.post('/whop', async (req, res) => {
  const rawBody = req.rawBody;

  let payload;
  try {
    payload = Buffer.isBuffer(rawBody) ? JSON.parse(rawBody.toString('utf8')) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  const sigValid = WhopAdapter.verifyWebhookSignature(rawBody || JSON.stringify(payload), req.headers);
  const eventId = String(
    payload?.id || payload?.event_id || req.headers['webhook-id'] || `whop_${crypto.randomBytes(8).toString('hex')}`
  );
  const eventType = String(payload?.action || payload?.type || 'unknown');

  if (!sigValid) {
    const rejectKey = `invalid_${eventId}_${crypto.randomBytes(4).toString('hex')}`;
    await req.store.createWebhookEvent({
      provider: 'whop',
      eventId: rejectKey,
      eventType,
      signatureValid: false,
      payloadJson: JSON.stringify(payload),
      processed: false,
      errorMessage: 'Invalid Whop webhook signature',
    });
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // Atomic idempotency check (strictly after valid HMAC verification so invalid attempts cannot poison event_id)
  const record = await req.store.createWebhookEvent({
    provider: 'whop',
    eventId,
    eventType,
    signatureValid: true,
    payloadJson: JSON.stringify(payload),
    processed: false,
  });
  if (!record.created) {
    return res.json({ received: true, duplicate: true, processed: Boolean(record.event?.processed) });
  }

  try {
    const data = payload?.data || payload;
    const meta = data?.metadata || {};
    const orderRef = meta.orderRef || null;
    const paymentId = String(data?.payment_id || data?.payment?.id || data?.id || eventId);

    if (WHOP_PAID_EVENTS.has(eventType)) {
      if (orderRef) {
        await settleOrderAndGrantAccess(req.store, {
          orderRef,
          providerPaymentId: paymentId,
          metadata: { whop_event: eventType, whop_membership_id: data?.membership_id || data?.membership?.id || '' },
        });
      } else {
        // Direct Whop embed/link fallback (when checkout started without pre-locking an academy account)
        const buyerEmail = WhopAdapter.extractEmail(data);
        const planId = WhopAdapter.extractPlanId(data);
        const pkg = await resolveWhopPackage(req.store, planId, meta?.packageSlug || '');
        if (buyerEmail && pkg) {
          let user = await req.store.getUserByEmail(buyerEmail);
          if (!user) {
            const uid = await registerUser(req.store, {
              email: buyerEmail,
              password: `Whop${crypto.randomBytes(8).toString('hex')}!`,
              fullName: data?.user?.name || data?.user?.username || buyerEmail.split('@')[0],
            });
            user = await req.store.getUserById(uid);
          }
          const createdRef = generateOrderRef();
          await req.store.createOrder({
            orderRef: createdRef,
            userId: user.id,
            packageId: pkg.id,
            provider: 'whop',
            providerPaymentId: paymentId,
            grossCents: pkg.price_cents,
            finalCents: WhopAdapter.extractCents(data, pkg.price_cents),
            status: 'pending',
          });
          await settleOrderAndGrantAccess(req.store, { orderRef: createdRef, providerPaymentId: paymentId });
        }
      }
    } else if (WHOP_REFUND_EVENTS.has(eventType)) {
      const targetOrder = orderRef
        ? await req.store.getOrderByRef(orderRef)
        : await req.store.getOrderByPaymentId(paymentId);
      if (targetOrder) {
        await refundOrderAndRevokeAccess(req.store, { orderId: targetOrder.id, reason: `Whop event: ${eventType}` });
      }
    }

    await req.store.updateWebhookEvent(eventId, { processed: true });
    res.json({ received: true, processed: true });
  } catch (err) {
    await req.store.updateWebhookEvent(eventId, { errorMessage: err.message });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

router.post('/crypto', async (req, res) => {
  if (!config.payments.enableCryptoAuto) {
    return res.status(403).json({ error: 'Crypto webhooks are currently disabled.' });
  }
  const sigHeader = req.headers['x-nowpayments-sig'] || '';
  const payload = req.body || {};
  const sigValid = CryptoAutoAdapter.verifyIpnSignature(payload, sigHeader);
  const eventId = `crypto_${payload.payment_id || crypto.randomBytes(6).toString('hex')}_${payload.payment_status || 'init'}`;

  if (!sigValid) {
    const rejectKey = `invalid_${eventId}_${crypto.randomBytes(4).toString('hex')}`;
    await req.store.createWebhookEvent({
      provider: 'crypto_auto',
      eventId: rejectKey,
      eventType: String(payload.payment_status || 'ipn'),
      signatureValid: false,
      payloadJson: JSON.stringify(payload),
      processed: false,
      errorMessage: 'Invalid IPN signature',
    });
    return res.status(401).json({ error: 'Invalid IPN signature' });
  }

  const record = await req.store.createWebhookEvent({
    provider: 'crypto_auto',
    eventId,
    eventType: String(payload.payment_status || 'ipn'),
    signatureValid: true,
    payloadJson: JSON.stringify(payload),
    processed: false,
  });
  if (!record.created) return res.json({ received: true, duplicate: true });

  if (payload.payment_status === 'finished' || payload.payment_status === 'confirmed') {
    if (payload.order_id) {
      await settleOrderAndGrantAccess(req.store, {
        orderRef: payload.order_id,
        providerPaymentId: String(payload.payment_id || ''),
      });
    }
  }
  await req.store.updateWebhookEvent(eventId, { processed: true });
  res.json({ received: true });
});

export default router;
