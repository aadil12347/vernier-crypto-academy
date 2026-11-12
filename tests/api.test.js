import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';

function cookieHeader(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

test('VERNIER Core API: Catalog, Auth, Lesson Gating, Progress & Certificate Verify', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vernier-api-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  const app = createApp({ dbPath });
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
    try { app.locals.db.close(); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('healthcheck & packages ($1, $25, $100, $500) + 13 modules / 39 lessons', async () => {
    const hRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(hRes.status, 200);
    const h = await hRes.json();
    assert.equal(h.ok, true);

    const pRes = await fetch(`${baseUrl}/api/v1/catalog/packages`);
    assert.equal(pRes.status, 200);
    const { packages } = await pRes.json();
    assert.deepEqual(
      packages.map((p) => p.price_cents),
      [100, 2500, 10000, 50000]
    );

    const cRes = await fetch(`${baseUrl}/api/v1/catalog/curriculum`);
    assert.equal(cRes.status, 200);
    const { modules } = await cRes.json();
    assert.equal(modules.length, 13);
    const totalLessons = modules.reduce((n, m) => n + m.lessons.length, 0);
    assert.equal(totalLessons, 39);
  });

  await t.test('public preview lesson opens unauthenticated while higher tier returns 403 TIER_LOCKED', async () => {
    const curr = await (await fetch(`${baseUrl}/api/v1/catalog/curriculum`)).json();
    const freeLesson = curr.modules[0].lessons.find((l) => l.is_free_preview);
    const tier3Lesson = curr.modules.find((m) => m.min_tier_level === 3).lessons[0];

    const openRes = await fetch(`${baseUrl}/api/v1/course/lessons/${freeLesson.slug}`);
    assert.equal(openRes.status, 200);
    const openJson = await openRes.json();
    assert.equal(openJson.lesson.slug, freeLesson.slug);

    const lockedRes = await fetch(`${baseUrl}/api/v1/course/lessons/${tier3Lesson.slug}`);
    assert.equal(lockedRes.status, 403);
    const lockedJson = await lockedRes.json();
    assert.equal(lockedJson.code, 'TIER_LOCKED');
  });

  await t.test('student registration, progress persistence & seeded certificate check', async () => {
    const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newtrader@example.com',
        password: 'StrongPassword!9',
        fullName: 'Sara Tariq',
        country: 'PK',
      }),
    });
    assert.equal(regRes.status, 201);
    const cookie = cookieHeader(regRes);
    assert.ok(cookie.includes('vernier_sid='));

    const curr = await (await fetch(`${baseUrl}/api/v1/catalog/curriculum`)).json();
    const freeLesson = curr.modules[0].lessons.find((l) => l.is_free_preview);

    const progRes = await fetch(`${baseUrl}/api/v1/course/lessons/${freeLesson.slug}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ completed: true, quizPassed: true, notesText: 'Cold wallet vs hot cap <= 15%' }),
    });
    assert.equal(progRes.status, 200);

    // Journal blocked below Tier 2
    const jBlocked = await fetch(`${baseUrl}/api/v1/course/journal`, { headers: { Cookie: cookie } });
    assert.equal(jBlocked.status, 403);

    // Public certificate verification check
    const certRes = await fetch(`${baseUrl}/api/v1/catalog/certificates/VRN-2026-T4-DEMO01`);
    assert.equal(certRes.status, 200);
    const certJson = await certRes.json();
    assert.equal(certJson.certificate.serial_code, 'VRN-2026-T4-DEMO01');
  });
});
