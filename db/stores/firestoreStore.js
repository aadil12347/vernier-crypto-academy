function safeWebhookDocId(eventId) {
  return `evt_${Buffer.from(String(eventId || '')).toString('base64url')}`;
}

function sanitizeJson(val, fallback) {
  if (val === undefined || val === null) return fallback;
  return typeof val === 'string' ? val : JSON.stringify(val);
}

function byNumAsc(key) {
  return (a, b) => Number(a?.[key] || 0) - Number(b?.[key] || 0);
}

function byNumDesc(key) {
  return (a, b) => Number(b?.[key] || 0) - Number(a?.[key] || 0);
}

function byIsoDesc(key, tieBreakerIdKey = 'id') {
  return (a, b) => {
    const diff = new Date(b?.[key] || 0).getTime() - new Date(a?.[key] || 0).getTime();
    if (diff !== 0) return diff;
    return Number(b?.[tieBreakerIdKey] || 0) - Number(a?.[tieBreakerIdKey] || 0);
  };
}

/**
 * Creates a Data Store backed natively by Google Cloud Firestore (`firebase-admin/firestore`
 * or compatible test double). Maintains strict parity with `sqliteStore.js`.
 */
export function createFirestoreStore(firestore) {
  if (!firestore) {
    throw new Error('createFirestoreStore requires a Firestore instance.');
  }

  const col = (name) => firestore.collection(name);
  const countersRef = col('_meta').doc('counters');
  const seedStateRef = col('_meta').doc('seed_state');

  const init = async () => {};

  async function readAll(name) {
    const snap = await col(name).get();
    return snap.docs.map((d) => d.data());
  }

  async function queryByField(name, field, value, { limit = 0 } = {}) {
    let q = col(name).where(field, '==', value);
    if (limit > 0) q = q.limit(limit);
    const snap = await q.get();
    return snap.docs.map((d) => d.data());
  }

  async function allocateId(counterKey) {
    return firestore.runTransaction(async (tx) => {
      const snap = await tx.get(countersRef);
      const data = snap.exists ? snap.data() : {};
      const next = Number(data?.[counterKey] || 0) + 1;
      tx.set(countersRef, { [counterKey]: next }, { merge: true });
      return next;
    });
  }

  async function commitBatchedWrites(ops) {
    // Firestore enforces a hard limit of 500 writes per batch
    for (let i = 0; i < ops.length; i += 400) {
      const chunk = ops.slice(i, i + 400);
      const batch = firestore.batch();
      for (const op of chunk) {
        if (op.type === 'set') {
          batch.set(op.ref, op.data, op.options || {});
        } else if (op.type === 'update') {
          batch.update(op.ref, op.data);
        } else if (op.type === 'delete') {
          batch.delete(op.ref);
        }
      }
      await batch.commit();
    }
  }

  return {
    dialect: 'firestore',
    firestore,
    init,

    async close() {
      // Firestore client lifecycle is managed via db/firebaseClient.js
    },

    // --- Seeding & Catalog Setup ---

    async isCatalogSeeded(expectedLessonCount) {
      const [lessonsSnap, starterSnap] = await Promise.all([
        col('lessons').get(),
        col('packages').doc('starter-pass').get(),
      ]);
      const starter = starterSnap.exists ? starterSnap.data() : null;
      return (
        lessonsSnap.docs.length >= expectedLessonCount &&
        Boolean(starter?.whop_plan_id) &&
        !String(starter.whop_plan_id).includes('placeholder')
      );
    },

    async upsertCatalog({ packages = [], modules = [], lessons = [], coupons = [] }) {
      const [existingPkgs, existingMods, existingLessons, existingCoupons, countersSnap] = await Promise.all([
        readAll('packages'),
        readAll('modules'),
        readAll('lessons'),
        readAll('coupons'),
        countersRef.get(),
      ]);

      const counters = countersSnap.exists ? { ...countersSnap.data() } : {};
      let pkgCounter = Number(counters.packages || existingPkgs.reduce((m, p) => Math.max(m, Number(p.id || 0)), 0));
      let modCounter = Number(counters.modules || existingMods.reduce((m, x) => Math.max(m, Number(x.id || 0)), 0));
      let lessonCounter = Number(counters.lessons || existingLessons.reduce((m, l) => Math.max(m, Number(l.id || 0)), 0));

      const pkgBySlug = new Map(existingPkgs.map((p) => [p.slug, p]));
      const modBySlug = new Map(existingMods.map((m) => [m.slug, m]));
      const lessonBySlug = new Map(existingLessons.map((l) => [l.slug, l]));
      const couponByCode = new Map(existingCoupons.map((c) => [String(c.code).toUpperCase(), c]));

      const ops = [];

      for (const p of packages) {
        const existing = pkgBySlug.get(p.slug);
        const id = existing ? Number(existing.id) : ++pkgCounter;
        const existingPlan = String(existing?.whop_plan_id || '');
        const keepExistingPlan = existingPlan && !existingPlan.includes('placeholder');
        const docData = {
          id,
          slug: p.slug,
          name: p.name,
          tier_level: Number(p.tier_level),
          price_cents: Number(p.price_cents),
          tagline: p.tagline || '',
          badge_code: p.badge_code || '',
          features_json: sanitizeJson(p.features, '[]'),
          whop_plan_id: keepExistingPlan ? existingPlan : p.whop_plan_id || '',
          lemon_variant_id: existing?.lemon_variant_id || '',
          is_active: 1,
        };
        ops.push({ type: 'set', ref: col('packages').doc(p.slug), data: docData });
      }

      for (const m of modules) {
        const existing = modBySlug.get(m.slug);
        const id = existing ? Number(existing.id) : ++modCounter;
        const modDoc = {
          id,
          min_tier_level: Number(m.min_tier),
          order_index: Number(m.idx),
          level_badge: m.level,
          title: m.title,
          slug: m.slug,
          summary: m.summary || '',
          estimated_minutes: Number(m.mins || 35),
        };
        modBySlug.set(m.slug, modDoc);
        ops.push({ type: 'set', ref: col('modules').doc(m.slug), data: modDoc });
      }

      for (const l of lessons) {
        const existing = lessonBySlug.get(l.slug);
        const id = existing ? Number(existing.id) : ++lessonCounter;
        const modDoc = modBySlug.get(l.mod);
        const resources = l.resources || [
          { label: 'Execution Checklist Sheet', type: 'checklist', slug: l.slug },
          { label: 'Interactive Blueprint Plate', type: 'blueprint', mode: l.diagram?.mode || 'price_action' },
        ];
        const lessonDoc = {
          id,
          module_id: modDoc ? Number(modDoc.id) : 0,
          order_index: Number(l.idx),
          title: l.title,
          slug: l.slug,
          is_free_preview: l.preview ? 1 : 0,
          video_provider: 'blueprint',
          video_url: existing?.video_url || '',
          duration_sec: Number(l.dur || 600),
          content_markdown: l.md || '',
          diagram_config_json: sanitizeJson(l.diagram, '{}'),
          quiz_json: sanitizeJson(l.quiz, '[]'),
          resources_json: sanitizeJson(resources, '[]'),
        };
        ops.push({ type: 'set', ref: col('lessons').doc(l.slug), data: lessonDoc });
      }

      for (const c of coupons) {
        const clean = String(c.code).toUpperCase();
        if (couponByCode.has(clean)) continue;
        ops.push({
          type: 'set',
          ref: col('coupons').doc(clean),
          data: {
            code: clean,
            discount_type: c.discountType,
            discount_value: Number(c.discountValue),
            min_tier_level: Number(c.minTierLevel),
            max_uses: Number(c.maxUses),
            used_count: 0,
            valid_until: null,
            is_active: 1,
          },
        });
      }

      ops.push({
        type: 'set',
        ref: countersRef,
        data: { packages: pkgCounter, modules: modCounter, lessons: lessonCounter },
        options: { merge: true },
      });
      ops.push({
        type: 'set',
        ref: seedStateRef,
        data: {
          seeded_lessons_count: lessons.length,
          updated_at: new Date().toISOString(),
        },
        options: { merge: true },
      });

      await commitBatchedWrites(ops);
    },

    async ensureSeedUser({ email, passwordHash, fullName, role, country }) {
      const cleanEmail = String(email).trim().toLowerCase();
      const existing = await this.getUserByEmail(cleanEmail);
      if (existing) return existing.id;
      return this.createUser({ email: cleanEmail, passwordHash, fullName, role, country });
    },

    async hasUserEnrollments(userId) {
      const rows = await queryByField('enrollments', 'user_id', Number(userId), { limit: 1 });
      return rows.length > 0;
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
      const orderId = await allocateId('orders');
      const enrollmentId = await allocateId('enrollments');
      const nowIso = new Date().toISOString();

      await col('orders').doc(String(orderId)).set({
        id: orderId,
        order_ref: orderRef,
        user_id: Number(userId),
        package_id: Number(packageId),
        provider,
        provider_payment_id: providerPaymentId,
        gross_cents: Number(grossCents),
        upgrade_credit_cents: 0,
        discount_cents: 0,
        final_cents: Number(finalCents),
        currency: 'USD',
        coupon_code: '',
        status: 'paid',
        proof_text: '',
        metadata_json: '{}',
        created_at: paidAt || nowIso,
        paid_at: paidAt || nowIso,
      });

      await col('enrollments').doc(String(enrollmentId)).set({
        id: enrollmentId,
        user_id: Number(userId),
        package_id: Number(packageId),
        tier_level: Number(tierLevel),
        source_order_id: orderId,
        status: 'active',
        granted_at: paidAt || nowIso,
      });

      return orderId;
    },

    async ensureCertificate({ serialCode, userId, tierLevel }) {
      const clean = String(serialCode).trim().toUpperCase();
      const docRef = col('certificates').doc(clean);
      const snap = await docRef.get();
      if (snap.exists) return snap.data();
      return this.createCertificate({ serialCode: clean, userId, tierLevel });
    },

    async seedJournalEntries(entries = []) {
      const ops = [];
      for (const e of entries) {
        const id = await allocateId('trade_journal_entries');
        ops.push({
          type: 'set',
          ref: col('trade_journal_entries').doc(String(id)),
          data: {
            id,
            user_id: Number(e.userId),
            pair: e.pair,
            direction: e.direction,
            entry_price: Number(e.entryPrice),
            stop_loss: Number(e.stopLoss),
            take_profit: Number(e.takeProfit),
            risk_pct: Number(e.riskPct),
            result_r: Number(e.resultR),
            setup_tag: e.setupTag || '',
            notes: e.notes || '',
            created_at: new Date().toISOString(),
          },
        });
      }
      if (ops.length > 0) await commitBatchedWrites(ops);
    },

    // --- Users, Auth & Sessions ---

    async getUserById(id) {
      const snap = await col('users').doc(String(Number(id))).get();
      return snap.exists ? snap.data() : null;
    },

    async getPublicUserById(id) {
      const user = await this.getUserById(id);
      if (!user) return null;
      const { password_hash: _ignored, ...pub } = user;
      return pub;
    },

    async getUserByEmail(email) {
      const clean = String(email || '').trim().toLowerCase();
      if (!clean) return null;
      const rows = await queryByField('users', 'email', clean, { limit: 1 });
      return rows[0] || null;
    },

    async createUser({ email, passwordHash, fullName, role = 'student', country = 'US' }) {
      const id = await allocateId('users');
      const nowIso = new Date().toISOString();
      await col('users').doc(String(id)).set({
        id,
        email: String(email).trim().toLowerCase(),
        password_hash: passwordHash,
        full_name: fullName,
        role,
        country,
        discord_handle: '',
        telegram_handle: '',
        created_at: nowIso,
      });
      return id;
    },

    async updateUserProfile(userId, { fullName, country, discordHandle, telegramHandle }) {
      await col('users').doc(String(Number(userId))).update({
        full_name: fullName,
        country,
        discord_handle: discordHandle,
        telegram_handle: telegramHandle,
      });
    },

    async createSession({ userId, tokenHash, expiresAt }) {
      const id = await allocateId('sessions');
      await col('sessions').doc(tokenHash).set({
        id,
        user_id: Number(userId),
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
      });
    },

    async getSessionWithUser(tokenHash) {
      const sessionSnap = await col('sessions').doc(tokenHash).get();
      if (!sessionSnap.exists) return null;
      const session = sessionSnap.data();
      const user = await this.getPublicUserById(session.user_id);
      if (!user) return null;
      return {
        ...user,
        expires_at: session.expires_at,
      };
    },

    async deleteSession(tokenHash) {
      await col('sessions').doc(tokenHash).delete();
    },

    async getUserEntitlementSummary(userId) {
      const [userEnrollments, pkgs] = await Promise.all([
        queryByField('enrollments', 'user_id', Number(userId)),
        readAll('packages'),
      ]);
      const pkgMap = new Map(pkgs.map((p) => [Number(p.id), p]));
      const active = userEnrollments
        .filter((e) => e.status === 'active')
        .map((e) => {
          const pkg = pkgMap.get(Number(e.package_id));
          return {
            id: e.id,
            tier_level: Number(e.tier_level),
            status: e.status,
            granted_at: e.granted_at,
            slug: pkg?.slug || '',
            name: pkg?.name || '',
            price_cents: Number(pkg?.price_cents || 0),
          };
        })
        .sort(byNumDesc('tier_level'));

      const maxTier = active.reduce((m, e) => Math.max(m, e.tier_level), 0);
      const highestPaidCents = active.reduce((m, e) => Math.max(m, e.price_cents), 0);
      return { maxTier, highestPaidCents, enrollments: active };
    },

    async createPasswordReset({ userId, tokenHash, expiresAt }) {
      const id = await allocateId('password_resets');
      await col('password_resets').doc(tokenHash).set({
        id,
        user_id: Number(userId),
        token_hash: tokenHash,
        expires_at: expiresAt,
        used_at: null,
      });
    },

    async consumePasswordResetTransaction({ tokenHash, newPasswordHash, usedAt }) {
      return firestore.runTransaction(async (tx) => {
        const resetRef = col('password_resets').doc(tokenHash);
        const resetSnap = await tx.get(resetRef);
        if (!resetSnap.exists) return false;
        const reset = resetSnap.data();
        if (reset.used_at || new Date(reset.expires_at).getTime() <= Date.now()) {
          return false;
        }

        const userRef = col('users').doc(String(reset.user_id));
        const [userSnap, sessionsSnap] = await Promise.all([
          tx.get(userRef),
          tx.get(col('sessions').where('user_id', '==', Number(reset.user_id))),
        ]);
        if (!userSnap.exists) return false;

        tx.update(userRef, { password_hash: newPasswordHash });
        tx.update(resetRef, { used_at: usedAt });
        for (const sDoc of sessionsSnap.docs) {
          tx.delete(sDoc.ref);
        }
        return true;
      });
    },

    // --- Catalog & Course ---

    async listActivePackages() {
      const rows = await queryByField('packages', 'is_active', 1);
      return rows.sort(byNumAsc('tier_level'));
    },

    async getPackageBySlug(slug, { activeOnly = false } = {}) {
      const clean = String(slug || '').trim();
      if (!clean) return null;
      const snap = await col('packages').doc(clean).get();
      if (!snap.exists) return null;
      const pkg = snap.data();
      if (activeOnly && Number(pkg.is_active) !== 1) return null;
      return pkg;
    },

    async getPackageById(id) {
      const rows = await queryByField('packages', 'id', Number(id), { limit: 1 });
      return rows[0] || null;
    },

    async getPackageByTier(tierLevel) {
      const rows = await queryByField('packages', 'tier_level', Number(tierLevel), { limit: 1 });
      return rows[0] || null;
    },

    async getPackageByWhopPlanId(planId) {
      const clean = String(planId || '').trim();
      if (!clean) return null;
      const rows = await queryByField('packages', 'whop_plan_id', clean, { limit: 1 });
      return rows[0] || null;
    },

    async listModules() {
      const rows = await readAll('modules');
      return rows.sort(byNumAsc('order_index'));
    },

    async listLessons({ sortByModule = false } = {}) {
      const rows = await readAll('lessons');
      if (sortByModule) {
        return rows.sort((a, b) => {
          const modDiff = Number(a.module_id) - Number(b.module_id);
          return modDiff !== 0 ? modDiff : Number(a.order_index) - Number(b.order_index);
        });
      }
      return rows.sort(byNumAsc('order_index'));
    },

    async getLessonBySlugWithModule(slug) {
      const clean = String(slug || '').trim();
      if (!clean) return null;
      const snap = await col('lessons').doc(clean).get();
      if (!snap.exists) return null;
      const lesson = snap.data();
      const mods = await queryByField('modules', 'id', Number(lesson.module_id), { limit: 1 });
      const mod = mods[0];
      if (!mod) return null;
      return {
        ...lesson,
        module_title: mod.title,
        module_slug: mod.slug,
        min_tier_level: mod.min_tier_level,
        level_badge: mod.level_badge,
      };
    },

    async getLessonById(id) {
      const rows = await queryByField('lessons', 'id', Number(id), { limit: 1 });
      return rows[0] || null;
    },

    async getNextModuleLessonOrderIndex(moduleId) {
      const rows = await queryByField('lessons', 'module_id', Number(moduleId));
      const maxIdx = rows.reduce((m, l) => Math.max(m, Number(l.order_index || 0)), 0);
      return maxIdx + 1;
    },

    async createLesson({ moduleId, orderIndex, title, slug, isFreePreview, videoUrl, contentMarkdown }) {
      const id = await allocateId('lessons');
      const lessonDoc = {
        id,
        module_id: Number(moduleId),
        order_index: Number(orderIndex),
        title,
        slug,
        is_free_preview: isFreePreview ? 1 : 0,
        video_provider: 'blueprint',
        video_url: videoUrl || '',
        duration_sec: 600,
        content_markdown: contentMarkdown || '',
        diagram_config_json: '{}',
        quiz_json: '[]',
        resources_json: '[]',
      };
      await col('lessons').doc(slug).set(lessonDoc);
      return lessonDoc;
    },

    async updateLesson(id, { title, videoUrl, isFreePreview, contentMarkdown }) {
      const lesson = await this.getLessonById(id);
      if (!lesson) return;
      await col('lessons').doc(lesson.slug).update({
        title,
        video_url: videoUrl,
        is_free_preview: isFreePreview ? 1 : 0,
        content_markdown: contentMarkdown,
      });
    },

    async listUserLessonProgress(userId) {
      return queryByField('lesson_progress', 'user_id', Number(userId));
    },

    async getLessonProgress(userId, lessonId) {
      const snap = await col('lesson_progress').doc(`${Number(userId)}_${Number(lessonId)}`).get();
      if (!snap.exists) return null;
      const d = snap.data();
      return {
        completed: Number(d.completed || 0),
        watched_seconds: Number(d.watched_seconds || 0),
        quiz_passed: Number(d.quiz_passed || 0),
        notes_text: d.notes_text || '',
      };
    },

    async upsertLessonProgress({ userId, lessonId, completed, watchedSeconds, quizPassed, notesText, updatedAt }) {
      const uid = Number(userId);
      const lid = Number(lessonId);
      await col('lesson_progress').doc(`${uid}_${lid}`).set({
        user_id: uid,
        lesson_id: lid,
        completed: completed ? 1 : 0,
        watched_seconds: Number(watchedSeconds || 0),
        quiz_passed: quizPassed ? 1 : 0,
        notes_text: notesText || '',
        updated_at: updatedAt || new Date().toISOString(),
      });
    },

    async getUserTierCompletionStats(userId, tierLevel) {
      const [modules, lessons, progressRows] = await Promise.all([
        readAll('modules'),
        readAll('lessons'),
        queryByField('lesson_progress', 'user_id', Number(userId)),
      ]);
      const eligibleModuleIds = new Set(
        modules.filter((m) => Number(m.min_tier_level) <= Number(tierLevel)).map((m) => Number(m.id))
      );
      const completedLessonIds = new Set(
        progressRows.filter((p) => Number(p.completed) === 1).map((p) => Number(p.lesson_id))
      );
      const eligibleLessons = lessons.filter((l) => eligibleModuleIds.has(Number(l.module_id)));
      const completedCount = eligibleLessons.filter((l) => completedLessonIds.has(Number(l.id))).length;
      return {
        totalLessons: eligibleLessons.length,
        completedLessons: completedCount,
      };
    },

    // --- Coupons & Checkout / Orders ---

    async getCouponByCode(code, { activeOnly = false } = {}) {
      const clean = String(code || '').trim().toUpperCase();
      if (!clean) return null;
      const snap = await col('coupons').doc(clean).get();
      if (!snap.exists) return null;
      const coupon = snap.data();
      if (activeOnly && Number(coupon.is_active) !== 1) return null;
      return coupon;
    },

    async listCoupons() {
      const rows = await readAll('coupons');
      return rows.sort((a, b) => String(a.code).localeCompare(String(b.code)));
    },

    async upsertCoupon({ code, discountType, discountValue, minTierLevel, maxUses }) {
      const clean = String(code).trim().toUpperCase();
      const docRef = col('coupons').doc(clean);
      const snap = await docRef.get();
      const existing = snap.exists ? snap.data() : {};
      await docRef.set({
        code: clean,
        discount_type: discountType,
        discount_value: Number(discountValue),
        min_tier_level: Number(minTierLevel),
        max_uses: Number(maxUses),
        used_count: Number(existing.used_count || 0),
        valid_until: existing.valid_until ?? null,
        is_active: 1,
      });
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
      const id = await allocateId('orders');
      const docData = {
        id,
        order_ref: orderRef,
        user_id: Number(userId),
        package_id: Number(packageId),
        provider,
        provider_payment_id: providerPaymentId || '',
        gross_cents: Number(grossCents),
        upgrade_credit_cents: Number(upgradeCreditCents || 0),
        discount_cents: Number(discountCents || 0),
        final_cents: Number(finalCents),
        currency,
        coupon_code: couponCode || '',
        status,
        proof_text: proofText || '',
        metadata_json: metadataJson || '{}',
        created_at: new Date().toISOString(),
        paid_at: null,
      };
      await col('orders').doc(String(id)).set(docData);
      return docData;
    },

    async getOrderByRef(orderRef) {
      const clean = String(orderRef || '').trim();
      if (!clean) return null;
      const rows = await queryByField('orders', 'order_ref', clean, { limit: 1 });
      return rows[0] || null;
    },

    async getOrderById(id) {
      const snap = await col('orders').doc(String(Number(id))).get();
      return snap.exists ? snap.data() : null;
    },

    async getOrderByPaymentId(paymentId) {
      const clean = String(paymentId || '').trim();
      if (!clean) return null;
      const rows = await queryByField('orders', 'provider_payment_id', clean, { limit: 1 });
      return rows[0] || null;
    },

    async getOrderStatusDetails(refOrPaymentId) {
      const ref = String(refOrPaymentId || '').trim();
      if (!ref) return null;
      const [byRef, byPayment] = await Promise.all([
        queryByField('orders', 'order_ref', ref),
        queryByField('orders', 'provider_payment_id', ref),
      ]);
      const combined = [...byRef, ...byPayment].sort(byNumDesc('id'));
      const order = combined[0];
      if (!order) return null;
      const pkg = await this.getPackageById(order.package_id);
      return {
        order_ref: order.order_ref,
        provider: order.provider,
        provider_payment_id: order.provider_payment_id,
        gross_cents: order.gross_cents,
        upgrade_credit_cents: order.upgrade_credit_cents,
        discount_cents: order.discount_cents,
        final_cents: order.final_cents,
        currency: order.currency,
        status: order.status,
        proof_text: order.proof_text,
        created_at: order.created_at,
        paid_at: order.paid_at,
        metadata_json: order.metadata_json,
        package_slug: pkg?.slug || '',
        package_name: pkg?.name || '',
        tier_level: Number(pkg?.tier_level || 0),
      };
    },

    async listUserOrdersWithPackage(userId) {
      const [orders, pkgs] = await Promise.all([
        queryByField('orders', 'user_id', Number(userId)),
        readAll('packages'),
      ]);
      const pkgMap = new Map(pkgs.map((p) => [Number(p.id), p]));
      return orders
        .map((o) => {
          const pkg = pkgMap.get(Number(o.package_id));
          return {
            order_ref: o.order_ref,
            provider: o.provider,
            final_cents: o.final_cents,
            status: o.status,
            created_at: o.created_at,
            paid_at: o.paid_at,
            package_name: pkg?.name || '',
            tier_level: Number(pkg?.tier_level || 0),
          };
        })
        .sort(byIsoDesc('created_at'));
    },

    async updateOrderPaymentMeta(orderId, { providerPaymentId, metadataJson }) {
      await col('orders').doc(String(Number(orderId))).update({
        provider_payment_id: providerPaymentId,
        metadata_json: metadataJson,
      });
    },

    async markOrderDeclined(orderId, proofText) {
      await col('orders').doc(String(Number(orderId))).update({
        status: 'failed',
        proof_text: proofText,
      });
    },

    async markOrderAwaitingReview(orderId, proofText) {
      await col('orders').doc(String(Number(orderId))).update({
        status: 'awaiting_review',
        proof_text: proofText,
      });
    },

    async rejectPendingOrder(orderId, rejectSuffix) {
      return firestore.runTransaction(async (tx) => {
        const orderRef = col('orders').doc(String(Number(orderId)));
        const snap = await tx.get(orderRef);
        if (!snap.exists) return { changes: 0 };
        const order = snap.data();
        if (order.status !== 'pending' && order.status !== 'awaiting_review') {
          return { changes: 0 };
        }
        tx.update(orderRef, {
          status: 'failed',
          proof_text: `${order.proof_text || ''}${rejectSuffix}`,
        });
        return { changes: 1 };
      });
    },

    async settleOrderTransaction({ orderRef, providerPaymentId = '', metadata = {} }) {
      const nowIso = new Date().toISOString();

      return firestore.runTransaction(async (tx) => {
        const orderSnap = await tx.get(col('orders').where('order_ref', '==', orderRef).limit(1));
        if (orderSnap.empty) {
          const err = new Error(`Order ${orderRef} not found.`);
          err.status = 404;
          throw err;
        }
        const orderDoc = orderSnap.docs[0];
        const order = orderDoc.data();
        if (order.status === 'paid') {
          return { order, alreadySettled: true };
        }

        const reads = [
          tx.get(col('packages').where('id', '==', Number(order.package_id)).limit(1)),
          tx.get(col('enrollments').where('user_id', '==', Number(order.user_id))),
          tx.get(countersRef),
        ];
        if (order.coupon_code) {
          reads.push(tx.get(col('coupons').doc(String(order.coupon_code).toUpperCase())));
        }

        const [pkgSnap, userEnrollSnap, countersSnap, couponSnap] = await Promise.all(reads);
        const pkg = pkgSnap.docs[0]?.data();
        const userEnrolls = userEnrollSnap.docs;
        const counters = countersSnap.exists ? countersSnap.data() : {};

        // --- All reads complete, execute transactional writes ---
        const mergedMeta = { ...JSON.parse(order.metadata_json || '{}'), ...metadata };
        const nextOrderState = {
          ...order,
          status: 'paid',
          provider_payment_id: providerPaymentId || order.provider_payment_id || '',
          metadata_json: JSON.stringify(mergedMeta),
          paid_at: order.paid_at || nowIso,
        };
        tx.update(orderDoc.ref, {
          status: nextOrderState.status,
          provider_payment_id: nextOrderState.provider_payment_id,
          metadata_json: nextOrderState.metadata_json,
          paid_at: nextOrderState.paid_at,
        });

        if (couponSnap && couponSnap.exists) {
          const coupon = couponSnap.data();
          tx.update(couponSnap.ref, { used_count: Number(coupon.used_count || 0) + 1 });
        }

        let hasActiveSameTier = false;
        for (const eDoc of userEnrolls) {
          const e = eDoc.data();
          if (e.status === 'active') {
            if (Number(e.tier_level) < Number(pkg.tier_level)) {
              tx.update(eDoc.ref, { status: 'upgraded' });
            }
            if (Number(e.package_id) === Number(pkg.id)) {
              hasActiveSameTier = true;
            }
          }
        }

        if (!hasActiveSameTier) {
          const nextEnrollId = Number(counters.enrollments || 0) + 1;
          tx.set(countersRef, { enrollments: nextEnrollId }, { merge: true });
          tx.set(col('enrollments').doc(String(nextEnrollId)), {
            id: nextEnrollId,
            user_id: Number(order.user_id),
            package_id: Number(pkg.id),
            tier_level: Number(pkg.tier_level),
            source_order_id: Number(order.id),
            status: 'active',
            granted_at: nowIso,
          });
        }

        return { order: nextOrderState, alreadySettled: false };
      });
    },

    async refundOrderTransaction({ orderId, reason = 'Refunded' }) {
      return firestore.runTransaction(async (tx) => {
        const orderRef = col('orders').doc(String(Number(orderId)));
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists) {
          const err = new Error('Order not found.');
          err.status = 404;
          throw err;
        }
        const order = orderSnap.data();

        const [enrollSnap, userOrdersSnap] = await Promise.all([
          tx.get(col('enrollments').where('user_id', '==', Number(order.user_id))),
          tx.get(col('orders').where('user_id', '==', Number(order.user_id))),
        ]);

        const paidOrderIds = new Set(
          userOrdersSnap.docs
            .map((d) => d.data())
            .filter((o) => o.status === 'paid' && Number(o.id) !== Number(order.id))
            .map((o) => Number(o.id))
        );

        // --- All reads complete, execute writes ---
        const meta = { ...JSON.parse(order.metadata_json || '{}'), refund_reason: reason };
        const updatedOrder = { ...order, status: 'refunded', metadata_json: JSON.stringify(meta) };
        tx.update(orderRef, {
          status: updatedOrder.status,
          metadata_json: updatedOrder.metadata_json,
        });

        let activeRemaining = false;
        const upgradedCandidates = [];
        for (const eDoc of enrollSnap.docs) {
          const e = eDoc.data();
          if (Number(e.source_order_id) === Number(order.id)) {
            tx.update(eDoc.ref, { status: 'revoked' });
          } else if (e.status === 'active') {
            activeRemaining = true;
          } else if (e.status === 'upgraded' && paidOrderIds.has(Number(e.source_order_id))) {
            upgradedCandidates.push({ ref: eDoc.ref, tier_level: Number(e.tier_level || 0) });
          }
        }

        if (!activeRemaining && upgradedCandidates.length > 0) {
          upgradedCandidates.sort((a, b) => b.tier_level - a.tier_level);
          tx.update(upgradedCandidates[0].ref, { status: 'active' });
        }

        return updatedOrder;
      });
    },

    async grantManualTierTransaction({ userId, packageSlug, orderRef, adminId, note = 'Manual admin grant' }) {
      const nowIso = new Date().toISOString();
      await firestore.runTransaction(async (tx) => {
        const pkgRef = col('packages').doc(String(packageSlug || '').trim());
        const [pkgSnap, enrollSnap, countersSnap] = await Promise.all([
          tx.get(pkgRef),
          tx.get(col('enrollments').where('user_id', '==', Number(userId))),
          tx.get(countersRef),
        ]);

        if (!pkgSnap.exists) {
          const err = new Error('Package not found.');
          err.status = 404;
          throw err;
        }
        const pkg = pkgSnap.data();
        const counters = countersSnap.exists ? countersSnap.data() : {};
        const nextOrderId = Number(counters.orders || 0) + 1;

        let activeSame = false;
        for (const eDoc of enrollSnap.docs) {
          const e = eDoc.data();
          if (e.status === 'active') {
            if (Number(e.tier_level) < Number(pkg.tier_level)) {
              tx.update(eDoc.ref, { status: 'upgraded' });
            }
            if (Number(e.package_id) === Number(pkg.id)) {
              activeSame = true;
            }
          }
        }

        const nextEnrollId = activeSame ? Number(counters.enrollments || 0) : Number(counters.enrollments || 0) + 1;
        tx.set(countersRef, { orders: nextOrderId, enrollments: nextEnrollId }, { merge: true });

        tx.set(col('orders').doc(String(nextOrderId)), {
          id: nextOrderId,
          order_ref: orderRef,
          user_id: Number(userId),
          package_id: Number(pkg.id),
          provider: 'admin_grant',
          provider_payment_id: `ADMIN-${adminId}`,
          gross_cents: Number(pkg.price_cents),
          upgrade_credit_cents: 0,
          discount_cents: Number(pkg.price_cents),
          final_cents: 0,
          currency: 'USD',
          coupon_code: '',
          status: 'paid',
          proof_text: note,
          metadata_json: JSON.stringify({ granted_by_admin: adminId, note }),
          created_at: nowIso,
          paid_at: nowIso,
        });

        if (!activeSame) {
          tx.set(col('enrollments').doc(String(nextEnrollId)), {
            id: nextEnrollId,
            user_id: Number(userId),
            package_id: Number(pkg.id),
            tier_level: Number(pkg.tier_level),
            source_order_id: nextOrderId,
            status: 'active',
            granted_at: nowIso,
          });
        }
      });

      return orderRef;
    },

    // --- Webhooks ---

    async getWebhookEvent(eventId) {
      const snap = await col('webhook_events').doc(safeWebhookDocId(eventId)).get();
      return snap.exists ? snap.data() : null;
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
      const docRef = col('webhook_events').doc(safeWebhookDocId(eventId));
      return firestore.runTransaction(async (tx) => {
        const [existingSnap, countersSnap] = await Promise.all([tx.get(docRef), tx.get(countersRef)]);
        if (existingSnap.exists) {
          return { created: false, event: existingSnap.data() };
        }
        const counters = countersSnap.exists ? countersSnap.data() : {};
        const nextId = Number(counters.webhook_events || 0) + 1;
        const eventDoc = {
          id: nextId,
          provider,
          event_id: eventId,
          event_type: eventType,
          signature_valid: signatureValid ? 1 : 0,
          payload_json: payloadJson,
          processed: processed ? 1 : 0,
          error_message: errorMessage || null,
          received_at: new Date().toISOString(),
        };
        tx.set(countersRef, { webhook_events: nextId }, { merge: true });
        tx.set(docRef, eventDoc);
        return { created: true, event: eventDoc };
      });
    },

    async updateWebhookEvent(eventId, { processed, errorMessage }) {
      const patch = {};
      if (processed !== undefined) patch.processed = processed ? 1 : 0;
      if (errorMessage !== undefined) patch.error_message = errorMessage;
      if (Object.keys(patch).length > 0) {
        await col('webhook_events').doc(safeWebhookDocId(eventId)).update(patch);
      }
    },

    async listWebhookEventsAdmin() {
      const rows = await readAll('webhook_events');
      return rows.sort(byNumDesc('id')).slice(0, 100);
    },

    // --- Journal, Certificates, Audits & Admin ---

    async listJournalEntries(userId) {
      const rows = await queryByField('trade_journal_entries', 'user_id', Number(userId));
      return rows.sort(byIsoDesc('created_at', 'id')).slice(0, 200);
    },

    async getUserJournalSummary(userId) {
      const rows = await queryByField('trade_journal_entries', 'user_id', Number(userId));
      const wins = rows.filter((r) => Number(r.result_r || 0) > 0).length;
      const netR = rows.reduce((sum, r) => sum + Number(r.result_r || 0), 0);
      return { totalTrades: rows.length, wins, netR };
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
      const id = await allocateId('trade_journal_entries');
      const docData = {
        id,
        user_id: Number(userId),
        pair,
        direction,
        entry_price: Number(entryPrice),
        stop_loss: Number(stopLoss),
        take_profit: Number(takeProfit),
        risk_pct: Number(riskPct),
        result_r: Number(resultR),
        setup_tag: setupTag,
        notes,
        created_at: new Date().toISOString(),
      };
      await col('trade_journal_entries').doc(String(id)).set(docData);
      return docData;
    },

    async deleteJournalEntry(entryId, userId) {
      const docRef = col('trade_journal_entries').doc(String(Number(entryId)));
      const snap = await docRef.get();
      if (!snap.exists || Number(snap.data().user_id) !== Number(userId)) {
        return { changes: 0 };
      }
      await docRef.delete();
      return { changes: 1 };
    },

    async getCertificateBySerialWithDetails(serialCode) {
      const clean = String(serialCode || '').trim().toUpperCase();
      if (!clean) return null;
      const certSnap = await col('certificates').doc(clean).get();
      if (!certSnap.exists) return null;
      const cert = certSnap.data();
      const [user, pkg] = await Promise.all([
        this.getUserById(cert.user_id),
        this.getPackageByTier(cert.tier_level),
      ]);
      if (!user || !pkg) return null;
      return {
        serial_code: cert.serial_code,
        tier_level: cert.tier_level,
        issued_at: cert.issued_at,
        full_name: user.full_name,
        package_name: pkg.name,
      };
    },

    async getCertificateForUserTier(userId, tierLevel) {
      const rows = await queryByField('certificates', 'user_id', Number(userId));
      return rows.find((c) => Number(c.tier_level) === Number(tierLevel)) || null;
    },

    async listUserCertificates(userId) {
      const rows = await queryByField('certificates', 'user_id', Number(userId));
      return rows
        .map((c) => ({
          serial_code: c.serial_code,
          tier_level: c.tier_level,
          issued_at: c.issued_at,
        }))
        .sort(byNumDesc('tier_level'));
    },

    async createCertificate({ serialCode, userId, tierLevel }) {
      const clean = String(serialCode).trim().toUpperCase();
      const id = await allocateId('certificates');
      const docData = {
        id,
        serial_code: clean,
        user_id: Number(userId),
        tier_level: Number(tierLevel),
        issued_at: new Date().toISOString(),
      };
      await col('certificates').doc(clean).set(docData);
      return docData;
    },

    async createAudit({ userId, portfolioSizeUsd, focusPair, questionText }) {
      const id = await allocateId('mentorship_audits');
      const docData = {
        id,
        user_id: Number(userId),
        portfolio_size_usd: Number(portfolioSizeUsd),
        focus_pair: focusPair,
        question_text: questionText,
        status: 'queued',
        mentor_feedback: '',
        created_at: new Date().toISOString(),
      };
      await col('mentorship_audits').doc(String(id)).set(docData);
      return docData;
    },

    async listAuditsForUser(userId) {
      const rows = await queryByField('mentorship_audits', 'user_id', Number(userId));
      return rows.sort(byIsoDesc('created_at'));
    },

    async listAllAuditsWithUsers() {
      const [audits, users] = await Promise.all([readAll('mentorship_audits'), readAll('users')]);
      const userMap = new Map(users.map((u) => [Number(u.id), u]));
      return audits
        .map((a) => {
          const u = userMap.get(Number(a.user_id));
          return {
            ...a,
            email: u?.email || '',
            full_name: u?.full_name || '',
          };
        })
        .sort(byNumDesc('id'))
        .slice(0, 100);
    },

    async reviewAudit(auditId, mentorFeedback) {
      await col('mentorship_audits').doc(String(Number(auditId))).update({
        mentor_feedback: mentorFeedback,
        status: 'reviewed',
      });
    },

    async getAdminOverview() {
      const [orders, packages, users] = await Promise.all([
        readAll('orders'),
        readAll('packages'),
        readAll('users'),
      ]);

      const paidOrders = orders.filter((o) => o.status === 'paid');
      const awaitingReview = orders.filter((o) => o.status === 'awaiting_review').length;
      const totalStudents = users.filter((u) => u.role === 'student').length;
      const totalRevenueCents = paidOrders.reduce((s, o) => s + Number(o.final_cents || 0), 0);

      const byTier = packages
        .sort(byNumAsc('tier_level'))
        .map((p) => {
          const tierPaid = paidOrders.filter((o) => Number(o.package_id) === Number(p.id));
          return {
            slug: p.slug,
            name: p.name,
            tier_level: Number(p.tier_level),
            price_cents: Number(p.price_cents),
            orders_count: tierPaid.length,
            revenue_cents: tierPaid.reduce((s, o) => s + Number(o.final_cents || 0), 0),
          };
        });

      return {
        paidOrders: paidOrders.length,
        totalRevenueCents,
        awaitingReview,
        totalStudents,
        byTier,
      };
    },

    async listOrdersAdmin({ status = '', q = '' } = {}) {
      const [orders, users, pkgs] = await Promise.all([
        readAll('orders'),
        readAll('users'),
        readAll('packages'),
      ]);
      const userMap = new Map(users.map((u) => [Number(u.id), u]));
      const pkgMap = new Map(pkgs.map((p) => [Number(p.id), p]));
      const lowerQ = q.toLowerCase();

      return orders
        .map((o) => {
          const u = userMap.get(Number(o.user_id));
          const p = pkgMap.get(Number(o.package_id));
          return {
            ...o,
            student_email: u?.email || '',
            student_name: u?.full_name || '',
            package_name: p?.name || '',
            tier_level: Number(p?.tier_level || 0),
            package_slug: p?.slug || '',
          };
        })
        .filter((o) => {
          if (status && o.status !== status) return false;
          if (lowerQ) {
            const matchesRef = String(o.order_ref || '').toLowerCase().includes(lowerQ);
            const matchesEmail = String(o.student_email || '').toLowerCase().includes(lowerQ);
            const matchesProof = String(o.proof_text || '').toLowerCase().includes(lowerQ);
            if (!matchesRef && !matchesEmail && !matchesProof) return false;
          }
          return true;
        })
        .sort(byNumDesc('id'))
        .slice(0, 200);
    },

    async listStudentsAdmin() {
      const [users, enrollments, progressRows] = await Promise.all([
        queryByField('users', 'role', 'student'),
        readAll('enrollments'),
        readAll('lesson_progress'),
      ]);

      const enrollsByUser = new Map();
      for (const e of enrollments) {
        if (e.status !== 'active') continue;
        const uid = Number(e.user_id);
        enrollsByUser.set(uid, Math.max(enrollsByUser.get(uid) || 0, Number(e.tier_level || 0)));
      }

      const completedByUser = new Map();
      for (const lp of progressRows) {
        if (Number(lp.completed) !== 1) continue;
        const uid = Number(lp.user_id);
        completedByUser.set(uid, (completedByUser.get(uid) || 0) + 1);
      }

      return users
        .map((u) => ({
          id: u.id,
          email: u.email,
          full_name: u.full_name,
          country: u.country,
          discord_handle: u.discord_handle,
          telegram_handle: u.telegram_handle,
          created_at: u.created_at,
          active_tier: enrollsByUser.get(Number(u.id)) || 0,
          completed_lessons: completedByUser.get(Number(u.id)) || 0,
        }))
        .sort(byNumDesc('id'))
        .slice(0, 200);
    },
  };
}

