import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './src/config.js';
import { getDb } from './db/connection.js';
import { seedDatabase } from './db/seed.js';
import { attachRequestId, errorHandler } from './src/middleware/errorHandler.js';
import { attachUser } from './src/middleware/auth.js';

import authRoutes from './src/routes/authRoutes.js';
import catalogRoutes from './src/routes/catalogRoutes.js';
import courseRoutes from './src/routes/courseRoutes.js';
import checkoutRoutes from './src/routes/checkoutRoutes.js';
import webhookRoutes from './src/routes/webhookRoutes.js';
import adminRoutes from './src/routes/adminRoutes.js';

export function createApp({ dbPath } = {}) {
  const db = dbPath ? getDb(dbPath) : getDb();
  seedDatabase(db);

  const app = express();
  app.set('trust proxy', 1);
  app.locals.db = db;

  app.use(attachRequestId);

  // Capture raw body for webhook HMAC verification BEFORE JSON parsing
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        if (req.originalUrl && req.originalUrl.startsWith('/api/v1/webhooks')) {
          req.rawBody = buf;
        }
      },
    })
  );

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(attachUser);

  // Healthcheck
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, whopEnabled: config.payments.whopEnabled, sandboxEnabled: config.payments.allowSandbox });
  });

  // REST API routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/catalog', catalogRoutes);
  app.use('/api/v1/course', courseRoutes);
  app.use('/api/v1/checkout', checkoutRoutes);
  app.use('/api/v1/webhooks', webhookRoutes);
  app.use('/api/v1/admin', adminRoutes);

  const publicDir = path.join(config.rootDir, 'public');

  // Clean friendly page routes
  const pageMap = {
    '/': 'index.html',
    '/curriculum': 'curriculum.html',
    '/pricing': 'pricing.html',
    '/checkout': 'checkout.html',
    '/checkout/success': 'checkout-success.html',
    '/checkout/pending': 'checkout-pending.html',
    '/login': 'login.html',
    '/register': 'login.html',
    '/forgot-password': 'login.html',
    '/reset-password': 'login.html',
    '/course': 'course.html',
    '/dashboard': 'dashboard.html',
    '/admin': 'admin.html',
    '/legal/terms': 'legal/terms.html',
    '/legal/privacy': 'legal/privacy.html',
    '/legal/refund': 'legal/refund.html',
    '/legal/risk-disclosure': 'legal/risk-disclosure.html',
  };

  for (const [route, file] of Object.entries(pageMap)) {
    app.get(route, (_req, res) => {
      const fullPath = path.join(publicDir, file);
      if (!fs.existsSync(fullPath)) return res.status(404).send('Page building in progress.');
      res.sendFile(fullPath);
    });
  }

  app.get('/checkout/:tier', (_req, res) => res.sendFile(path.join(publicDir, 'checkout.html')));
  app.get('/verify', (_req, res) => res.sendFile(path.join(publicDir, 'verify.html')));
  app.get('/verify/:serial', (_req, res) => res.sendFile(path.join(publicDir, 'verify.html')));

  // Static files with Express native Accept-Ranges support (for HTML5 video scrubbing)
  app.use(
    express.static(publicDir, {
      acceptRanges: true,
      maxAge: config.nodeEnv === 'production' ? '1d' : 0,
    })
  );

  // Error handler
  app.use(errorHandler);

  return app;
}

const isTestRunner = Boolean(process.env.NODE_TEST_CONTEXT);
const defaultApp = isTestRunner ? null : createApp();

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  defaultApp.listen(config.port, () => {
    console.log(`VERNIER Crypto Academy running on http://localhost:${config.port}`);
  });
}

export default defaultApp;
