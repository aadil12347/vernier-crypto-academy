import crypto from 'node:crypto';
import { config } from '../../src/config.js';

export function generateOrderRef() {
  return `ORD-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export function calculateQuote(db, { packageSlug, userId = null, couponCode = '' }) {
  const pkg = db.prepare('SELECT * FROM packages WHERE slug = ? AND is_active = 1').get(String(packageSlug || '').trim());
  if (!pkg) {
    const err = new Error('Selected package does not exist.');
    err.status = 404;
    throw err;
  }

  let highestPaidCents = 0;
  let currentMaxTier = 0;

  if (userId) {
    const row = db.prepare(`
      SELECT COALESCE(MAX(p.price_cents), 0) AS max_paid_cents,
             COALESCE(MAX(e.tier_level), 0) AS max_tier
      FROM enrollments e
      JOIN packages p ON p.id = e.package_id
      WHERE e.user_id = ? AND e.status = 'active'
    `).get(userId);
    highestPaidCents = Number(row?.max_paid_cents || 0);
    currentMaxTier = Number(row?.max_tier || 0);
  }

  if (currentMaxTier >= pkg.tier_level) {
    const err = new Error(`You already own ${pkg.name} or a higher package.`);
    err.status = 409;
    err.code = 'ALREADY_OWNED';
    throw err;
  }

  const grossCents = pkg.price_cents;
  const upgradeCreditCents = Math.min(highestPaidCents, Math.max(0, grossCents - 100));
  const afterUpgradeCents = Math.max(0, grossCents - upgradeCreditCents);

  let discountCents = 0;
  let appliedCoupon = null;
  const cleanCode = String(couponCode || '').trim().toUpperCase();

  if (cleanCode) {
    const coupon = db.prepare('SELECT * FROM coupons WHERE code = ? AND is_active = 1').get(cleanCode);
    if (!coupon) {
      const err = new Error('Coupon code is invalid or inactive.');
      err.status = 400;
      err.code = 'INVALID_COUPON';
      throw err;
    }
    if (coupon.valid_until && new Date(coupon.valid_until).getTime() <= Date.now()) {
      const err = new Error('Coupon code has expired.');
      err.status = 400;
      throw err;
    }
    if (coupon.used_count >= coupon.max_uses) {
      const err = new Error('Coupon usage limit has been reached.');
      err.status = 400;
      throw err;
    }
    if (pkg.tier_level < coupon.min_tier_level) {
      const err = new Error(`Coupon ${coupon.code} applies to Tier ${coupon.min_tier_level}+ packages.`);
      err.status = 400;
      throw err;
    }

    if (coupon.discount_type === 'percent') {
      discountCents = Math.round((afterUpgradeCents * Math.min(100, coupon.discount_value)) / 100);
    } else {
      discountCents = Math.min(afterUpgradeCents, coupon.discount_value);
    }
    appliedCoupon = coupon.code;
  }

  const finalCents = Math.max(0, afterUpgradeCents - discountCents);

  return {
    package: {
      id: pkg.id,
      slug: pkg.slug,
      name: pkg.name,
      tier_level: pkg.tier_level,
      price_cents: pkg.price_cents,
      badge_code: pkg.badge_code || '',
      whop_plan_id: pkg.whop_plan_id || config.payments.whop.plans[pkg.slug] || '',
    },
    gross_cents: grossCents,
    upgrade_credit_cents: upgradeCreditCents,
    discount_cents: discountCents,
    final_cents: finalCents,
    pkr_equivalent: Math.round((finalCents / 100) * config.payments.pkrUsdRate),
    coupon_code: appliedCoupon,
  };
}

export function settleOrderAndGrantAccess(db, { orderRef, providerPaymentId = '', metadata = {} }) {
  const order = db.prepare('SELECT * FROM orders WHERE order_ref = ?').get(orderRef);
  if (!order) {
    const err = new Error(`Order ${orderRef} not found.`);
    err.status = 404;
    throw err;
  }
  if (order.status === 'paid') {
    return { order, alreadySettled: true };
  }
  const pkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(order.package_id);

  db.exec('BEGIN;');
  try {
    const mergedMeta = { ...JSON.parse(order.metadata_json || '{}'), ...metadata };
    db.prepare(`
      UPDATE orders
      SET status = 'paid',
          provider_payment_id = COALESCE(NULLIF(?, ''), provider_payment_id),
          metadata_json = ?,
          paid_at = COALESCE(paid_at, datetime('now'))
      WHERE id = ?
    `).run(providerPaymentId, JSON.stringify(mergedMeta), order.id);

    if (order.coupon_code) {
      db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE code = ?').run(order.coupon_code);
    }

    // Mark lower active enrollments as upgraded so active tier reflects highest unlocked package
    db.prepare(`
      UPDATE enrollments
      SET status = 'upgraded'
      WHERE user_id = ? AND status = 'active' AND tier_level < ?
    `).run(order.user_id, pkg.tier_level);

    const existingSameTier = db.prepare(`
      SELECT id FROM enrollments WHERE user_id = ? AND package_id = ? AND status = 'active'
    `).get(order.user_id, pkg.id);

    if (!existingSameTier) {
      db.prepare(`
        INSERT INTO enrollments (user_id, package_id, tier_level, source_order_id, status)
        VALUES (?, ?, ?, ?, 'active')
      `).run(order.user_id, pkg.id, pkg.tier_level, order.id);
    }

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return {
    order: db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id),
    alreadySettled: false,
  };
}

export function refundOrderAndRevokeAccess(db, { orderId, reason = 'Refunded' }) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) {
    const err = new Error('Order not found.');
    err.status = 404;
    throw err;
  }

  db.exec('BEGIN;');
  try {
    const meta = { ...JSON.parse(order.metadata_json || '{}'), refund_reason: reason };
    db.prepare("UPDATE orders SET status = 'refunded', metadata_json = ? WHERE id = ?").run(
      JSON.stringify(meta),
      order.id
    );

    db.prepare("UPDATE enrollments SET status = 'revoked' WHERE source_order_id = ?").run(order.id);

    // Restore highest remaining paid order if user had an earlier tier before upgrading
    const activeRemaining = db.prepare(`
      SELECT id FROM enrollments WHERE user_id = ? AND status = 'active' LIMIT 1
    `).get(order.user_id);

    if (!activeRemaining) {
      const priorEnrollment = db.prepare(`
        SELECT e.id FROM enrollments e
        JOIN orders o ON o.id = e.source_order_id
        WHERE e.user_id = ? AND e.status = 'upgraded' AND o.status = 'paid'
        ORDER BY e.tier_level DESC
        LIMIT 1
      `).get(order.user_id);

      if (priorEnrollment) {
        db.prepare("UPDATE enrollments SET status = 'active' WHERE id = ?").run(priorEnrollment.id);
      }
    }

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
}

export function grantManualTier(db, { userId, packageSlug, adminId, note = 'Manual admin grant' }) {
  const pkg = db.prepare('SELECT * FROM packages WHERE slug = ?').get(packageSlug);
  if (!pkg) {
    const err = new Error('Package not found.');
    err.status = 404;
    throw err;
  }
  const orderRef = generateOrderRef();
  db.prepare(`
    INSERT INTO orders (
      order_ref, user_id, package_id, provider, provider_payment_id,
      gross_cents, upgrade_credit_cents, discount_cents, final_cents,
      currency, status, proof_text, metadata_json, paid_at
    ) VALUES (?, ?, ?, 'admin_grant', ?, ?, 0, ?, 0, 'USD', 'paid', ?, ?, datetime('now'))
  `).run(
    orderRef,
    userId,
    pkg.id,
    `ADMIN-${adminId}`,
    pkg.price_cents,
    pkg.price_cents,
    note,
    JSON.stringify({ granted_by_admin: adminId, note })
  );

  const inserted = db.prepare('SELECT id FROM orders WHERE order_ref = ?').get(orderRef);
  db.exec('BEGIN;');
  try {
    db.prepare("UPDATE enrollments SET status = 'upgraded' WHERE user_id = ? AND status = 'active' AND tier_level < ?").run(
      userId,
      pkg.tier_level
    );
    const activeSame = db.prepare("SELECT id FROM enrollments WHERE user_id = ? AND package_id = ? AND status = 'active'").get(
      userId,
      pkg.id
    );
    if (!activeSame) {
      db.prepare(`
        INSERT INTO enrollments (user_id, package_id, tier_level, source_order_id, status)
        VALUES (?, ?, ?, ?, 'active')
      `).run(userId, pkg.id, pkg.tier_level, inserted.id);
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
  return orderRef;
}

