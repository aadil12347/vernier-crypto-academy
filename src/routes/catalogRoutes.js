import { Router } from 'express';
import { config } from '../config.js';

const router = Router();

router.get('/packages', (req, res) => {
  const rows = req.db.prepare('SELECT * FROM packages WHERE is_active = 1 ORDER BY tier_level ASC').all();
  const highestPaid = req.user ? req.user.highest_paid_cents : 0;
  const maxTier = req.user ? req.user.max_tier_level : 0;

  const packages = rows.map((p) => {
    const creditCents = maxTier > 0 && p.tier_level > maxTier ? Math.min(highestPaid, Math.max(0, p.price_cents - 100)) : 0;
    const effectiveCents = Math.max(0, p.price_cents - creditCents);
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      tier_level: p.tier_level,
      price_cents: p.price_cents,
      upgrade_credit_cents: creditCents,
      effective_price_cents: effectiveCents,
      owned: maxTier >= p.tier_level,
      tagline: p.tagline,
      badge_code: p.badge_code,
      features: JSON.parse(p.features_json || '[]'),
      whop_plan_id: p.whop_plan_id || config.payments.whop.plans[p.slug] || '',
    };
  });

  res.json({
    packages,
    paymentRails: {
      whopEnabled: config.payments.whopEnabled,
      allowSandbox: config.payments.allowSandbox,
      enableCryptoManual: config.payments.enableCryptoManual,
      enableCryptoAuto: config.payments.enableCryptoAuto,
      enableLocalPk: config.payments.enableLocalPk,
      pkrUsdRate: config.payments.pkrUsdRate,
    },
  });
});

router.get('/curriculum', (req, res) => {
  const userTier = req.user ? req.user.max_tier_level : 0;
  const modules = req.db.prepare('SELECT * FROM modules ORDER BY order_index ASC').all();
  const lessons = req.db
    .prepare(
      'SELECT id, module_id, order_index, title, slug, is_free_preview, duration_sec FROM lessons ORDER BY order_index ASC'
    )
    .all();

  const lessonsByMod = new Map();
  for (const l of lessons) {
    if (!lessonsByMod.has(l.module_id)) lessonsByMod.set(l.module_id, []);
    lessonsByMod.get(l.module_id).push(l);
  }

  const result = modules.map((m) => ({
    ...m,
    unlocked: userTier >= m.min_tier_level,
    lessons: (lessonsByMod.get(m.id) || []).map((l) => ({
      ...l,
      is_free_preview: Boolean(l.is_free_preview),
      accessible: userTier >= m.min_tier_level || Boolean(l.is_free_preview),
    })),
  }));

  res.json({ modules: result, userTier });
});

router.get('/certificates/:serial', (req, res) => {
  const row = req.db
    .prepare(`
      SELECT c.serial_code, c.tier_level, c.issued_at, u.full_name, p.name AS package_name
      FROM certificates c
      JOIN users u ON u.id = c.user_id
      JOIN packages p ON p.tier_level = c.tier_level
      WHERE c.serial_code = ?
    `)
    .get(String(req.params.serial || '').trim().toUpperCase());

  if (!row) {
    return res.status(404).json({ error: 'Certificate serial code not found.' });
  }
  res.json({ certificate: row });
});

export default router;

