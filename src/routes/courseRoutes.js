import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { issueCertificateForUser } from '../services/certificateService.js';

const router = Router();

router.get('/overview', requireAuth, (req, res) => {
  const userId = req.user.id;
  const maxTier = req.user.max_tier_level;

  const modules = req.db.prepare('SELECT * FROM modules ORDER BY order_index ASC').all();
  const lessons = req.db
    .prepare(`
      SELECT l.id, l.module_id, l.order_index, l.title, l.slug, l.is_free_preview, l.duration_sec,
             COALESCE(lp.completed, 0) AS completed,
             COALESCE(lp.watched_seconds, 0) AS watched_seconds
      FROM lessons l
      LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ?
      ORDER BY l.order_index ASC
    `)
    .all(userId);

  const unlockedLessons = lessons.filter((l) => {
    const mod = modules.find((m) => m.id === l.module_id);
    return mod && (maxTier >= mod.min_tier_level || l.is_free_preview);
  });

  const completedCount = unlockedLessons.filter((l) => l.completed === 1).length;
  const nextLesson = unlockedLessons.find((l) => l.completed === 0) || unlockedLessons[0] || null;

  const journalStats = req.db
    .prepare(`
      SELECT COUNT(*) AS total_trades,
             SUM(CASE WHEN result_r > 0 THEN 1 ELSE 0 END) AS wins,
             COALESCE(SUM(result_r), 0) AS net_r
      FROM trade_journal_entries
      WHERE user_id = ?
    `)
    .get(userId);

  const orders = req.db
    .prepare(`
      SELECT o.order_ref, o.provider, o.final_cents, o.status, o.created_at, o.paid_at, p.name AS package_name, p.tier_level
      FROM orders o
      JOIN packages p ON p.id = o.package_id
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC
    `)
    .all(userId);

  const certificates = req.db
    .prepare('SELECT serial_code, tier_level, issued_at FROM certificates WHERE user_id = ? ORDER BY tier_level DESC')
    .all(userId);

  res.json({
    user: req.user,
    stats: {
      unlockedLessons: unlockedLessons.length,
      totalCatalogLessons: lessons.length,
      completedLessons: completedCount,
      completionPct: unlockedLessons.length ? Math.round((completedCount / unlockedLessons.length) * 100) : 0,
      netR: Number((journalStats?.net_r || 0).toFixed(2)),
      totalTrades: Number(journalStats?.total_trades || 0),
    },
    nextLesson,
    orders,
    certificates,
  });
});

router.get('/lessons/:slug', (req, res) => {
  const userTier = req.user ? req.user.max_tier_level : 0;
  const userId = req.user ? req.user.id : null;

  const lesson = req.db
    .prepare(`
      SELECT l.*, m.title AS module_title, m.slug AS module_slug, m.min_tier_level, m.level_badge
      FROM lessons l
      JOIN modules m ON m.id = l.module_id
      WHERE l.slug = ?
    `)
    .get(String(req.params.slug || '').trim());

  if (!lesson) {
    return res.status(404).json({ error: 'Lesson not found.', requestId: req.requestId });
  }

  const accessible = userTier >= lesson.min_tier_level || Boolean(lesson.is_free_preview);
  if (!accessible) {
    const requiredPkg = req.db
      .prepare('SELECT slug, name, tier_level, price_cents FROM packages WHERE tier_level = ?')
      .get(lesson.min_tier_level);
    return res.status(403).json({
      error: `This lesson requires ${requiredPkg?.name || `Tier ${lesson.min_tier_level}`}.`,
      code: 'TIER_LOCKED',
      requiredPackage: requiredPkg,
      requestId: req.requestId,
    });
  }

  let progress = { completed: 0, watched_seconds: 0, quiz_passed: 0, notes_text: '' };
  if (userId) {
    const row = req.db
      .prepare('SELECT completed, watched_seconds, quiz_passed, notes_text FROM lesson_progress WHERE user_id = ? AND lesson_id = ?')
      .get(userId, lesson.id);
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

router.put('/lessons/:slug/progress', requireAuth, (req, res) => {
  const lesson = req.db
    .prepare(`
      SELECT l.id, l.is_free_preview, m.min_tier_level
      FROM lessons l JOIN modules m ON m.id = l.module_id
      WHERE l.slug = ?
    `)
    .get(String(req.params.slug || '').trim());

  if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });
  if (req.user.max_tier_level < lesson.min_tier_level && !lesson.is_free_preview) {
    return res.status(403).json({ error: 'Upgrade required to save progress for this lesson.' });
  }

  const { completed, watchedSeconds, quizPassed, notesText } = req.body || {};
  const existing = req.db
    .prepare('SELECT * FROM lesson_progress WHERE user_id = ? AND lesson_id = ?')
    .get(req.user.id, lesson.id);

  const nextCompleted = completed !== undefined ? (completed ? 1 : 0) : existing?.completed || 0;
  const nextWatched = watchedSeconds !== undefined ? Math.max(0, Number(watchedSeconds)) : existing?.watched_seconds || 0;
  const nextQuiz = quizPassed !== undefined ? (quizPassed ? 1 : 0) : existing?.quiz_passed || 0;
  const nextNotes = notesText !== undefined ? String(notesText).slice(0, 8000) : existing?.notes_text || '';

  req.db
    .prepare(`
      INSERT INTO lesson_progress (user_id, lesson_id, completed, watched_seconds, quiz_passed, notes_text, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, lesson_id) DO UPDATE SET
        completed = excluded.completed,
        watched_seconds = excluded.watched_seconds,
        quiz_passed = excluded.quiz_passed,
        notes_text = excluded.notes_text,
        updated_at = datetime('now')
    `)
    .run(req.user.id, lesson.id, nextCompleted, nextWatched, nextQuiz, nextNotes);

  res.json({ ok: true, completed: Boolean(nextCompleted), quiz_passed: Boolean(nextQuiz) });
});

router.get('/journal', requireAuth, (req, res) => {
  if (req.user.max_tier_level < 2) {
    return res.status(403).json({
      error: 'Trade Journal unlocks at Tier 2 ($25 Structural Price Action) or higher.',
      code: 'TIER_LOCKED',
      requiredTier: 2,
    });
  }
  const entries = req.db
    .prepare('SELECT * FROM trade_journal_entries WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 200')
    .all(req.user.id);
  const wins = entries.filter((e) => e.result_r > 0).length;
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

router.post('/journal', requireAuth, (req, res) => {
  if (req.user.max_tier_level < 2) {
    return res.status(403).json({ error: 'Trade Journal requires Tier 2 ($25) or higher.' });
  }
  const { pair, direction, entryPrice, stopLoss, takeProfit, riskPct, resultR, setupTag, notes } = req.body || {};
  if (!pair || !entryPrice || !stopLoss || !takeProfit) {
    return res.status(400).json({ error: 'Pair, entry, stop-loss, and take-profit are required.' });
  }
  const cleanDir = String(direction || 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
  const info = req.db
    .prepare(`
      INSERT INTO trade_journal_entries (user_id, pair, direction, entry_price, stop_loss, take_profit, risk_pct, result_r, setup_tag, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      req.user.id,
      String(pair).trim().toUpperCase().slice(0, 24),
      cleanDir,
      Number(entryPrice),
      Number(stopLoss),
      Number(takeProfit),
      Number(riskPct || 1),
      Number(resultR || 0),
      String(setupTag || 'OB+FVG').trim().slice(0, 32),
      String(notes || '').trim().slice(0, 1000)
    );
  const created = req.db.prepare('SELECT * FROM trade_journal_entries WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json({ entry: created });
});

router.delete('/journal/:id', requireAuth, (req, res) => {
  const resDel = req.db
    .prepare('DELETE FROM trade_journal_entries WHERE id = ? AND user_id = ?')
    .run(Number(req.params.id), req.user.id);
  if (resDel.changes === 0) return res.status(404).json({ error: 'Entry not found.' });
  res.json({ ok: true });
});

router.post('/certificates/claim', requireAuth, (req, res, next) => {
  try {
    const cert = issueCertificateForUser(req.db, req.user);
    res.json({ certificate: cert });
  } catch (err) {
    next(err);
  }
});

router.post('/audits', requireAuth, (req, res) => {
  if (req.user.max_tier_level < 4) {
    return res.status(403).json({ error: '1-on-1 Portfolio Audits are unlocked in Tier 4 ($500 Institutional Vault).' });
  }
  const { portfolioSizeUsd, focusPair, questionText } = req.body || {};
  if (!questionText || String(questionText).trim().length < 10) {
    return res.status(400).json({ error: 'Please include your setup or portfolio question (min 10 chars).' });
  }
  const info = req.db
    .prepare('INSERT INTO mentorship_audits (user_id, portfolio_size_usd, focus_pair, question_text) VALUES (?, ?, ?, ?)')
    .run(req.user.id, Number(portfolioSizeUsd || 5000), String(focusPair || 'BTC/USDT').slice(0, 24), String(questionText).trim().slice(0, 2000));
  res.status(201).json({ audit: req.db.prepare('SELECT * FROM mentorship_audits WHERE id = ?').get(Number(info.lastInsertRowid)) });
});

router.get('/audits', requireAuth, (req, res) => {
  if (req.user.max_tier_level < 4) return res.json({ audits: [] });
  const audits = req.db.prepare('SELECT * FROM mentorship_audits WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ audits });
});

export default router;

