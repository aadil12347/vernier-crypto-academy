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

router.get('/overview', async (req, res) => {
  const overview = await req.store.getAdminOverview();
  res.json({
    kpis: {
      totalRevenueCents: overview.totalRevenueCents,
      paidOrders: overview.paidOrders,
      awaitingReview: overview.awaitingReview,
      totalStudents: overview.totalStudents,
      whopEnabled: config.payments.whopEnabled,
      sandboxEnabled: config.payments.allowSandbox,
    },
    byTier: overview.byTier,
  });
});

router.get('/orders', async (req, res) => {
  const status = String(req.query.status || '').trim();
  const q = String(req.query.q || '').trim().toLowerCase();
  const orders = await req.store.listOrdersAdmin({ status, q });
  res.json({ orders });
});

router.post('/orders/:id/approve', async (req, res, next) => {
  try {
    const order = await req.store.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    const result = await settleOrderAndGrantAccess(req.store, {
      orderRef: order.order_ref,
      providerPaymentId: order.proof_text || `ADMIN-APPROVED-${req.user.id}`,
      metadata: { approved_by: req.user.email },
    });
    res.json({ ok: true, order: result.order });
  } catch (err) {
    next(err);
  }
});

router.post('/orders/:id/reject', async (req, res) => {
  const { reason = 'Transaction proof could not be verified' } = req.body || {};
  const info = await req.store.rejectPendingOrder(
    req.params.id,
    ` [REJECTED: ${String(reason).slice(0, 120)}]`
  );
  if (info.changes === 0) return res.status(400).json({ error: 'Order cannot be rejected in its current state.' });
  res.json({ ok: true });
});

router.post('/orders/:id/refund', async (req, res, next) => {
  try {
    const { reason = 'Admin refund' } = req.body || {};
    const refunded = await refundOrderAndRevokeAccess(req.store, { orderId: Number(req.params.id), reason });
    res.json({ ok: true, order: refunded });
  } catch (err) {
    next(err);
  }
});

router.get('/students', async (req, res) => {
  const students = await req.store.listStudentsAdmin();
  res.json({ students });
});

router.post('/students/:id/grant', async (req, res, next) => {
  try {
    const { packageSlug, note } = req.body || {};
    const orderRef = await grantManualTier(req.store, {
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

router.get('/cms', async (req, res) => {
  const [modules, lessons] = await Promise.all([
    req.store.listModules(),
    req.store.listLessons({ sortByModule: true }),
  ]);
  res.json({ modules, lessons });
});

router.post('/cms/lessons', async (req, res) => {
  const { moduleId, title, slug, videoUrl = '', isFreePreview = false, contentMarkdown = '' } = req.body || {};
  if (!moduleId || !title || !slug) {
    return res.status(400).json({ error: 'moduleId, title, and slug are required.' });
  }
  const nextOrder = await req.store.getNextModuleLessonOrderIndex(moduleId);
  const lesson = await req.store.createLesson({
    moduleId: Number(moduleId),
    orderIndex: nextOrder,
    title: String(title).trim(),
    slug: String(slug).trim().toLowerCase(),
    isFreePreview: Boolean(isFreePreview),
    videoUrl: String(videoUrl).trim(),
    contentMarkdown: String(contentMarkdown || 'Lesson notes coming soon.'),
  });
  res.status(201).json({ lesson });
});

router.patch('/cms/lessons/:id', async (req, res) => {
  const { title, videoUrl, isFreePreview, contentMarkdown } = req.body || {};
  const existing = await req.store.getLessonById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Lesson not found.' });
  await req.store.updateLesson(existing.id, {
    title: title !== undefined ? String(title) : existing.title,
    videoUrl: videoUrl !== undefined ? String(videoUrl) : existing.video_url,
    isFreePreview: isFreePreview !== undefined ? Boolean(isFreePreview) : Boolean(existing.is_free_preview),
    contentMarkdown: contentMarkdown !== undefined ? String(contentMarkdown) : existing.content_markdown,
  });
  res.json({ ok: true });
});

router.get('/coupons', async (req, res) => {
  const coupons = await req.store.listCoupons();
  res.json({ coupons });
});

router.post('/coupons', async (req, res) => {
  const { code, discountType = 'percent', discountValue, minTierLevel = 1, maxUses = 500 } = req.body || {};
  const clean = String(code || '').trim().toUpperCase();
  if (!clean || !discountValue) return res.status(400).json({ error: 'Coupon code and value are required.' });
  await req.store.upsertCoupon({
    code: clean,
    discountType: discountType === 'fixed' ? 'fixed' : 'percent',
    discountValue: Number(discountValue),
    minTierLevel: Number(minTierLevel),
    maxUses: Number(maxUses),
  });
  res.status(201).json({ ok: true, code: clean });
});

router.get('/webhooks', async (req, res) => {
  const events = await req.store.listWebhookEventsAdmin();
  res.json({ events });
});

router.get('/audits', async (req, res) => {
  const audits = await req.store.listAllAuditsWithUsers();
  res.json({ audits });
});

router.patch('/audits/:id', async (req, res) => {
  const { mentorFeedback } = req.body || {};
  await req.store.reviewAudit(req.params.id, String(mentorFeedback || ''));
  res.json({ ok: true });
});

export default router;
