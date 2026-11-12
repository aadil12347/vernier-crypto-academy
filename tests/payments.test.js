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

function signWhop(rawBody, secret, timestamp = '1760000000') {
  const hex = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${hex}`;
}

test('VERNIER Payment Rails: Upgrade Credits, Coupons, Sandbox, Crypto TxID Approval & Whop HMAC Webhooks', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vernier-pay-'));
  const dbPath = path.join(tmpDir, 'test-pay.sqlite');
  const prevSecret = config.payments.whop.webhookSecret;
  config.payments.whop.webhookSecret = 'whsec_test_secret_vernier_2026';

  const app = createApp({ dbPath });
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    config.payments.whop.webhookSecret = prevSecret;
    server.close();
    try { app.locals.db.close(); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('sandbox $1 settlement -> Tier 2 upgrade credit ($25 - $1 = $24) + FOUNDER20 coupon', async () => {
    // 1. Checkout $1 as fresh student
    const sRes = await fetch(`${baseUrl}/api/v1/checkout/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageSlug: 'starter-pass',
        provider: 'sandbox',
        email: 'buyer1@example.com',
        fullName: 'Daniel Park',
        password: 'BuyPassword!1',
      }),
    });
    assert.equal(sRes.status, 201);
    const cookie = cookieHeader(sRes);
    const { session } = await sRes.json();

    // 2. Confirm sandbox payment
    const cRes = await fetch(`${baseUrl}/api/v1/checkout/sandbox/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ orderRef: session.orderRef, outcome: 'approve' }),
    });
    assert.equal(cRes.status, 200);

    // 3. Verify Tier 1 active & Upgrade quote for Tier 2 ($25 - $1 credit = $24)
    const me = await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: cookie } })).json();
    assert.equal(me.user.max_tier_level, 1);

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

  await t.test('crypto manual TxID submission -> admin approve grants Tier 2 -> journal works', async () => {
    const sRes = await fetch(`${baseUrl}/api/v1/checkout/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageSlug: 'price-action',
        provider: 'crypto_manual',
        network: 'USDT_TRC20',
        email: 'cryptobuyer@example.com',
        fullName: 'Maya Lin',
      }),
    });
    assert.equal(sRes.status, 201);
    const studentCookie = cookieHeader(sRes);
    const { session } = await sRes.json();

    // Submit TxID proof
    const pRes = await fetch(`${baseUrl}/api/v1/checkout/orders/${session.orderRef}/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txId: 'TX9988776655TRC20', senderNote: 'Binance spot withdraw' }),
    });
    assert.equal(pRes.status, 200);
    assert.equal((await pRes.json()).status, 'awaiting_review');

    // Login as seeded admin & approve order
    const adminLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@vernier.academy', password: 'AdminVernier!2026' }),
    });
    assert.equal(adminLogin.status, 200);
    const adminCookie = cookieHeader(adminLogin);

    const ordersRes = await fetch(`${baseUrl}/api/v1/admin/orders?q=${session.orderRef}`, {
      headers: { Cookie: adminCookie },
    });
    const { orders } = await ordersRes.json();
    assert.equal(orders.length, 1);

    const appRes = await fetch(`${baseUrl}/api/v1/admin/orders/${orders[0].id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({}),
    });
    assert.equal(appRes.status, 200);

    // Student now owns Tier 2 and can log to Trade Journal
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
  });

  await t.test('Whop HMAC-SHA256 webhook: rejects tampered signature, settles valid payment idempotently, and revokes on refund', async () => {
    // Prepare pending order via crypto or direct DB insert simulating whop checkout initiation
    const reg = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'whopstudent@example.com', password: 'WhopPassword!1', fullName: 'Chloe Grant', country: 'US' }),
    });
    const userCookie = cookieHeader(reg);
    const me = await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: userCookie } })).json();
    const pkg = app.locals.db.prepare("SELECT * FROM packages WHERE slug = 'pro-orderflow'").get();
    const orderRef = 'ORD-WHOP-TEST-001';
    app.locals.db
      .prepare("INSERT INTO orders (order_ref, user_id, package_id, provider, gross_cents, final_cents, status) VALUES (?, ?, ?, 'whop', ?, ?, 'pending')")
      .run(orderRef, me.user.id, pkg.id, pkg.price_cents, pkg.price_cents);

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

    // 2. Valid signature settles & unlocks Tier 3
    const validSig = signWhop(evtPayload, 'whsec_test_secret_vernier_2026');
    const okRes = await fetch(`${baseUrl}/api/v1/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-whop-signature': validSig },
      body: evtPayload,
    });
    assert.equal(okRes.status, 200);
    const okData = await okRes.json();
    assert.equal(okData.received, true);

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

    // 4. Refund webhook revokes entitlement back to 0
    const refundBody = JSON.stringify({
      id: 'evt_whop_refund_001',
      action: 'payment.refunded',
      data: { id: 'pay_whop_abc', metadata: { orderRef } },
    });
    const refundSig = signWhop(refundBody, 'whsec_test_secret_vernier_2026');
    const refRes = await fetch(`${baseUrl}/api/v1/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-whop-signature': refundSig },
      body: refundBody,
    });
    assert.equal(refRes.status, 200);

    const afterRefund = await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: userCookie } })).json();
    assert.equal(afterRefund.user.max_tier_level, 0);
  });
});
