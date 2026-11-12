import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { issueCertificateForUser } from '../services/certificateService.js';

const router = Router();

router.get('/overview', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const maxTier = req.user.max_tier_level;

  const [modules, rawLessons, progressRows, journalStats, orders, certificates] = await Promise.all([
    req.store.listModules(),
    req.store.listLessons(),
    req.store.listUserLessonProgress(userId),
    req.store.getUserJournalSummary(userId),
    req.store.listUserOrdersWithPackage(userId),
    req.store.listUserCertificates(userId),
  ]);

  const progressMap = new Map(progressRows.map((p) => [Number(p.lesson_id), p]));
  const modMap = new Map(modules.map((m) => [Number(m.id), m]));

  const lessons = rawLessons.map((l) => {
    const p = progressMap.get(Number(l.id));
    return {
      id: l.id,
      module_id: l.module_id,
      order_index: l.order_index,
      title: l.title,
      slug: l.slug,
      is_free_preview: l.is_free_preview,
      duration_sec: l.duration_sec,
      completed: Number(p?.completed || 0),
      watched_seconds: Number(p?.watched_seconds || 0),
    };
  });

  const unlockedLessons = lessons.filter((l) => {
    const mod = modMap.get(Number(l.module_id));
    return mod && (maxTier >= mod.min_tier_level || l.is_free_preview);
  });

  const completedCount = unlockedLessons.filter((l) => Number(l.completed) === 1).length;
  const nextLesson = unlockedLessons.find((l) => Number(l.completed) === 0) || unlockedLessons[0] || null;

  res.json({
    user: req.user,
    stats: {
      unlockedLessons: unlockedLessons.length,
      totalCatalogLessons: lessons.length,
      completedLessons: completedCount,
      completionPct: unlockedLessons.length ? Math.round((completedCount / unlockedLessons.length) * 100) : 0,
      netR: Number(Number(journalStats?.netR || 0).toFixed(2)),
      totalTrades: Number(journalStats?.totalTrades || 0),
    },
    nextLesson,
    orders,
    certificates,
  });
});

router.get('/lessons/:slug', async (req, res) => {
  const userTier = req.user ? req.user.max_tier_level : 0;
  const userId = req.user ? req.user.id : null;

  const lesson = await req.store.getLessonBySlugWithModule(req.params.slug);
  if (!lesson) {
    return res.status(404).json({ error: 'Lesson not found.', requestId: req.requestId });
  }

  const accessible = userTier >= lesson.min_tier_level || Boolean(lesson.is_free_preview);
  if (!accessible) {
    const requiredPkg = await req.store.getPackageByTier(lesson.min_tier_level);
    return res.status(403).json({
      error: `This lesson requires ${requiredPkg?.name || `Tier ${lesson.min_tier_level}`}.`,
      code: 'TIER_LOCKED',
      requiredPackage: requiredPkg
        ? {
            slug: requiredPkg.slug,
            name: requiredPkg.name,
            tier_level: requiredPkg.tier_level,
            price_cents: requiredPkg.price_cents,
          }
        : null,
      requestId: req.requestId,
    });
  }

  let progress = { completed: 0, watched_seconds: 0, quiz_passed: 0, notes_text: '' };
  if (userId) {
    const row = await req.store.getLessonProgress(userId, lesson.id);
    if (row) progress = row;
  }

  res.json({
    lesson: {
      id: lesson.id,
      module_id: lesson.module_id,
      module_title: lesson.module_title,
      min_tier_level: lesson.min_tier_level,
      level_badge: lesson.level_badge,
      title: lesson.title,
      slug: lesson.slug,
      is_free_preview: Boolean(lesson.is_free_preview),
      video_provider: lesson.video_provider,
      video_url: lesson.video_url,
      duration_sec: lesson.duration_sec,
      content_markdown: lesson.content_markdown,
      diagram_config: JSON.parse(lesson.diagram_config_json || '{}'),
      quiz: JSON.parse(lesson.quiz_json || '[]'),
      resources: JSON.parse(lesson.resources_json || '[]'),
      progress: {
        completed: Boolean(progress.completed),
        watched_seconds: progress.watched_seconds,
        quiz_passed: Boolean(progress.quiz_passed),
        notes_text: progress.notes_text,
      },
    },
  });
});

router.put('/lessons/:slug/progress', requireAuth, async (req, res) => {
  const lesson = await req.store.getLessonBySlugWithModule(req.params.slug);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  if (req.user.max_tier_level < lesson.min_tier_level && !lesson.is_free_preview) {
    return res.status(403).json({ error: 'Upgrade required to save progress for this lesson.' });
  }

  const { completed, watchedSeconds, quizPassed, notesText } = req.body || {};
  const existing = await req.store.getLessonProgress(req.user.id, lesson.id);

  const nextCompleted = completed !== undefined ? (completed ? 1 : 0) : existing?.completed || 0;
  const nextWatched = watchedSeconds !== undefined ? Math.max(0, Number(watchedSeconds)) : existing?.watched_seconds || 0;
  const nextQuiz = quizPassed !== undefined ? (quizPassed ? 1 : 0) : existing?.quiz_passed || 0;
  const nextNotes = notesText !== undefined ? String(notesText).slice(0, 8000) : existing?.notes_text || '';
  const nowIso = new Date().toISOString();

  await req.store.upsertLessonProgress({
    userId: req.user.id,
    lessonId: lesson.id,
    completed: nextCompleted,
    watchedSeconds: nextWatched,
    quizPassed: nextQuiz,
    notesText: nextNotes,
    updatedAt: nowIso,
  });

  res.json({ ok: true, completed: Boolean(nextCompleted), quiz_passed: Boolean(nextQuiz) });
});

router.get('/journal', requireAuth, async (req, res) => {
  if (req.user.max_tier_level < 2) {
    return res.status(403).json({
      error: 'Trade Journal unlocks at Tier 2 ($25 Structural Price Action) or higher.',
      code: 'TIER_LOCKED',
      requiredTier: 2,
    });
  }
  const entries = await req.store.listJournalEntries(req.user.id);
  const wins = entries.filter((e) => Number(e.result_r) > 0).length;
  const netR = entries.reduce((sum, e) => sum + Number(e.result_r || 0), 0);

  res.json({
    entries,
    metrics: {
      total: entries.length,
      winRate: entries.length ? Math.round((wins / entries.length) * 100) : 0,
      netR: Number(netR.toFixed(2)),
      expectancyR: entries.length ? Number((netR / entries.length).toFixed(2)) : 0,
    },
  });
});

router.post('/journal', requireAuth, async (req, res) => {
  if (req.user.max_tier_level < 2) {
    return res.status(403).json({ error: 'Trade Journal requires Tier 2 ($25) or higher.' });
  }
  const { pair, direction, entryPrice, stopLoss, takeProfit, riskPct, resultR, setupTag, notes } = req.body || {};
  if (!pair || !entryPrice || !stopLoss || !takeProfit) {
    return res.status(400).json({ error: 'Pair, entry, stop-loss, and take-profit are required.' });
  }
  const cleanDir = String(direction || 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
  const created = await req.store.createJournalEntry({
    userId: req.user.id,
    pair: String(pair).trim().toUpperCase().slice(0, 24),
    direction: cleanDir,
    entryPrice: Number(entryPrice),
    stopLoss: Number(stopLoss),
    takeProfit: Number(takeProfit),
    riskPct: Number(riskPct || 1),
    resultR: Number(resultR || 0),
    setupTag: String(setupTag || 'OB+FVG').trim().slice(0, 32),
    notes: String(notes || '').trim().slice(0, 1000),
  });
  res.status(201).json({ entry: created });
});

router.delete('/journal/:id', requireAuth, async (req, res) => {
  const resDel = await req.store.deleteJournalEntry(Number(req.params.id), req.user.id);
  if (resDel.changes === 0) return res.status(404).json({ error: 'Entry not found.' });
  res.json({ ok: true });
});

router.post('/certificates/claim', requireAuth, async (req, res, next) => {
  try {
    const cert = await issueCertificateForUser(req.store, req.user);
    res.json({ certificate: cert });
  } catch (err) {
    next(err);
  }
});

router.post('/audits', requireAuth, async (req, res) => {
  if (req.user.max_tier_level < 4) {
    return res.status(403).json({ error: '1-on-1 Portfolio Audits are unlocked in Tier 4 ($500 Institutional Vault).' });
  }
  const { portfolioSizeUsd, focusPair, questionText } = req.body || {};
  if (!questionText || String(questionText).trim().length < 10) {
    return res.status(400).json({ error: 'Please include your setup or portfolio question (min 10 chars).' });
  }
  const audit = await req.store.createAudit({
    userId: req.user.id,
    portfolioSizeUsd: Number(portfolioSizeUsd || 5000),
    focusPair: String(focusPair || 'BTC/USDT').slice(0, 24),
    questionText: String(questionText).trim().slice(0, 2000),
  });
  res.status(201).json({ audit });
});

router.get('/audits', requireAuth, async (req, res) => {
  if (req.user.max_tier_level < 4) return res.json({ audits: [] });
  const audits = await req.store.listAuditsForUser(req.user.id);
  res.json({ audits });
});

export default router;
