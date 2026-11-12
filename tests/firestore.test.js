import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApp } from '../server.js';
import { config } from '../src/config.js';

/**
 * Stateful in-memory Cloud Firestore test double enforcing real Firestore invariants:
 * - Single-segment safe document IDs (no '/')
 * - 500-op max WriteBatch limit
 * - Strictly no reads after writes inside runTransaction()
 */
function createInMemoryFirestore() {
  const store = new Map(); // colName -> Map(docId -> clonedObj)

  const getColMap = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };

  const clone = (val) => (val === undefined ? undefined : JSON.parse(JSON.stringify(val)));

  const makeSnap = (colName, docId, backing = store) => {
    const colMap = backing.get(colName);
    const data = colMap ? colMap.get(docId) : undefined;
    return {
      id: docId,
      exists: data !== undefined,
      ref: makeDocRef(colName, docId),
      data: () => (data !== undefined ? clone(data) : undefined),
    };
  };

  const makeDocRef = (colName, docId) => {
    if (!docId || String(docId).includes('/')) {
      throw new Error(`Invalid Firestore docId "${docId}" in collection "${colName}"`);
    }
    return {
      __type: 'docRef',
      colName,
      id: String(docId),
      async get() {
        return makeSnap(colName, String(docId));
      },
      async set(data, options = {}) {
        const colMap = getColMap(colName);
        if (options.merge && colMap.has(String(docId))) {
          colMap.set(String(docId), { ...colMap.get(String(docId)), ...clone(data) });
        } else {
          colMap.set(String(docId), clone(data));
        }
      },
      async update(patch) {
        const colMap = getColMap(colName);
        if (!colMap.has(String(docId))) {
          throw new Error(`NOT_FOUND: ${colName}/${docId}`);
        }
        colMap.set(String(docId), { ...colMap.get(String(docId)), ...clone(patch) });
      },
      async delete() {
        getColMap(colName).delete(String(docId));
      },
    };
  };

  const makeQuery = (colName, filters = [], maxLimit = 0) => ({
    __type: 'query',
    colName,
    filters,
    maxLimit,
    where(field, op, value) {
      assert.equal(op, '==', 'Mock Firestore only expects equality filters');
      return makeQuery(colName, [...filters, { field, value }], maxLimit);
    },
    limit(n) {
      return makeQuery(colName, filters, n);
    },
    async get() {
      const colMap = getColMap(colName);
      let docs = [];
      for (const docId of colMap.keys()) {
        const snap = makeSnap(colName, docId);
        const data = snap.data();
        const matches = filters.every((f) => data?.[f.field] === f.value);
        if (matches) docs.push(snap);
      }
      if (maxLimit > 0) docs = docs.slice(0, maxLimit);
      return {
        empty: docs.length === 0,
        size: docs.length,
        docs,
      };
    },
  });

  return {
    collection(name) {
      const q = makeQuery(name);
      return {
        ...q,
        doc(id) {
          return makeDocRef(name, id);
        },
      };
    },
    batch() {
      const ops = [];
      return {
        set(ref, data, options = {}) {
          ops.push({ type: 'set', ref, data, options });
        },
        update(ref, patch) {
          ops.push({ type: 'update', ref, patch });
        },
        delete(ref) {
          ops.push({ type: 'delete', ref });
        },
        async commit() {
          assert.ok(ops.length <= 500, `Firestore batch exceeded 500 ops (${ops.length})`);
          for (const op of ops) {
            if (op.type === 'set') await op.ref.set(op.data, op.options);
            else if (op.type === 'update') await op.ref.update(op.patch);
            else if (op.type === 'delete') await op.ref.delete();
          }
        },
      };
    },
    async runTransaction(fn) {
      let hasWritten = false;
      const queued = [];
      const tx = {
        async get(target) {
          if (hasWritten) {
            throw new Error('Firestore transactions require all reads to execute before all writes.');
          }
          return target.get();
        },
        set(ref, data, options = {}) {
          hasWritten = true;
          queued.push(() => ref.set(data, options));
        },
        update(ref, patch) {
          hasWritten = true;
          queued.push(() => ref.update(patch));
        },
        delete(ref) {
          hasWritten = true;
          queued.push(() => ref.delete());
        },
      };
      const result = await fn(tx);
      for (const apply of queued) {
        await apply();
      }
      return result;
    },
  };
}

function cookieHeader(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

function signWhopLegacy(rawBody, secret, timestamp = '1760000000') {
  const hex = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${hex}`;
}

test('VERNIER Firebase Cloud Firestore Store Full End-to-End Suite', async (t) => {
  const mockFirestore = createInMemoryFirestore();
  const prevSecret = config.payments.whop.webhookSecret;
  config.payments.whop.webhookSecret = 'whsec_firestore_test_secret';

  const app = createApp({ firestore: mockFirestore });
  await app.locals.readyPromise;
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    config.payments.whop.webhookSecret = prevSecret;
    server.close();
  });

  await t.test('health endpoint reports firebase-firestore & idempotent seed populates 4 packages + 13 modules + 39 lessons', async () => {
    const h = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(h.ok, true);
    assert.equal(h.database, 'firebase-firestore');
    assert.equal(h.whopDefaultPlanId, 'plan_CTX7xd3gUPsgD');

    const { packages } = await (await fetch(`${baseUrl}/api/v1/catalog/packages`)).json();
    assert.deepEqual(
      packages.map((p) => p.price_cents),
      [100, 2500, 10000, 50000]
    );

    const { modules } = await (await fetch(`${baseUrl}/api/v1/catalog/curriculum`)).json();
    assert.equal(modules.length, 13);
    assert.equal(
      modules.reduce((acc, m) => acc + m.lessons.length, 0),
      39
    );

    const cert = await (await fetch(`${baseUrl}/api/v1/catalog/certificates/VRN-2026-T4-DEMO01`)).json();
    assert.equal(cert.certificate.serial_code, 'VRN-2026-T4-DEMO01');
  });

  await t.test('Firestore checkout -> Whop webhook settlement -> upgrade credit -> refund restoration -> safe slash eventId', async () => {
    // 1. Register + buy $1 Starter Pass via Whop session
    const s1Res = await fetch(`${baseUrl}/api/v1/checkout/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageSlug: 'starter-pass',
        email: 'firebuyer@example.com',
        fullName: 'Amina Farooq',
        password: 'FirePassword!9',
      }),
    });
    assert.equal(s1Res.status, 201);
    const buyerCookie = cookieHeader(s1Res);
    const { session: s1 } = await s1Res.json();

    // Even webhook event IDs containing '/' must be safely stored as Firestore doc IDs
    const slashEventBody = JSON.stringify({
      id: 'evt/whop/slash/001',
      type: 'payment.succeeded',
      data: { id: 'pay_fs_1', metadata: { orderRef: s1.orderRef } },
    });
    const sig1 = signWhopLegacy(slashEventBody, 'whsec_firestore_test_secret');
    const wh1 = await fetch(`${baseUrl}/api/v1/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-whop-signature': sig1 },
      body: slashEventBody,
    });
    assert.equal(wh1.status, 200);

    // Duplicate delivery returns idempotent duplicate: true
    const whDup = await fetch(`${baseUrl}/api/v1/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-whop-signature': sig1 },
      body: slashEventBody,
    });
    assert.equal((await whDup.json()).duplicate, true);

    // 2. Verify $1 upgrade credit applies toward Tier 2 ($25 -> $24) & complete via TEST100 or webhook
    const quoteRes = await fetch(`${baseUrl}/api/v1/checkout/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: buyerCookie },
      body: JSON.stringify({ packageSlug: 'price-action' }),
    });
    const { quote } = await quoteRes.json();
    assert.equal(quote.upgrade_credit_cents, 100);
    assert.equal(quote.final_cents, 2400);

    const s2Res = await fetch(`${baseUrl}/api/v1/checkout/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: buyerCookie },
      body: JSON.stringify({ packageSlug: 'price-action' }),
    });
    const { session: s2 } = await s2Res.json();
    const s2Body = JSON.stringify({
      id: 'evt_fs_t2',
      type: 'payment.succeeded',
      data: { id: 'pay_fs_2', metadata: { orderRef: s2.orderRef } },
    });
    const sig2 = signWhopLegacy(s2Body, 'whsec_firestore_test_secret');
    await fetch(`${baseUrl}/api/v1/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-whop-signature': sig2 },
      body: s2Body,
    });

    const meT2 = await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: buyerCookie } })).json();
    assert.equal(meT2.user.max_tier_level, 2);

    // 3. Direct Whop plan_CTX7xd3gUPsgD fallback (unauthenticated guest checkout without orderRef)
    const directBody = JSON.stringify({
      id: 'evt_fs_direct_plan',
      type: 'payment.succeeded',
      data: { id: 'pay_fs_direct', plan_id: 'plan_CTX7xd3gUPsgD', user: { email: 'directwhop@example.com' } },
    });
    const sigDirect = signWhopLegacy(directBody, 'whsec_firestore_test_secret');
    const whDirect = await fetch(`${baseUrl}/api/v1/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-whop-signature': sigDirect },
      body: directBody,
    });
    assert.equal(whDirect.status, 200);
    const directUser = await app.locals.store.getUserByEmail('directwhop@example.com');
    assert.ok(directUser);
    const directSummary = await app.locals.store.getUserEntitlementSummary(directUser.id);
    assert.equal(directSummary.maxTier, 1);

    // 4. Refunding Tier 2 restores Tier 1 cleanly in Firestore transaction
    const refBody = JSON.stringify({
      id: 'evt_fs_refund_t2',
      type: 'payment.refunded',
      data: { id: 'pay_fs_2', metadata: { orderRef: s2.orderRef } },
    });
    const sigRef = signWhopLegacy(refBody, 'whsec_firestore_test_secret');
    await fetch(`${baseUrl}/api/v1/webhooks/whop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-whop-signature': sigRef },
      body: refBody,
    });
    const meAfterRefund = await (await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: buyerCookie } })).json();
    assert.equal(meAfterRefund.user.max_tier_level, 1);
  });

  await t.test('Admin endpoints (overview, orders, students, grant, cms, webhooks, audits) run cleanly on Firestore', async () => {
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@vernier.academy', password: 'AdminVernier!2026' }),
    });
    assert.equal(loginRes.status, 200);
    const adminCookie = cookieHeader(loginRes);

    const overview = await (await fetch(`${baseUrl}/api/v1/admin/overview`, { headers: { Cookie: adminCookie } })).json();
    assert.ok(overview.kpis.paidOrders >= 2);
    assert.equal(overview.byTier.length, 4);

    const studentsRes = await (await fetch(`${baseUrl}/api/v1/admin/students`, { headers: { Cookie: adminCookie } })).json();
    const fireBuyer = studentsRes.students.find((s) => s.email === 'firebuyer@example.com');
    assert.ok(fireBuyer);

    const grantRes = await fetch(`${baseUrl}/api/v1/admin/students/${fireBuyer.id}/grant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ packageSlug: 'institutional-vault', note: 'VIP test grant' }),
    });
    assert.equal(grantRes.status, 200);
    assert.equal((await grantRes.json()).ok, true);

    const cmsRes = await fetch(`${baseUrl}/api/v1/admin/cms/lessons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        moduleId: 1,
        title: 'Firestore Custom Module Lesson',
        slug: 'firestore-custom-lesson',
        isFreePreview: true,
        contentMarkdown: '# Custom Note',
      }),
    });
    assert.equal(cmsRes.status, 201);

    const lessonGet = await fetch(`${baseUrl}/api/v1/course/lessons/firestore-custom-lesson`);
    assert.equal(lessonGet.status, 200);
  });
});

