import { Router } from 'express';
import {
  registerUser,
  verifyPassword,
  createSession,
  deleteSession,
  createPasswordReset,
  consumePasswordReset,
} from '../services/authService.js';
import { setSessionCookie, clearSessionCookie, requireAuth } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

const router = Router();
const authLimiter = createRateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'auth' });

router.post('/register', authLimiter, (req, res, next) => {
  try {
    const { email, password, fullName, country } = req.body || {};
    const userId = registerUser(req.db, { email, password, fullName, country });
    const { rawToken } = createSession(req.db, userId);
    setSessionCookie(res, rawToken);
    const user = req.db
      .prepare('SELECT id, email, full_name, role, country, discord_handle, telegram_handle FROM users WHERE id = ?')
      .get(userId);
    res.status(201).json({ user: { ...user, max_tier_level: 0, highest_paid_cents: 0, enrollments: [] } });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const user = req.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(String(email || '').trim().toLowerCase());
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS', requestId: req.requestId });
    }
    const { rawToken } = createSession(req.db, user.id);
    setSessionCookie(res, rawToken);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        country: user.country,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  if (req.sessionToken) {
    deleteSession(req.db, req.sessionToken);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: req.user || null });
});

router.patch('/profile', requireAuth, (req, res) => {
  const { fullName, country, discordHandle, telegramHandle } = req.body || {};
  req.db
    .prepare(
      'UPDATE users SET full_name = ?, country = ?, discord_handle = ?, telegram_handle = ? WHERE id = ?'
    )
    .run(
      String(fullName || req.user.full_name).trim().slice(0, 80),
      String(country || req.user.country).trim().slice(0, 40),
      String(discordHandle ?? req.user.discord_handle).trim().slice(0, 64),
      String(telegramHandle ?? req.user.telegram_handle).trim().slice(0, 64),
      req.user.id
    );
  res.json({ ok: true });
});

router.post('/forgot-password', authLimiter, (req, res) => {
  const { email } = req.body || {};
  const reset = createPasswordReset(req.db, email);
  // In development, echo reset token cleanly for testing; in production send via email provider
  res.json({
    ok: true,
    message: 'If that email is registered, reset instructions have been prepared.',
    ...(process.env.NODE_ENV !== 'production' && reset ? { devResetToken: reset.rawToken } : {}),
  });
});

router.post('/reset-password', authLimiter, (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  const ok = consumePasswordReset(req.db, token, newPassword);
  if (!ok) {
    return res.status(400).json({ error: 'Reset token is invalid or expired.' });
  }
  res.json({ ok: true });
});

export default router;

