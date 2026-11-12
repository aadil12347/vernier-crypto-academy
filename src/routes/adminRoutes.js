import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import {
  settleOrderAndGrantAccess,
  refundOrderAndRevokeAccess,
  grantManualTier,
} from '../services/entitlementService.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAdmin);

router.get('/overview', (req, res) => {
  const revRow = req.db
    .prepare(`
      SELECT COUNT(*) AS paid_orders,
             COALESCE(SUM(final_cents), 0) AS total_cents
      FROM orders WHERE status = 'paid'
    `)
    .get();

  const pendingRow = req.db
    .prepare("SELECT COUNT(*) AS cnt FROM orders WHERE status = 'awaiting_review'")
    .get();

  const studentsRow = req.db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'student'").get();

  const byTier = req.db
    .prepare(`
      SELECT p.slug, p.name, p.tier_level, p.price_cents,
             COUNT(o.id) AS orders_count,
             COALESCE(SUM(o.final_cents), 0) AS revenue_cents
      FROM packages p
      LEFT JOIN orders o ON o.package_id = p.id AND o.status = 'paid'
      GROUP BY p.id
      ORDER BY p.tier_level ASC
    `)
    .all();

  const totalUsd = Number(revRow?.total_cents || 0) / 100;
  res.json({
    kpis: {
      totalRevenueCents: Number(revRow?.total_cents || 0),
      totalRevenuePkr: Math.round(totalUsd * config.payments.pkrUsdRate),
      paidOrders: Number(revRow?.paid_orders || 0),
      awaitingReview: Number(pendingRow?.cnt || 0),
      totalStudents: Number(studentsRow?.cnt || 0),
      whopEnabled: config.payments.whopEnabled,
      sandboxEnabled: config.payments.allowSandbox,
    },
    byTier,
  });
});

router.get('/orders', (req, res) => {
  const status = String(req.query.status || '').trim();
  const q = String(req.query.q || '').trim().toLowerCase();

  let sql = `
    SELECT o.*, u.email AS student_email, u.full_name AS student_name,
           p.name AS package_name, p.tier_level, p.slug AS package_slug
    FROM orders o
    JOIN users u ON u.id = o.user_id
    JOIN packages p ON p.id = o.package_id
    WHERE 1=1
  `;
  const params = [];
  if (status) {
    sql += ' AND o.status = ?';
    params.push(status);
  }
  if (q) {
    sql += ' AND (LOWER(o.order_ref) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(o.proof_text) LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY o.id DESC LIMIT 200';

  const orders = req.db.prepare(sql).all(...params);
  res.json({ orders });
});

router.post('/orders/:id/approve', (req, res, next) => {
  try {
    const order = req.db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    const result = settleOrderAndGrantAccess(req.db, {
      orderRef: order.order_ref,
      providerPaymentId: order.proof_text || `ADMIN-APPROVED-${req.user.id}`,
      metadata: { approved_by: req.user.email },
    });
    res.json({ ok: true, order: result.order });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/:id/reject', (req, res) => {
  const { reason = 'Transaction proof could not be verified' } = req.body || {};
  const info = req.db
    .prepare("UPDATE orders SET status = 'failed', proof_text = proof_text || ? WHERE id = ? AND status IN ('pending', 'awaiting_review')")
    .run(` [REJECTED: ${String(reason).slice(0, 120)}]`, Number(req.params.id));
  if (info.changes === 0) return res.status(400).json({ error: 'Order cannot be rejected in its current state.' });
  res.json({ ok: true });
});

router.post('/orders/:id/refund', (req, res, next) => {
  try {
    const { reason = 'Admin refund' } = req.body || {};
    const refunded = refundOrderAndRevokeAccess(req.db, { orderId: Number(req.params.id), reason });
    res.json({ ok: true, order: refunded });
  } catch (err) {
    next(err);
  }
});

router.get('/students', (req, res) => {
  const students = req.db
    .prepare(`
      SELECT u.id, u.email, u.full_name, u.country, u.discord_handle, u.telegram_handle, u.created_at,
             COALESCE(MAX(CASE WHEN e.status = 'active' THEN e.tier_level ELSE 0 END), 0) AS active_tier,
             (SELECT COUNT(*) FROM lesson_progress lp WHERE lp.user_id = u.id AND lp.completed = 1) AS completed_lessons
      FROM users u
      LEFT JOIN enrollments e ON e.user_id = u.id
      WHERE u.role = 'student'
      GROUP BY u.id
      ORDER BY u.id DESC
      LIMIT 200
    `)
    .all();
  res.json({ students });
});

router.post('/students/:id/grant', (req, res, next) => {
  try {
    const { packageSlug, note } = req.body || {};
    const orderRef = grantManualTier(req.db, {
      userId: Number(req.params.id),
      packageSlug,
      adminId: req.user.id,
      note,
    });
    res.json({ ok: true, orderRef });
  } catch (err) {
    next(err);
  }
});

router.get('/cms', (req, res) => {
  const modules = req.db.prepare('SELECT * FROM modules ORDER BY order_index ASC').all();
  const lessons = req.db.prepare('SELECT * FROM lessons ORDER BY module_id ASC, order_index ASC').all();
  res.json({ modules, lessons });
});

router.post('/cms/lessons', (req, res) => {
  const { moduleId, title, slug, videoUrl = '', isFreePreview = false, contentMarkdown = '' } = req.body || {};
  if (!moduleId || !title || !slug) {
    return res.status(400).json({ error: 'moduleId, title, and slug are required.' });
  }
  const maxIdx = req.db.prepare('SELECT COALESCE(MAX(order_index), 0) AS m FROM lessons WHERE module_id = ?').get(Number(moduleId));
  const info = req.db
    .prepare(`
      INSERT INTO lessons (module_id, order_index, title, slug, is_free_preview, video_url, content_markdown)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      Number(moduleId),
      Number(maxIdx?.m || 0) + 1,
      String(title).trim(),
      String(slug).trim().toLowerCase(),
      isFreePreview ? 1 : 0,
      String(videoUrl).trim(),
      String(contentMarkdown || 'Lesson notes coming soon.')
    );
  res.status(201).json({ lesson: req.db.prepare('SELECT * FROM lessons WHERE id = ?').get(Number(info.lastInsertRowid)) });
});

router.patch('/cms/lessons/:id', (req, res) => {
  const { title, videoUrl, isFreePreview, contentMarkdown } = req.body || {};
  const existing = req.db.prepare('SELECT * FROM lessons WHERE id = ?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Lesson not found.' });
  req.db
    .prepare('UPDATE lessons SET title = ?, video_url = ?, is_free_preview = ?, content_markdown = ? WHERE id = ?')
    .run(
      title !== undefined ? String(title) : existing.title,
      videoUrl !== undefined ? String(videoUrl) : existing.video_url,
      isFreePreview !== undefined ? (isFreePreview ? 1 : 0) : existing.is_free_preview,
      contentMarkdown !== undefined ? String(contentMarkdown) : existing.content_markdown,
      existing.id
    );
  res.json({ ok: true });
});

router.get('/coupons', (req, res) => {
  res.json({ coupons: req.db.prepare('SELECT * FROM coupons ORDER BY code ASC').all() });
});

router.post('/coupons', (req, res) => {
  const { code, discountType = 'percent', discountValue, minTierLevel = 1, maxUses = 500 } = req.body || {};
  const clean = String(code || '').trim().toUpperCase();
  if (!clean || !discountValue) return res.status(400).json({ error: 'Coupon code and value are required.' });
  req.db
    .prepare(`
      INSERT INTO coupons (code, discount_type, discount_value, min_tier_level, max_uses)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET discount_type = excluded.discount_type, discount_value = excluded.discount_value, is_active = 1
    `)
    .run(clean, discountType === 'fixed' ? 'fixed' : 'percent', Number(discountValue), Number(minTierLevel), Number(maxUses));
  res.status(201).json({ ok: true, code: clean });
});

router.get('/webhooks', (req, res) => {
  const events = req.db.prepare('SELECT * FROM webhook_events ORDER BY id DESC LIMIT 100').all();
  res.json({ events });
});

router.get('/audits', (req, res) => {
  const audits = req.db
    .prepare(`
      SELECT ma.*, u.email, u.full_name
      FROM mentorship_audits ma JOIN users u ON u.id = ma.user_id
      ORDER BY ma.id DESC LIMIT 100
    `)
    .all();
  res.json({ audits });
});

router.patch('/audits/:id', (req, res) => {
  const { mentorFeedback } = req.body || {};
  req.db
    .prepare("UPDATE mentorship_audits SET mentor_feedback = ?, status = 'reviewed' WHERE id = ?")
    .run(String(mentorFeedback || ''), Number(req.params.id));
  res.json({ ok: true });
});

export default router;

