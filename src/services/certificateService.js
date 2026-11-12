import crypto from 'node:crypto';

export function issueCertificateForUser(db, user) {
  if (!user || user.max_tier_level < 1) {
    const err = new Error('Enroll in at least Starter Pass ($1) to claim a completion certificate.');
    err.status = 403;
    throw err;
  }

  const tier = user.max_tier_level;
  const stats = db.prepare(`
    SELECT COUNT(*) AS total_lessons,
           SUM(CASE WHEN COALESCE(lp.completed, 0) = 1 THEN 1 ELSE 0 END) AS completed_lessons
    FROM lessons l
    JOIN modules m ON m.id = l.module_id
    LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ?
    WHERE m.min_tier_level <= ?
  `).get(user.id, tier);

  const total = Number(stats?.total_lessons || 0);
  const done = Number(stats?.completed_lessons || 0);

  if (total === 0 || done < total) {
    const err = new Error(`Complete all ${total} lessons in your unlocked tier (${done}/${total} done) to claim your certificate.`);
    err.status = 400;
    err.code = 'LESSONS_INCOMPLETE';
    throw err;
  }

  const existing = db.prepare(`
    SELECT * FROM certificates WHERE user_id = ? AND tier_level = ?
  `).get(user.id, tier);
  if (existing) return existing;

  const serial = `VRN-${new Date().getFullYear()}-T${tier}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  db.prepare(`
    INSERT INTO certificates (serial_code, user_id, tier_level) VALUES (?, ?, ?)
  `).run(serial, user.id, tier);

  return db.prepare('SELECT * FROM certificates WHERE serial_code = ?').get(serial);
}

