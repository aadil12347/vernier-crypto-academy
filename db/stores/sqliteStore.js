import { createSqliteDb } from '../connection.js';
import { runMigrations } from '../migrate.js';
import { config } from '../../src/config.js';

function sanitizeJson(val, fallback) {
  if (val === undefined || val === null) return fallback;
  return typeof val === 'string' ? val : JSON.stringify(val);
}

/**
 * Creates an async Data Store backed by Node's built-in `node:sqlite`.
 * Implements the shared store contract used identically by `firestoreStore.js`.
 */
export function createSqliteStore(dbPath = config.dbPath) {
  const db = createSqliteDb(dbPath);
  let readyPromise = null;

  const init = () => {
    if (!readyPromise) {
      readyPromise = runMigrations(db);
    }
    return readyPromise;
  };

  return {
    dialect: 'sqlite',
    rawDb: db,
    init,

    async close() {
      await db.close();
    },

    // --- Seeding & Catalog Setup ---

    async isCatalogSeeded(expectedLessonCount) {
      await init();
      const lessonStats = await db.queryOne('SELECT COUNT(*) AS cnt FROM lessons');
      const starterPkg = await db.queryOne("SELECT whop_plan_id FROM packages WHERE slug = 'starter-pass'");
      return (
        Number(lessonStats?.cnt || 0) >= expectedLessonCount &&
        Boolean(starterPkg?.whop_plan_id) &&
        !starterPkg.whop_plan_id.includes('placeholder')
      );
    },

    async upsertCatalog({ packages = [], modules = [], lessons = [], coupons = [] }) {
      await init();
      const pkgSql = `
        INSERT INTO packages (slug, name, tier_level, price_cents, tagline, badge_code, features_json, whop_plan_id, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(slug) DO UPDATE SET
          name = excluded.name,
          tier_level = excluded.tier_level,
          price_cents = excluded.price_cents,
          tagline = excluded.tagline,
          badge_code = excluded.badge_code,
          features_json = excluded.features_json,
          whop_plan_id = CASE
            WHEN packages.whop_plan_id IS NULL OR packages.whop_plan_id = '' OR packages.whop_plan_id LIKE '%placeholder%'
            THEN excluded.whop_plan_id
            ELSE packages.whop_plan_id
          END
      `;
      for (const p of packages) {
        await db.execute(pkgSql, [
          p.slug,
          p.name,
          p.tier_level,
          p.price_cents,
          p.tagline,
          p.badge_code,
          sanitizeJson(p.features, '[]'),
          p.whop_plan_id,
        ]);
      }

      const modSql = `
        INSERT INTO modules (min_tier_level, order_index, level_badge, title, slug, summary, estimated_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET
          min_tier_level = excluded.min_tier_level,
          order_index = excluded.order_index,
          level_badge = excluded.level_badge,
          title = excluded.title,
          summary = excluded.summary,
          estimated_minutes = excluded.estimated_minutes
      `;
      for (const m of modules) {
        await db.execute(modSql, [m.min_tier, m.idx, m.level, m.title, m.slug, m.summary, m.mins]);
      }

      const modRows = await db.queryAll('SELECT id, slug FROM modules');
      const modMap = new Map(modRows.map((r) => [r.slug, r.id]));

      const lessonSql = `
        INSERT INTO lessons (module_id, order_index, title, slug, is_free_preview, video_provider, video_url, duration_sec, content_markdown, diagram_config_json, quiz_json, resources_json)
        VALUES (?, ?, ?, ?, ?, 'blueprint', '', ?, ?, ?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET
          module_id = excluded.module_id,
          order_index = excluded.order_index,
          title = excluded.title,
          is_free_preview = excluded.is_free_preview,
          duration_sec = excluded.duration_sec,
          content_markdown = excluded.content_markdown,
          diagram_config_json = excluded.diagram_config_json,
          quiz_json = excluded.quiz_json,
          resources_json = excluded.resources_json
      `;
      for (const l of lessons) {
        const modId = modMap.get(l.mod);
        const resources = l.resources || [
          { label: 'Execution Checklist Sheet', type: 'checklist', slug: l.slug },
          { label: 'Interactive Blueprint Plate', type: 'blueprint', mode: l.diagram?.mode || 'price_action' },
        ];
        await db.execute(lessonSql, [
          modId,
          l.idx,
          l.title,
          l.slug,
          l.preview ? 1 : 0,
          l.dur,
          l.md,
          sanitizeJson(l.diagram, '{}'),
          sanitizeJson(l.quiz, '[]'),
          sanitizeJson(resources, '[]'),
        ]);
      }

      const couponSql = `
        INSERT INTO coupons (code, discount_type, discount_value, min_tier_level, max_uses, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(code) DO NOTHING
      `;
      for (const c of coupons) {
        await db.execute(couponSql, [
          String(c.code).toUpperCase(),
          c.discountType,
          c.discountValue,
          c.minTierLevel,
          c.maxUses,
        ]);
      }
    },

    async ensureSeedUser({ email, passwordHash, fullName, role, country }) {
      const existing = await db.queryOne('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [email]);
      if (existing) return existing.id;
      return db.insertReturningId(
        'INSERT INTO users (email, password_hash, full_name, role, country) VALUES (?, ?, ?, ?, ?)',
        [email.toLowerCase(), passwordHash, fullName, role, country]
      );
    },

    async hasUserEnrollments(userId) {
      const row = await db.queryOne('SELECT COUNT(*) AS c FROM enrollments WHERE user_id = ?', [userId]);
      return Number(row?.c || 0) > 0;
    },

    async seedOrderAndEnrollment({
      orderRef,
      userId,
      packageId,
      tierLevel,
      provider,
      providerPaymentId,
      grossCents,
      finalCents,
      paidAt,
    }) {
      const orderId = await db.insertReturningId(
        `
          INSERT INTO orders (order_ref, user_id, package_id, provider, provider_payment_id, gross_cents, final_cents, status, paid_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?)
        `,
        [orderRef, userId, packageId, provider, providerPaymentId, grossCents, finalCents, paidAt]
      );
      await db.execute(
        "INSERT INTO enrollments (user_id, package_id, tier_level, source_order_id, status) VALUES (?, ?, ?, ?, 'active')",
        [userId, packageId, tierLevel, orderId]
      );
      return orderId;
    },

    async ensureCertificate({ serialCode, userId, tierLevel }) {
      await db.execute(
        `
          INSERT INTO certificates (serial_code, user_id, tier_level) VALUES (?, ?, ?)
          ON CONFLICT(serial_code) DO NOTHING
        `,
        [serialCode, userId, tierLevel]
      );
    },

    async seedJournalEntries(entries = []) {
      for (const e of entries) {
        await db.execute(
          `
            INSERT INTO trade_journal_entries (user_id, pair, direction, entry_price, stop_loss, take_profit, risk_pct, result_r, setup_tag, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            e.userId,
            e.pair,
            e.direction,
            e.entryPrice,
            e.stopLoss,
            e.takeProfit,
            e.riskPct,
            e.resultR,
            e.setupTag,
            e.notes,
          ]
        );
      }
    },

    // --- Users, Auth & Sessions ---

    async getUserById(id) {
      return db.queryOne('SELECT * FROM users WHERE id = ?', [Number(id)]);
    },

    async getPublicUserById(id) {
      return db.queryOne(
        'SELECT id, email, full_name, role, country, discord_handle, telegram_handle, created_at FROM users WHERE id = ?',
        [Number(id)]
      );
    },

    async getUserByEmail(email) {
      return db.queryOne('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [String(email || '').trim()]);
    },

    async createUser({ email, passwordHash, fullName, role = 'student', country = 'US' }) {
      return db.insertReturningId(
        'INSERT INTO users (email, password_hash, full_name, role, country) VALUES (?, ?, ?, ?, ?)',
        [String(email).toLowerCase(), passwordHash, fullName, role, country]
      );
    },

    async updateUserProfile(userId, { fullName, country, discordHandle, telegramHandle }) {
      await db.execute(
        'UPDATE users SET full_name = ?, country = ?, discord_handle = ?, telegram_handle = ? WHERE id = ?',
        [fullName, country, discordHandle, telegramHandle, Number(userId)]
      );
    },

    async createSession({ userId, tokenHash, expiresAt }) {
      await db.execute('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [
        Number(userId),
        tokenHash,
        expiresAt,
      ]);
    },

    async getSessionWithUser(tokenHash) {
      return db.queryOne(
        `
          SELECT u.id, u.email, u.full_name, u.role, u.country, u.discord_handle, u.telegram_handle, u.created_at,
                 s.expires_at
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ?
        `,
        [tokenHash]
      );
    },

    async deleteSession(tokenHash) {
      await db.execute('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
    },

    async getUserEntitlementSummary(userId) {
      const enrollments = await db.queryAll(
        `
          SELECT e.id, e.tier_level, e.status, e.granted_at, p.slug, p.name, p.price_cents
          FROM enrollments e
          JOIN packages p ON p.id = e.package_id
          WHERE e.user_id = ? AND e.status = 'active'
          ORDER BY e.tier_level DESC
        `,
        [Number(userId)]
      );
      const maxTier = enrollments.reduce((max, e) => Math.max(max, Number(e.tier_level || 0)), 0);
      const highestPaidCents = enrollments.reduce((max, e) => Math.max(max, Number(e.price_cents || 0)), 0);
      return { maxTier, highestPaidCents, enrollments };
    },

    async createPasswordReset({ userId, tokenHash, expiresAt }) {
      await db.execute('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [
        Number(userId),
        tokenHash,
        expiresAt,
      ]);
    },

    async consumePasswordResetTransaction({ tokenHash, newPasswordHash, usedAt }) {
      const row = await db.queryOne(
        'SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?',
        [tokenHash]
      );
      if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) {
        return false;
      }
      await db.transaction(async (tx) => {
        await tx.execute('UPDATE users SET password_hash = ? WHERE id = ?', [newPasswordHash, row.user_id]);
        await tx.execute('UPDATE password_resets SET used_at = ? WHERE id = ?', [usedAt, row.id]);
        await tx.execute('DELETE FROM sessions WHERE user_id = ?', [row.user_id]);
      });
      return true;
    },

    // --- Catalog & Course ---

    async listActivePackages() {
      return db.queryAll('SELECT * FROM packages WHERE is_active = 1 ORDER BY tier_level ASC');
    },

    async getPackageBySlug(slug, { activeOnly = false } = {}) {
      const sql = activeOnly
        ? 'SELECT * FROM packages WHERE slug = ? AND is_active = 1'
        : 'SELECT * FROM packages WHERE slug = ?';
      return db.queryOne(sql, [String(slug || '').trim()]);
    },

    async getPackageById(id) {
      return db.queryOne('SELECT * FROM packages WHERE id = ?', [Number(id)]);
    },

    async getPackageByTier(tierLevel) {
      return db.queryOne('SELECT * FROM packages WHERE tier_level = ?', [Number(tierLevel)]);
    },

    async getPackageByWhopPlanId(planId) {
      return db.queryOne('SELECT * FROM packages WHERE whop_plan_id = ?', [String(planId || '').trim()]);
    },

    async listModules() {
      return db.queryAll('SELECT * FROM modules ORDER BY order_index ASC');
    },

    async listLessons({ sortByModule = false } = {}) {
      const order = sortByModule ? 'module_id ASC, order_index ASC' : 'order_index ASC';
      return db.queryAll(`SELECT * FROM lessons ORDER BY ${order}`);
    },

    async getLessonBySlugWithModule(slug) {
      return db.queryOne(
        `
          SELECT l.*, m.title AS module_title, m.slug AS module_slug, m.min_tier_level, m.level_badge
          FROM lessons l
          JOIN modules m ON m.id = l.module_id
          WHERE l.slug = ?
        `,
        [String(slug || '').trim()]
      );
    },

    async getLessonById(id) {
      return db.queryOne('SELECT * FROM lessons WHERE id = ?', [Number(id)]);
    },

    async getNextModuleLessonOrderIndex(moduleId) {
      const row = await db.queryOne('SELECT COALESCE(MAX(order_index), 0) AS m FROM lessons WHERE module_id = ?', [
        Number(moduleId),
      ]);
      return Number(row?.m || 0) + 1;
    },

    async createLesson({ moduleId, orderIndex, title, slug, isFreePreview, videoUrl, contentMarkdown }) {
      const lessonId = await db.insertReturningId(
        `
          INSERT INTO lessons (module_id, order_index, title, slug, is_free_preview, video_url, content_markdown)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          RETURNING id
        `,
        [Number(moduleId), Number(orderIndex), title, slug, isFreePreview ? 1 : 0, videoUrl, contentMarkdown]
      );
      return db.queryOne('SELECT * FROM lessons WHERE id = ?', [lessonId]);
    },

    async updateLesson(id, { title, videoUrl, isFreePreview, contentMarkdown }) {
      await db.execute(
        'UPDATE lessons SET title = ?, video_url = ?, is_free_preview = ?, content_markdown = ? WHERE id = ?',
        [title, videoUrl, isFreePreview ? 1 : 0, contentMarkdown, Number(id)]
      );
    },

    async listUserLessonProgress(userId) {
      return db.queryAll('SELECT * FROM lesson_progress WHERE user_id = ?', [Number(userId)]);
    },

    async getLessonProgress(userId, lessonId) {
      return db.queryOne(
        'SELECT completed, watched_seconds, quiz_passed, notes_text FROM lesson_progress WHERE user_id = ? AND lesson_id = ?',
        [Number(userId), Number(lessonId)]
      );
    },

    async upsertLessonProgress({ userId, lessonId, completed, watchedSeconds, quizPassed, notesText, updatedAt }) {
      await db.execute(
        `
          INSERT INTO lesson_progress (user_id, lesson_id, completed, watched_seconds, quiz_passed, notes_text, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, lesson_id) DO UPDATE SET
            completed = excluded.completed,
            watched_seconds = excluded.watched_seconds,
            quiz_passed = excluded.quiz_passed,
            notes_text = excluded.notes_text,
            updated_at = excluded.updated_at
        `,
        [Number(userId), Number(lessonId), completed ? 1 : 0, watchedSeconds, quizPassed ? 1 : 0, notesText, updatedAt]
      );
    },

    async getUserTierCompletionStats(userId, tierLevel) {
      const stats = await db.queryOne(
        `
          SELECT COUNT(*) AS total_lessons,
                 SUM(CASE WHEN COALESCE(lp.completed, 0) = 1 THEN 1 ELSE 0 END) AS completed_lessons
          FROM lessons l
          JOIN modules m ON m.id = l.module_id
          LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = ?
          WHERE m.min_tier_level <= ?
        `,
        [Number(userId), Number(tierLevel)]
      );
      return {
        totalLessons: Number(stats?.total_lessons || 0),
        completedLessons: Number(stats?.completed_lessons || 0),
      };
    },

    // --- Coupons & Checkout / Orders ---

    async getCouponByCode(code, { activeOnly = false } = {}) {
      const clean = String(code || '').trim().toUpperCase();
      const sql = activeOnly
        ? 'SELECT * FROM coupons WHERE UPPER(code) = UPPER(?) AND is_active = 1'
        : 'SELECT * FROM coupons WHERE UPPER(code) = UPPER(?)';
      return db.queryOne(sql, [clean]);
    },

    async listCoupons() {
      return db.queryAll('SELECT * FROM coupons ORDER BY code ASC');
    },

    async upsertCoupon({ code, discountType, discountValue, minTierLevel, maxUses }) {
      await db.execute(
        `
          INSERT INTO coupons (code, discount_type, discount_value, min_tier_level, max_uses)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(code) DO UPDATE SET
            discount_type = excluded.discount_type,
            discount_value = excluded.discount_value,
            min_tier_level = excluded.min_tier_level,
            max_uses = excluded.max_uses,
            is_active = 1
        `,
        [String(code).toUpperCase(), discountType, Number(discountValue), Number(minTierLevel), Number(maxUses)]
      );
    },

    async createOrder({
      orderRef,
      userId,
      packageId,
      provider,
      providerPaymentId = '',
      grossCents,
      upgradeCreditCents = 0,
      discountCents = 0,
      finalCents,
      currency = 'USD',
      couponCode = '',
      status = 'pending',
      proofText = '',
      metadataJson = '{}',
    }) {
      await db.execute(
        `
          INSERT INTO orders (
            order_ref, user_id, package_id, provider, provider_payment_id, gross_cents,
            upgrade_credit_cents, discount_cents, final_cents, currency, coupon_code, status, proof_text, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          orderRef,
          Number(userId),
          Number(packageId),
          provider,
          providerPaymentId,
          grossCents,
          upgradeCreditCents,
          discountCents,
          finalCents,
          currency,
          couponCode,
          status,
          proofText,
          metadataJson,
        ]
      );
      return db.queryOne('SELECT * FROM orders WHERE order_ref = ?', [orderRef]);
    },

    async getOrderByRef(orderRef) {
      return db.queryOne('SELECT * FROM orders WHERE order_ref = ?', [String(orderRef || '').trim()]);
    },

    async getOrderById(id) {
      return db.queryOne('SELECT * FROM orders WHERE id = ?', [Number(id)]);
    },

    async getOrderByPaymentId(paymentId) {
      return db.queryOne('SELECT * FROM orders WHERE provider_payment_id = ?', [String(paymentId || '').trim()]);
    },

    async getOrderStatusDetails(refOrPaymentId) {
      const ref = String(refOrPaymentId || '').trim();
      return db.queryOne(
        `
          SELECT o.order_ref, o.provider, o.provider_payment_id, o.gross_cents, o.upgrade_credit_cents, o.discount_cents,
                 o.final_cents, o.currency, o.status, o.proof_text, o.created_at, o.paid_at,
                 o.metadata_json, p.slug AS package_slug, p.name AS package_name, p.tier_level
          FROM orders o
          JOIN packages p ON p.id = o.package_id
          WHERE o.order_ref = ? OR o.provider_payment_id = ?
          ORDER BY o.id DESC
          LIMIT 1
        `,
        [ref, ref]
      );
    },

    async listUserOrdersWithPackage(userId) {
      return db.queryAll(
        `
          SELECT o.order_ref, o.provider, o.final_cents, o.status, o.created_at, o.paid_at, p.name AS package_name, p.tier_level
          FROM orders o
          JOIN packages p ON p.id = o.package_id
          WHERE o.user_id = ?
          ORDER BY o.created_at DESC
        `,
        [Number(userId)]
      );
    },

    async updateOrderPaymentMeta(orderId, { providerPaymentId, metadataJson }) {
      await db.execute('UPDATE orders SET provider_payment_id = ?, metadata_json = ? WHERE id = ?', [
        providerPaymentId,
        metadataJson,
        Number(orderId),
      ]);
    },

    async markOrderDeclined(orderId, proofText) {
      await db.execute("UPDATE orders SET status = 'failed', proof_text = ? WHERE id = ?", [
        proofText,
        Number(orderId),
      ]);
    },

    async markOrderAwaitingReview(orderId, proofText) {
      await db.execute("UPDATE orders SET status = 'awaiting_review', proof_text = ? WHERE id = ?", [
        proofText,
        Number(orderId),
      ]);
    },

    async rejectPendingOrder(orderId, rejectSuffix) {
      return db.execute(
        "UPDATE orders SET status = 'failed', proof_text = COALESCE(proof_text, '') || ? WHERE id = ? AND status IN ('pending', 'awaiting_review')",
        [rejectSuffix, Number(orderId)]
      );
    },

    async settleOrderTransaction({ orderRef, providerPaymentId = '', metadata = {} }) {
      const order = await db.queryOne('SELECT * FROM orders WHERE order_ref = ?', [orderRef]);
      if (!order) {
        const err = new Error(`Order ${orderRef} not found.`);
        err.status = 404;
        throw err;
      }
      if (order.status === 'paid') {
        return { order, alreadySettled: true };
      }
      const pkg = await db.queryOne('SELECT * FROM packages WHERE id = ?', [order.package_id]);
      const nowIso = new Date().toISOString();

      await db.transaction(async (tx) => {
        const mergedMeta = { ...JSON.parse(order.metadata_json || '{}'), ...metadata };
        await tx.execute(
          `
            UPDATE orders
            SET status = 'paid',
                provider_payment_id = COALESCE(NULLIF(?, ''), provider_payment_id),
                metadata_json = ?,
                paid_at = COALESCE(paid_at, ?)
            WHERE id = ?
          `,
          [providerPaymentId, JSON.stringify(mergedMeta), nowIso, order.id]
        );

        if (order.coupon_code) {
          await tx.execute('UPDATE coupons SET used_count = used_count + 1 WHERE UPPER(code) = UPPER(?)', [
            order.coupon_code,
          ]);
        }

        await tx.execute(
          "UPDATE enrollments SET status = 'upgraded' WHERE user_id = ? AND status = 'active' AND tier_level < ?",
          [order.user_id, pkg.tier_level]
        );

        const existingSameTier = await tx.queryOne(
          "SELECT id FROM enrollments WHERE user_id = ? AND package_id = ? AND status = 'active'",
          [order.user_id, pkg.id]
        );
        if (!existingSameTier) {
          await tx.execute(
            "INSERT INTO enrollments (user_id, package_id, tier_level, source_order_id, status) VALUES (?, ?, ?, ?, 'active')",
            [order.user_id, pkg.id, pkg.tier_level, order.id]
          );
        }
      });

      return {
        order: await db.queryOne('SELECT * FROM orders WHERE id = ?', [order.id]),
        alreadySettled: false,
      };
    },

    async refundOrderTransaction({ orderId, reason = 'Refunded' }) {
      const order = await db.queryOne('SELECT * FROM orders WHERE id = ?', [Number(orderId)]);
      if (!order) {
        const err = new Error('Order not found.');
        err.status = 404;
        throw err;
      }

      await db.transaction(async (tx) => {
        const meta = { ...JSON.parse(order.metadata_json || '{}'), refund_reason: reason };
        await tx.execute("UPDATE orders SET status = 'refunded', metadata_json = ? WHERE id = ?", [
          JSON.stringify(meta),
          order.id,
        ]);

        await tx.execute("UPDATE enrollments SET status = 'revoked' WHERE source_order_id = ?", [order.id]);

        const activeRemaining = await tx.queryOne(
          "SELECT id FROM enrollments WHERE user_id = ? AND status = 'active' LIMIT 1",
          [order.user_id]
        );
        if (!activeRemaining) {
          const priorEnrollment = await tx.queryOne(
            `
              SELECT e.id FROM enrollments e
              JOIN orders o ON o.id = e.source_order_id
              WHERE e.user_id = ? AND e.status = 'upgraded' AND o.status = 'paid'
              ORDER BY e.tier_level DESC
              LIMIT 1
            `,
            [order.user_id]
          );
          if (priorEnrollment) {
            await tx.execute("UPDATE enrollments SET status = 'active' WHERE id = ?", [priorEnrollment.id]);
          }
        }
      });

      return db.queryOne('SELECT * FROM orders WHERE id = ?', [order.id]);
    },

    async grantManualTierTransaction({ userId, packageSlug, orderRef, adminId, note = 'Manual admin grant' }) {
      const pkg = await db.queryOne('SELECT * FROM packages WHERE slug = ?', [packageSlug]);
      if (!pkg) {
        const err = new Error('Package not found.');
        err.status = 404;
        throw err;
      }
      const nowIso = new Date().toISOString();

      await db.transaction(async (tx) => {
        const insertedId = await tx.insertReturningId(
          `
            INSERT INTO orders (
              order_ref, user_id, package_id, provider, provider_payment_id,
              gross_cents, upgrade_credit_cents, discount_cents, final_cents,
              currency, status, proof_text, metadata_json, paid_at
            ) VALUES (?, ?, ?, 'admin_grant', ?, ?, 0, ?, 0, 'USD', 'paid', ?, ?, ?)
          `,
          [
            orderRef,
            Number(userId),
            pkg.id,
            `ADMIN-${adminId}`,
            pkg.price_cents,
            pkg.price_cents,
            note,
            JSON.stringify({ granted_by_admin: adminId, note }),
            nowIso,
          ]
        );

        await tx.execute(
          "UPDATE enrollments SET status = 'upgraded' WHERE user_id = ? AND status = 'active' AND tier_level < ?",
          [Number(userId), pkg.tier_level]
        );

        const activeSame = await tx.queryOne(
          "SELECT id FROM enrollments WHERE user_id = ? AND package_id = ? AND status = 'active'",
          [Number(userId), pkg.id]
        );
        if (!activeSame) {
          await tx.execute(
            "INSERT INTO enrollments (user_id, package_id, tier_level, source_order_id, status) VALUES (?, ?, ?, ?, 'active')",
            [Number(userId), pkg.id, pkg.tier_level, insertedId]
          );
        }
      });
      return orderRef;
    },

    // --- Webhooks ---

    async getWebhookEvent(eventId) {
      return db.queryOne('SELECT * FROM webhook_events WHERE event_id = ?', [eventId]);
    },

    async createWebhookEvent({
      provider,
      eventId,
      eventType,
      signatureValid,
      payloadJson,
      processed = 0,
      errorMessage = '',
    }) {
      const existing = await db.queryOne('SELECT * FROM webhook_events WHERE event_id = ?', [eventId]);
      if (existing) {
        return { created: false, event: existing };
      }
      await db.execute(
        `
          INSERT INTO webhook_events (provider, event_id, event_type, signature_valid, payload_json, processed, error_message)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [provider, eventId, eventType, signatureValid ? 1 : 0, payloadJson, processed ? 1 : 0, errorMessage || null]
      );
      const createdRow = await db.queryOne('SELECT * FROM webhook_events WHERE event_id = ?', [eventId]);
      return { created: true, event: createdRow };
    },

    async updateWebhookEvent(eventId, { processed, errorMessage }) {
      if (processed !== undefined && errorMessage !== undefined) {
        await db.execute('UPDATE webhook_events SET processed = ?, error_message = ? WHERE event_id = ?', [
          processed ? 1 : 0,
          errorMessage,
          eventId,
        ]);
      } else if (processed !== undefined) {
        await db.execute('UPDATE webhook_events SET processed = ? WHERE event_id = ?', [
          processed ? 1 : 0,
          eventId,
        ]);
      } else if (errorMessage !== undefined) {
        await db.execute('UPDATE webhook_events SET error_message = ? WHERE event_id = ?', [errorMessage, eventId]);
      }
    },

    async listWebhookEventsAdmin() {
      return db.queryAll('SELECT * FROM webhook_events ORDER BY id DESC LIMIT 100');
    },

    // --- Journal, Certificates, Audits & Admin ---

    async listJournalEntries(userId) {
      return db.queryAll(
        'SELECT * FROM trade_journal_entries WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 200',
        [Number(userId)]
      );
    },

    async getUserJournalSummary(userId) {
      const row = await db.queryOne(
        `
          SELECT COUNT(*) AS total_trades,
                 SUM(CASE WHEN result_r > 0 THEN 1 ELSE 0 END) AS wins,
                 COALESCE(SUM(result_r), 0) AS net_r
          FROM trade_journal_entries
          WHERE user_id = ?
        `,
        [Number(userId)]
      );
      return {
        totalTrades: Number(row?.total_trades || 0),
        wins: Number(row?.wins || 0),
        netR: Number(row?.net_r || 0),
      };
    },

    async createJournalEntry({
      userId,
      pair,
      direction,
      entryPrice,
      stopLoss,
      takeProfit,
      riskPct,
      resultR,
      setupTag,
      notes,
    }) {
      const id = await db.insertReturningId(
        `
          INSERT INTO trade_journal_entries (user_id, pair, direction, entry_price, stop_loss, take_profit, risk_pct, result_r, setup_tag, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id
        `,
        [Number(userId), pair, direction, entryPrice, stopLoss, takeProfit, riskPct, resultR, setupTag, notes]
      );
      return db.queryOne('SELECT * FROM trade_journal_entries WHERE id = ?', [id]);
    },

    async deleteJournalEntry(entryId, userId) {
      return db.execute('DELETE FROM trade_journal_entries WHERE id = ? AND user_id = ?', [
        Number(entryId),
        Number(userId),
      ]);
    },

    async getCertificateBySerialWithDetails(serialCode) {
      return db.queryOne(
        `
          SELECT c.serial_code, c.tier_level, c.issued_at, u.full_name, p.name AS package_name
          FROM certificates c
          JOIN users u ON u.id = c.user_id
          JOIN packages p ON p.tier_level = c.tier_level
          WHERE c.serial_code = ?
        `,
        [String(serialCode || '').trim().toUpperCase()]
      );
    },

    async getCertificateForUserTier(userId, tierLevel) {
      return db.queryOne('SELECT * FROM certificates WHERE user_id = ? AND tier_level = ?', [
        Number(userId),
        Number(tierLevel),
      ]);
    },

    async listUserCertificates(userId) {
      return db.queryAll(
        'SELECT serial_code, tier_level, issued_at FROM certificates WHERE user_id = ? ORDER BY tier_level DESC',
        [Number(userId)]
      );
    },

    async createCertificate({ serialCode, userId, tierLevel }) {
      await db.execute('INSERT INTO certificates (serial_code, user_id, tier_level) VALUES (?, ?, ?)', [
        serialCode,
        Number(userId),
        Number(tierLevel),
      ]);
      return db.queryOne('SELECT * FROM certificates WHERE serial_code = ?', [serialCode]);
    },

    async createAudit({ userId, portfolioSizeUsd, focusPair, questionText }) {
      const id = await db.insertReturningId(
        'INSERT INTO mentorship_audits (user_id, portfolio_size_usd, focus_pair, question_text) VALUES (?, ?, ?, ?) RETURNING id',
        [Number(userId), Number(portfolioSizeUsd), focusPair, questionText]
      );
      return db.queryOne('SELECT * FROM mentorship_audits WHERE id = ?', [id]);
    },

    async listAuditsForUser(userId) {
      return db.queryAll('SELECT * FROM mentorship_audits WHERE user_id = ? ORDER BY created_at DESC', [
        Number(userId),
      ]);
    },

    async listAllAuditsWithUsers() {
      return db.queryAll(`
        SELECT ma.*, u.email, u.full_name
        FROM mentorship_audits ma JOIN users u ON u.id = ma.user_id
        ORDER BY ma.id DESC LIMIT 100
      `);
    },

    async reviewAudit(auditId, mentorFeedback) {
      await db.execute("UPDATE mentorship_audits SET mentor_feedback = ?, status = 'reviewed' WHERE id = ?", [
        mentorFeedback,
        Number(auditId),
      ]);
    },

    async getAdminOverview() {
      const revRow = await db.queryOne(
        "SELECT COUNT(*) AS paid_orders, COALESCE(SUM(final_cents), 0) AS total_cents FROM orders WHERE status = 'paid'"
      );
      const pendingRow = await db.queryOne("SELECT COUNT(*) AS cnt FROM orders WHERE status = 'awaiting_review'");
      const studentsRow = await db.queryOne("SELECT COUNT(*) AS cnt FROM users WHERE role = 'student'");
      const byTierRows = await db.queryAll(`
        SELECT p.slug, p.name, p.tier_level, p.price_cents,
               COUNT(o.id) AS orders_count,
               COALESCE(SUM(o.final_cents), 0) AS revenue_cents
        FROM packages p
        LEFT JOIN orders o ON o.package_id = p.id AND o.status = 'paid'
        GROUP BY p.id, p.slug, p.name, p.tier_level, p.price_cents
        ORDER BY p.tier_level ASC
      `);
      return {
        paidOrders: Number(revRow?.paid_orders || 0),
        totalRevenueCents: Number(revRow?.total_cents || 0),
        awaitingReview: Number(pendingRow?.cnt || 0),
        totalStudents: Number(studentsRow?.cnt || 0),
        byTier: byTierRows.map((row) => ({
          ...row,
          orders_count: Number(row.orders_count || 0),
          revenue_cents: Number(row.revenue_cents || 0),
        })),
      };
    },

    async listOrdersAdmin({ status = '', q = '' } = {}) {
      let sql = `
        SELECT o.*, u.email AS student_email, u.full_name AS student_name,
               p.name AS package_name, p.tier_level, p.slug AS package_slug
        FROM orders o
        JOIN users u ON u.id = o.user_id
        JOIN packages p ON p.id = o.package_id
        WHERE 1=1
      `;
      const params = [];
      if (status) {
        sql += ' AND o.status = ?';
        params.push(status);
      }
      if (q) {
        const lower = q.toLowerCase();
        sql += " AND (LOWER(o.order_ref) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(COALESCE(o.proof_text, '')) LIKE ?)";
        params.push(`%${lower}%`, `%${lower}%`, `%${lower}%`);
      }
      sql += ' ORDER BY o.id DESC LIMIT 200';
      return db.queryAll(sql, params);
    },

    async listStudentsAdmin() {
      const rows = await db.queryAll(`
        SELECT u.id, u.email, u.full_name, u.country, u.discord_handle, u.telegram_handle, u.created_at,
               COALESCE(MAX(CASE WHEN e.status = 'active' THEN e.tier_level ELSE 0 END), 0) AS active_tier,
               (SELECT COUNT(*) FROM lesson_progress lp WHERE lp.user_id = u.id AND lp.completed = 1) AS completed_lessons
        FROM users u
        LEFT JOIN enrollments e ON e.user_id = u.id
        WHERE u.role = 'student'
        GROUP BY u.id, u.email, u.full_name, u.country, u.discord_handle, u.telegram_handle, u.created_at
        ORDER BY u.id DESC
        LIMIT 200
      `);
      return rows.map((s) => ({
        ...s,
        active_tier: Number(s.active_tier || 0),
        completed_lessons: Number(s.completed_lessons || 0),
      }));
    },
  };
}

