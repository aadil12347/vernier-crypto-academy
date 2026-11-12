import crypto from 'node:crypto';
import { config } from '../../src/config.js';

export function resolveWhopPlanId(pkg) {
  const pkgPlan = String(pkg?.whop_plan_id || '').trim();
  const validPkgPlan = pkgPlan && !pkgPlan.toLowerCase().includes('placeholder') ? pkgPlan : '';
  return validPkgPlan || config.payments.whop.plans[pkg?.slug] || config.payments.whop.defaultPlanId;
}

export function generateOrderRef() {
  return `ORD-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function calculateQuote(store, { packageSlug, userId = null, couponCode = '' }) {
  const pkg = await store.getPackageBySlug(packageSlug, { activeOnly: true });
  if (!pkg) {
    const err = new Error('Selected package does not exist.');
    err.status = 404;
    throw err;
  }

  let highestPaidCents = 0;
  let currentMaxTier = 0;

  if (userId) {
    const entitlement = await store.getUserEntitlementSummary(userId);
    highestPaidCents = entitlement.highestPaidCents;
    currentMaxTier = entitlement.maxTier;
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
    const coupon = await store.getCouponByCode(cleanCode, { activeOnly: true });
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
      whop_plan_id: resolveWhopPlanId(pkg),
    },
    gross_cents: grossCents,
    upgrade_credit_cents: upgradeCreditCents,
    discount_cents: discountCents,
    final_cents: finalCents,
    coupon_code: appliedCoupon,
  };
}

export async function settleOrderAndGrantAccess(store, { orderRef, providerPaymentId = '', metadata = {} }) {
  return store.settleOrderTransaction({ orderRef, providerPaymentId, metadata });
}

export async function refundOrderAndRevokeAccess(store, { orderId, reason = 'Refunded' }) {
  return store.refundOrderTransaction({ orderId, reason });
}

export async function grantManualTier(store, { userId, packageSlug, adminId, note = 'Manual admin grant' }) {
  return store.grantManualTierTransaction({
    userId,
    packageSlug,
    orderRef: generateOrderRef(),
    adminId,
    note,
  });
}
