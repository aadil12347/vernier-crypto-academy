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

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { email, password, fullName, country } = req.body || {};
    const userId = await registerUser(req.store, { email, password, fullName, country });
    const { rawToken } = await createSession(req.store, userId);
    setSessionCookie(res, rawToken);
    const user = await req.store.getPublicUserById(userId);
    res.status(201).json({ user: { ...user, max_tier_level: 0, highest_paid_cents: 0, enrollments: [] } });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const user = await req.store.getUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS', requestId: req.requestId });
    }
    const { rawToken } = await createSession(req.store, user.id);
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

router.post('/logout', async (req, res) => {
  if (req.sessionToken) {
    await deleteSession(req.store, req.sessionToken);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: req.user || null });
});

router.patch('/profile', requireAuth, async (req, res) => {
  const { fullName, country, discordHandle, telegramHandle } = req.body || {};
  await req.store.updateUserProfile(req.user.id, {
    fullName: String(fullName || req.user.full_name).trim().slice(0, 80),
    country: String(country || req.user.country).trim().slice(0, 40),
    discordHandle: String(discordHandle ?? req.user.discord_handle).trim().slice(0, 64),
    telegramHandle: String(telegramHandle ?? req.user.telegram_handle).trim().slice(0, 64),
  });
  res.json({ ok: true });
});

router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body || {};
  const reset = await createPasswordReset(req.store, email);
  // In development, echo reset token cleanly for testing; in production send via email provider
  res.json({
    ok: true,
    message: 'If that email is registered, reset instructions have been prepared.',
    ...(process.env.NODE_ENV !== 'production' && reset ? { devResetToken: reset.rawToken } : {}),
  });
});

router.post('/reset-password', authLimiter, async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  const ok = await consumePasswordReset(req.store, token, newPassword);
  if (!ok) {
    return res.status(400).json({ error: 'Reset token is invalid or expired.' });
  }
  res.json({ ok: true });
});

export default router;
