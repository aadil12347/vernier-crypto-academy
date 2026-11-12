import { Router } from 'express';
import { config } from '../config.js';
import { resolveWhopPlanId } from '../services/entitlementService.js';

const router = Router();

router.get('/packages', async (req, res) => {
  const rows = await req.store.listActivePackages();
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
      whop_plan_id: resolveWhopPlanId(p),
    };
  });

  res.json({
    packages,
    paymentRails: {
      whopEnabled: config.payments.whopEnabled,
      whopDefaultPlanId: config.payments.whop.defaultPlanId,
      allowSandbox: config.payments.allowSandbox,
      enableCryptoManual: config.payments.enableCryptoManual,
      enableCryptoAuto: config.payments.enableCryptoAuto,
      enableLocalPk: config.payments.enableLocalPk,
    },
  });
});

router.get('/curriculum', async (req, res) => {
  const userTier = req.user ? req.user.max_tier_level : 0;
  const [modules, allLessons] = await Promise.all([req.store.listModules(), req.store.listLessons()]);

  const lessonsByMod = new Map();
  for (const l of allLessons) {
    const summary = {
      id: l.id,
      module_id: l.module_id,
      order_index: l.order_index,
      title: l.title,
      slug: l.slug,
      is_free_preview: Boolean(l.is_free_preview),
      duration_sec: l.duration_sec,
    };
    if (!lessonsByMod.has(l.module_id)) lessonsByMod.set(l.module_id, []);
    lessonsByMod.get(l.module_id).push(summary);
  }

  const result = modules.map((m) => ({
    ...m,
    unlocked: userTier >= m.min_tier_level,
    lessons: (lessonsByMod.get(m.id) || []).map((l) => ({
      ...l,
      accessible: userTier >= m.min_tier_level || l.is_free_preview,
    })),
  }));

  res.json({ modules: result, userTier });
});

router.get('/certificates/:serial', async (req, res) => {
  const row = await req.store.getCertificateBySerialWithDetails(req.params.serial);
  if (!row) {
    return res.status(404).json({ error: 'Certificate serial code not found.' });
  }
  res.json({ certificate: row });
});

export default router;
