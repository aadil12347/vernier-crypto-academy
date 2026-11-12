import { getStore } from '../../db/store.js';
import { getSessionUser } from '../services/authService.js';
import { config } from '../config.js';

export const SESSION_COOKIE_NAME = 'vernier_sid';

export function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of String(cookieHeader).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

export function setSessionCookie(res, rawToken) {
  const flags = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${14 * 86400}`,
  ];
  if (config.nodeEnv === 'production' && config.appUrl.startsWith('https://')) {
    flags.push('Secure');
  }
  res.setHeader('Set-Cookie', flags.join('; '));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function attachUser(req, _res, next) {
  try {
    if (req.app.locals.readyPromise) {
      await req.app.locals.readyPromise;
    }
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    req.store = req.app.locals.store || getStore();
    req.db = req.store;
    req.user = token ? await getSessionUser(req.store, token) : null;
    req.sessionToken = token || null;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
      requestId: req.requestId,
    });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED', requestId: req.requestId });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin permission required', code: 'ADMIN_REQUIRED', requestId: req.requestId });
  }
  next();
}
