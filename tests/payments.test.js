import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { config } from '../src/config.js';

function cookieHeader(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

function signWhopLegacy(rawBody, secret, timestamp = '1760000000') {
  const hex = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${hex}`;
}

function signStandardWebhook(rawBody, secret, msgId = 'msg_test_001', ts = Math.floor(Date.now() / 1000)) {
  const keyBytes = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const sigB64 = crypto.createHmac('sha256', keyBytes).update(`${msgId}.${ts}.${rawBody}`).digest('base64');
  return {
    'webhook-id': msgId,
    'webhook-timestamp': String(ts),
    'webhook-signature': `v1,${sigB64}`,
  };
}

test('VERNIER Whop Checkout & Firebase Config Suite', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vernier-pay-'));
  const dbPath = path.join(tmpDir, 'test-pay.sqlite');
  const prevSecret = config.payments.whop.webhookSecret;
  const standardSecret = `whsec_${Buffer.from('vernier_standard_webhook_secret_2026').toString('base64')}`;
  config.payments.whop.webhookSecret = standardSecret;

  const app = createApp({ dbPath });
  await app.locals.readyPromise;
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    config.payments.whop.webhookSecret = prevSecret;
    server.close();
    try {
      await app.locals.db.close();
    } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('non-Whop payment rails are disabled (403) while Whop checkout session initializes plan_CTX7xd3gUPsgD', async () => {
    for (const disabledRail of ['sandbox', 'crypto_manual', 'crypto_auto', 'local_pk']) {
      const blockedRes = await fetch(`${baseUrl}/api/v1/checkout/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageSlug: 'starter-pass',
          provider: disabledRail,
          email: `blocked-${disabledRail}@example.com`,
        }),
      });
      assert.equal(blockedRes.status, 403);
      const errBody = await blockedRes.json();
      assert.equal(errBody.code, 'PAYMENT_OPTION_DISABLED');
    }

    const sRes = await fetch(`${baseUrl}/api/v1/checkout/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageSlug: 'starter-pass',
        email: 'whopbuyer1@example.com',
        fullName: 'Daniel Park',
        password: 'BuyPassword!1',
      }),
    });
    assert.equal(sRes.status, 201);
    const cookie = cookieHeader(sRes);
    const { session } = await sRes.json();
    assert.equal(session.mode, 'whop_embed');
    assert.equal(session.planId, 'plan_CTX7xd3gUPsgD');
    assert.equal(session.metadata.orderRef, session.orderRef);

    // Complete payment via Standard Webhooks signature -> unlocks Tier 1 & applies upgrade credit
    const payload = JSON.stringify({
      id: 'evt_std_paid_001',
      type: 'payment.succeeded',
      data: { id: 'pay_std_001', metadata: { orderRef: session.orderRef } },
    });
    const stdHeaders = signStandardWebhook(payload, standardSecret, 'msg_std_001');
    const whRes = await fetch(`${baseUrl}/api/v1/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...stdHeaders },
      body: payload,
    });
    assert.equal(whRes.status, 200);

    const me = await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: cookie } })).json();
    assert.equal(me.user.max_tier_level, 1);

    // Quote Tier 2 ($25 - $1 credit = $24)
    const qRes = await fetch(`${baseUrl}/api/v1/checkout/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ packageSlug: 'price-action' }),
    });
    const { quote } = await qRes.json();
    assert.equal(quote.gross_cents, 2500);
    assert.equal(quote.upgrade_credit_cents, 100);
    assert.equal(quote.final_cents, 2400);

    // With FOUNDER20 (20% off $24 -> $19.20 = 1920 cents)
    const qCpnRes = await fetch(`${baseUrl}/api/v1/checkout/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ packageSlug: 'price-action', couponCode: 'FOUNDER20' }),
    });
    const qCpn = (await qCpnRes.json()).quote;
    assert.equal(qCpn.discount_cents, 480);
    assert.equal(qCpn.final_cents, 1920);
  });

  await t.test('100% TEST100 coupon unlocks Tier 2 & trade journal + admin overview works', async () => {
    const sRes = await fetch(`${baseUrl}/api/v1/checkout/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageSlug: 'price-action',
        provider: 'whop',
        couponCode: 'TEST100',
        email: 'scholar@example.com',
        fullName: 'Maya Lin',
      }),
    });
    assert.equal(sRes.status, 201);
    const studentCookie = cookieHeader(sRes);
    const { session } = await sRes.json();
    assert.equal(session.mode, 'instant_coupon');

    // Verify status endpoint & whop/complete endpoint agree order is paid
    const compRes = await fetch(`${baseUrl}/api/v1/checkout/whop/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: studentCookie },
      body: JSON.stringify({ orderRef: session.orderRef }),
    });
    assert.equal(compRes.status, 200);
    assert.equal((await compRes.json()).status, 'paid');

    // Trade Journal works at Tier 2
    const jCreate = await fetch(`${baseUrl}/api/v1/course/journal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: studentCookie },
      body: JSON.stringify({
        pair: 'BTCUSDT',
        direction: 'LONG',
        entryPrice: 64200,
        stopLoss: 62850,
        takeProfit: 68250,
        riskPct: 1,
        resultR: 3.0,
        setupTag: 'LIQ_SWEEP',
      }),
    });
    assert.equal(jCreate.status, 201);

    // Admin login & overview check
    const adminLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@vernier.academy', password: 'AdminVernier!2026' }),
    });
    assert.equal(adminLogin.status, 200);
    const adminCookie = cookieHeader(adminLogin);
    const ovRes = await fetch(`${baseUrl}/api/v1/admin/overview`, { headers: { Cookie: adminCookie } });
    assert.equal(ovRes.status, 200);
    const ov = await ovRes.json();
    assert.equal(ov.kpis.whopEnabled, true);
    assert.equal(ov.kpis.sandboxEnabled, false);
  });

  await t.test('Whop webhook rejects tampered signatures, supports idempotency, direct guest fallback, and revokes on refund', async () => {
    const reg = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'whopstudent@example.com', password: 'WhopPassword!1', fullName: 'Chloe Grant', country: 'US' }),
    });
    const userCookie = cookieHeader(reg);
    const me = await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: userCookie } })).json();
    const pkg = await app.locals.store.getPackageBySlug('pro-orderflow');
    const orderRef = 'ORD-WHOP-TEST-001';
    await app.locals.store.createOrder({
      orderRef,
      userId: me.user.id,
      packageId: pkg.id,
      provider: 'whop',
      grossCents: pkg.price_cents,
      finalCents: pkg.price_cents,
      status: 'pending',
    });

    const evtPayload = JSON.stringify({
      id: 'evt_whop_paid_001',
      action: 'payment.succeeded',
      data: { id: 'pay_whop_abc', metadata: { orderRef } },
    });

    // 1. Bad signature rejected 401
    const badRes = await fetch(`${baseUrl}/api/v1/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-whop-signature': 't=1,v1=deadbeef' },
      body: evtPayload,
    });
    assert.equal(badRes.status, 401);

    // 2. Valid legacy signature settles & unlocks Tier 3
    const validSig = signWhopLegacy(evtPayload, standardSecret);
    const okRes = await fetch(`${baseUrl}/api/v1/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-whop-signature': validSig },
      body: evtPayload,
    });
    assert.equal(okRes.status, 200);
    assert.equal((await okRes.json()).received, true);

    const afterPaid = await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: userCookie } })).json();
    assert.equal(afterPaid.user.max_tier_level, 3);

    // 3. Duplicate replay returns duplicate: true
    const dupRes = await fetch(`${baseUrl}/api/v1/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-whop-signature': validSig },
      body: evtPayload,
    });
    assert.equal(dupRes.status, 200);
    assert.equal((await dupRes.json()).duplicate, true);

    // 4. Direct Whop guest purchase fallback (no metadata.orderRef) with plan_CTX7xd3gUPsgD creates user + unlocks Tier 1
    const directPayload = JSON.stringify({
      id: 'evt_whop_direct_guest_001',
      type: 'payment.succeeded',
      data: {
        id: 'pay_direct_999',
        plan: { id: 'plan_CTX7xd3gUPsgD' },
        user: { email: 'directguest@example.com', name: 'Guest Trader' },
      },
    });
    const directHeaders = signStandardWebhook(directPayload, standardSecret, 'msg_direct_001');
    const directRes = await fetch(`${baseUrl}/api/v1/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...directHeaders },
      body: directPayload,
    });
    assert.equal(directRes.status, 200);
    const guestOrder = await app.locals.store.getOrderStatusDetails('pay_direct_999');
    assert.equal(guestOrder.status, 'paid');
    assert.equal(guestOrder.tier_level, 1);

    // Status endpoint also resolves by provider_payment_id
    const stRes = await fetch(`${baseUrl}/api/v1/checkout/orders/pay_direct_999/status`);
    assert.equal(stRes.status, 200);
    assert.equal((await stRes.json()).order.status, 'paid');

    // 5. Refund webhook revokes Tier 3 entitlement back to 0
    const refundBody = JSON.stringify({
      id: 'evt_whop_refund_001',
      action: 'payment.refunded',
      data: { id: 'pay_whop_abc', metadata: { orderRef } },
    });
    const refundSig = signWhopLegacy(refundBody, standardSecret);
    const refRes = await fetch(`${baseUrl}/api/v1/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-whop-signature': refundSig },
      body: refundBody,
    });
    assert.equal(refRes.status, 200);

    const afterRefund = await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: userCookie } })).json();
    assert.equal(afterRefund.user.max_tier_level, 0);
  });

  await t.test('Whop v1 (2026-11-11) ws_ literal webhook secret, customer_email, variant_id & refund.created work cleanly', async () => {
    const prevWsSecret = config.payments.whop.webhookSecret;
    const wsSecret = 'ws_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    config.payments.whop.webhookSecret = wsSecret;

    try {
      const signWhopV1 = (rawBody, msgId) => {
        const ts = String(Math.floor(Date.now() / 1000));
        const sigB64 = crypto
          .createHmac('sha256', Buffer.from(wsSecret, 'utf8'))
          .update(`${msgId}.${ts}.${rawBody}`)
          .digest('base64');
        return {
          'webhook-id': msgId,
          'webhook-timestamp': ts,
          'webhook-signature': `v1,${sigB64}`,
        };
      };

      const paidPayload = JSON.stringify({
        id: 'msg_v1_paid_001',
        type: 'payment.succeeded',
        data: {
          id: 'pay_v1_777',
          customer_email: 'whopv1buyer@example.com',
          variant_id: 'plan_CTX7xd3gUPsgD',
          total: { amount: '1.00', currency: 'usd', decimals: 2, display_decimals: 2 },
        },
      });
      const paidRes = await fetch(`${baseUrl}/api/v1/webhooks/whop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...signWhopV1(paidPayload, 'msg_v1_paid_001') },
        body: paidPayload,
      });
      assert.equal(paidRes.status, 200);

      const paidOrder = await app.locals.store.getOrderStatusDetails('pay_v1_777');
      assert.equal(paidOrder.status, 'paid');
      assert.equal(paidOrder.final_cents, 100);
      assert.equal(paidOrder.tier_level, 1);

      const buyerUser = await app.locals.store.getUserByEmail('whopv1buyer@example.com');
      const entBefore = await app.locals.store.getUserEntitlementSummary(buyerUser.id);
      assert.equal(entBefore.maxTier, 1);

      const refundPayload = JSON.stringify({
        id: 'msg_v1_refund_001',
        type: 'refund.created',
        data: {
          id: 'rf_v1_001',
          payment_id: 'pay_v1_777',
          status: 'succeeded',
        },
      });
      const refundRes = await fetch(`${baseUrl}/api/v1/webhooks/whop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...signWhopV1(refundPayload, 'msg_v1_refund_001') },
        body: refundPayload,
      });
      assert.equal(refundRes.status, 200);

      const refundedOrder = await app.locals.store.getOrderStatusDetails('pay_v1_777');
      assert.equal(refundedOrder.status, 'refunded');
      const entAfter = await app.locals.store.getUserEntitlementSummary(buyerUser.id);
      assert.equal(entAfter.maxTier, 0);
    } finally {
      config.payments.whop.webhookSecret = prevWsSecret;
    }
  });

  await t.test('Firebase config, Firestore indexes & deny-all client Security Rules cover all collections', async () => {
    const firebaseJson = JSON.parse(fs.readFileSync(path.join(config.rootDir, 'firebase.json'), 'utf8'));
    assert.equal(firebaseJson.firestore.rules, 'firestore.rules');
    assert.equal(firebaseJson.firestore.indexes, 'firestore.indexes.json');

    const indexesJson = JSON.parse(fs.readFileSync(path.join(config.rootDir, 'firestore.indexes.json'), 'utf8'));
    assert.ok(Array.isArray(indexesJson.indexes) && indexesJson.indexes.length >= 4);

    const rules = fs.readFileSync(path.join(config.rootDir, 'firestore.rules'), 'utf8');
    for (const colName of [
      '_meta',
      'users',
      'sessions',
      'password_resets',
      'packages',
      'modules',
      'lessons',
      'coupons',
      'orders',
      'enrollments',
      'lesson_progress',
      'trade_journal_entries',
      'certificates',
      'mentorship_audits',
      'webhook_events',
    ]) {
      assert.ok(rules.includes(`match /${colName}/`), `Missing collection rule for ${colName} in firestore.rules`);
    }
    assert.ok(!rules.includes('allow read, write: if true'), 'firestore.rules must never allow unrestricted public access');
  });
});
