import crypto from 'node:crypto';
import { getDb } from '../../db/connection.js';

const SCRYPT_KEYLEN = 64;
const SESSION_DAYS = 14;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, storedHash) {
  const [salt, keyHex] = String(storedHash || '').split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  const storedBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function createSession(db, userId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare(
    'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
  ).run(userId, tokenHash, expiresAt);
  return { rawToken, expiresAt };
}

export function getSessionUser(db, rawToken) {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const row = db.prepare(`
    SELECT u.id, u.email, u.full_name, u.role, u.country, u.discord_handle, u.telegram_handle, u.created_at,
           s.expires_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(tokenHash);

  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }

  const tierRow = db.prepare(`
    SELECT COALESCE(MAX(tier_level), 0) AS max_tier
    FROM enrollments
    WHERE user_id = ? AND status = 'active'
  `).get(row.id);

  const enrollments = db.prepare(`
    SELECT e.id, e.tier_level, e.status, e.granted_at, p.slug, p.name, p.price_cents
    FROM enrollments e
    JOIN packages p ON p.id = e.package_id
    WHERE e.user_id = ? AND e.status = 'active'
    ORDER BY e.tier_level DESC
  `).all(row.id);

  const highestPaidRow = db.prepare(`
    SELECT COALESCE(MAX(p.price_cents), 0) AS max_paid_cents
    FROM enrollments e
    JOIN packages p ON p.id = e.package_id
    WHERE e.user_id = ? AND e.status = 'active'
  `).get(row.id);

  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    country: row.country,
    discord_handle: row.discord_handle,
    telegram_handle: row.telegram_handle,
    created_at: row.created_at,
    max_tier_level: row.role === 'admin' ? 4 : Number(tierRow?.max_tier || 0),
    highest_paid_cents: Number(highestPaidRow?.max_paid_cents || 0),
    enrollments,
  };
}

export function deleteSession(db, rawToken) {
  if (!rawToken) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(rawToken));
}

export function createPasswordReset(db, email) {
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(String(email || '').trim());
  if (!user) return null;
  const rawToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  db.prepare(
    'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
  ).run(user.id, tokenHash, expiresAt);
  return { rawToken, email: user.email, expiresAt };
}

export function consumePasswordReset(db, rawToken, newPassword) {
  const tokenHash = hashToken(rawToken);
  const row = db.prepare(
    'SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?'
  ).get(tokenHash);
  if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) {
    return false;
  }
  const passwordHash = hashPassword(newPassword);
  db.exec('BEGIN;');
  try {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, row.user_id);
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?").run(row.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    db.exec('COMMIT;');
    return true;
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

export function registerUser(db = getDb(), { email, password, fullName, country = 'US' }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    const err = new Error('Please enter a valid email address.');
    err.status = 400;
    throw err;
  }
  if (!password || String(password).length < 8) {
    const err = new Error('Password must be at least 8 characters.');
    err.status = 400;
    throw err;
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    const err = new Error('An account with this email already exists.');
    err.status = 409;
    throw err;
  }
  const hash = hashPassword(password);
  const res = db.prepare(
    'INSERT INTO users (email, password_hash, full_name, role, country) VALUES (?, ?, ?, ?, ?)'
  ).run(cleanEmail, hash, String(fullName || cleanEmail.split('@')[0]).trim(), 'student', String(country || 'US').slice(0, 64));
  return Number(res.lastInsertRowid);
}

