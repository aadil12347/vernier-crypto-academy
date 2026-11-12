import crypto from 'node:crypto';
import { getStore } from '../../db/store.js';

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

export async function createSession(store, userId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await store.createSession({ userId, tokenHash, expiresAt });
  return { rawToken, expiresAt };
}

export async function getSessionUser(store, rawToken) {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const row = await store.getSessionWithUser(tokenHash);
  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await store.deleteSession(tokenHash);
    return null;
  }

  const entitlement = await store.getUserEntitlementSummary(row.id);

  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    country: row.country,
    discord_handle: row.discord_handle,
    telegram_handle: row.telegram_handle,
    created_at: row.created_at,
    max_tier_level: row.role === 'admin' ? 4 : entitlement.maxTier,
    highest_paid_cents: entitlement.highestPaidCents,
    enrollments: entitlement.enrollments,
  };
}

export async function deleteSession(store, rawToken) {
  if (!rawToken) return;
  await store.deleteSession(hashToken(rawToken));
}

export async function createPasswordReset(store, email) {
  const user = await store.getUserByEmail(email);
  if (!user) return null;
  const rawToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  await store.createPasswordReset({ userId: user.id, tokenHash, expiresAt });
  return { rawToken, email: user.email, expiresAt };
}

export async function consumePasswordReset(store, rawToken, newPassword) {
  const tokenHash = hashToken(rawToken);
  return store.consumePasswordResetTransaction({
    tokenHash,
    newPasswordHash: hashPassword(newPassword),
    usedAt: new Date().toISOString(),
  });
}

export async function registerUser(store = getStore(), { email, password, fullName, country = 'US' }) {
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
  const existing = await store.getUserByEmail(cleanEmail);
  if (existing) {
    const err = new Error('An account with this email already exists.');
    err.status = 409;
    throw err;
  }
  const hash = hashPassword(password);
  return store.createUser({
    email: cleanEmail,
    passwordHash: hash,
    fullName: String(fullName || cleanEmail.split('@')[0]).trim(),
    role: 'student',
    country: String(country || 'US').slice(0, 64),
  });
}
