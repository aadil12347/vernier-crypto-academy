const params = new URLSearchParams(location.search);
let selectedSlug = params.get('tier') || 'starter-pass';
let couponCode = params.get('coupon') || '';
let currentUser = null;
let packagesCatalog = [];
let paymentRailsConfig = { whopEnabled: true, whopDefaultPlanId: 'plan_CTX7xd3gUPsgD' };
let activeOrderRef = '';
let activeCheckoutElement = null;
let activeCheckoutController = null;
let mountSequence = 0;

const banner = document.getElementById('ck-banner');
const tierBtns = [...document.querySelectorAll('.tier-pill')];
const couponInput = document.getElementById('ck-coupon');

function showBanner(msg, type = 'err') {
  banner.className = `msg-banner show ${type}`;
  banner.textContent = msg;
}

function clearBanner() {
  banner.className = 'msg-banner';
}

function getSelectedPackage() {
  return packagesCatalog.find((p) => p.slug === selectedSlug) || null;
}

function resolvePlanId(quotePkg) {
  const pkg = quotePkg || getSelectedPackage();
  const candidate = String(pkg?.whop_plan_id || '').trim();
  if (candidate && !candidate.toLowerCase().includes('placeholder')) return candidate;
  return paymentRailsConfig.whopDefaultPlanId || 'plan_CTX7xd3gUPsgD';
}

async function waitForWhopElements(timeoutMs = 10000) {
  if (typeof window.WhopElements === 'function') return window.WhopElements;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 80));
    if (typeof window.WhopElements === 'function') return window.WhopElements;
  }
  return null;
}

function destroyActiveWhop() {
  try {
    if (activeCheckoutElement && typeof activeCheckoutElement.destroy === 'function') {
      activeCheckoutElement.destroy();
    }
  } catch {
    // Ignore teardown errors on hot swap
  }
  try {
    if (activeCheckoutController && typeof activeCheckoutController.destroy === 'function') {
      activeCheckoutController.destroy();
    }
  } catch {
    // Ignore teardown errors on hot swap
  }
  activeCheckoutElement = null;
  activeCheckoutController = null;
  const container = document.getElementById('whop-checkout');
  if (container) container.replaceChildren();
}

async function handleWhopComplete(payload) {
  const paymentId = String(payload?.paymentId || payload?.payment_id || payload?.id || '').trim();
  const sessionId = String(payload?.sessionId || payload?.session_id || '').trim();
  showBanner('Payment received! Confirming portal access...', 'ok');

  try {
    const res = await fetch('/api/v1/checkout/whop/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderRef: activeOrderRef,
        paymentId,
        sessionId,
        packageSlug: selectedSlug,
        email: currentUser?.email || document.getElementById('ck-email')?.value || '',
        fullName: currentUser?.full_name || document.getElementById('ck-name')?.value || '',
      }),
    });
    const data = await res.json();
    if (data?.redirectUrl) {
      location.href = data.redirectUrl;
      return;
    }
  } catch {
    // Fall through to status redirect
  }

  const refParam = activeOrderRef || paymentId;
  location.href = refParam ? `/checkout/success?ref=${encodeURIComponent(refParam)}` : '/checkout/success';
}

async function mountWhopCheckout({ planId, buyerEmail = '', promoCode = '', metadata = {}, returnUrl = '' }) {
  const seq = ++mountSequence;
  const wrap = document.getElementById('whop-frame-wrap');
  const badge = document.getElementById('whop-plan-badge');
  if (badge) badge.textContent = `PLAN: ${planId}`;
  if (!wrap) return;

  destroyActiveWhop();

  const WhopElementsFactory = await waitForWhopElements();
  if (seq !== mountSequence) return;

  if (!WhopElementsFactory) {
    showBanner('Whop checkout script failed to load. Check network/adblockers and reload the page.', 'err');
    return;
  }

  let handledComplete = false;
  const onCompleteOnce = (payload) => {
    if (handledComplete) return;
    handledComplete = true;
    handleWhopComplete(payload);
  };

  try {
    const elements = WhopElementsFactory({
      appearance: {
        theme: { appearance: 'dark' },
      },
    });

    const controllerOpts = {
      plan: planId,
      ...(promoCode ? { promoCode } : {}),
      ...(metadata && Object.keys(metadata).length ? { metadata } : {}),
      ...(returnUrl ? { returnUrl } : {}),
      onComplete: onCompleteOnce,
    };

    const checkout = elements.checkout.create(controllerOpts);
    activeCheckoutController = checkout;

    const cleanEmail = String(buyerEmail || '').trim();
    const element = checkout.create('checkout', cleanEmail ? { buyerEmail: cleanEmail } : {});
    activeCheckoutElement = element;
    element.mount('#whop-checkout');
  } catch (err) {
    showBanner(`Could not initialize Whop Checkout: ${err.message}`, 'err');
  }
}

async function createCheckoutSession({ redirectInstant = false } = {}) {
  const payload = {
    packageSlug: selectedSlug,
    provider: 'whop',
    couponCode,
    email: document.getElementById('ck-email')?.value || '',
    fullName: document.getElementById('ck-name')?.value || '',
    password: document.getElementById('ck-password')?.value || '',
  };
  const res = await fetch('/api/v1/checkout/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.error || 'Could not initialize Whop checkout session.');
    return null;
  }
  if (data.session?.mode === 'instant_coupon' && data.session.redirectUrl) {
    if (redirectInstant) location.href = data.session.redirectUrl;
    return data;
  }
  if (data.session?.orderRef) {
    activeOrderRef = data.session.orderRef;
  }
  return data;
}

async function refreshQuoteAndMount({ lockSessionIfSignedIn = true } = {}) {
  clearBanner();
  const res = await fetch('/api/v1/checkout/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packageSlug: selectedSlug, couponCode }),
  });
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.error || 'Could not compute quote.');
    destroyActiveWhop();
    return null;
  }

  const q = data.quote;
  document.getElementById('sum-pkg-name').textContent = q.package.name;
  const badgePart = q.package.badge_code ? ` · ${q.package.badge_code}` : '';
  document.getElementById('sum-pkg-sub').textContent = `Level ${q.package.tier_level} Access${badgePart}`;
  document.getElementById('q-gross').textContent = `$${(q.gross_cents / 100).toFixed(2)}`;
  document.getElementById('q-credit').textContent = `-$${(q.upgrade_credit_cents / 100).toFixed(2)}`;
  document.getElementById('q-discount').textContent = `-$${(q.discount_cents / 100).toFixed(2)}`;
  document.getElementById('q-final').textContent = `$${(q.final_cents / 100).toFixed(2)}`;

  const freeBox = document.getElementById('free-coupon-box');
  const frameWrap = document.getElementById('whop-frame-wrap');
  const isFree = q.final_cents === 0 && Boolean(q.coupon_code);

  if (freeBox && frameWrap) {
    freeBox.hidden = !isFree;
    frameWrap.hidden = isFree;
  }

  if (q.coupon_error) showBanner(q.coupon_error, 'err');
  else if (q.coupon_code) showBanner(`Coupon ${q.coupon_code} applied.`, 'ok');

  if (isFree) {
    destroyActiveWhop();
    return q;
  }

  // Signed-in user automatically binds an authoritative orderRef before mounting Whop Checkout
  if (currentUser && lockSessionIfSignedIn) {
    const created = await createCheckoutSession({ redirectInstant: false });
    if (created?.session?.mode === 'whop_embed') {
      const s = created.session;
      await mountWhopCheckout({
        planId: s.planId,
        buyerEmail: s.email || currentUser.email,
        metadata: s.metadata || { orderRef: s.orderRef, packageSlug: selectedSlug },
        returnUrl: s.returnUrl,
      });
      return q;
    }
  }

  // Guest fallback: mount Whop Checkout directly so buyer sees the live form immediately
  activeOrderRef = '';
  const guestEmail = document.getElementById('ck-email')?.value || '';
  await mountWhopCheckout({
    planId: resolvePlanId(q.package),
    buyerEmail: guestEmail,
    metadata: { packageSlug: selectedSlug },
    returnUrl: `${location.origin}/checkout/success?tier=${encodeURIComponent(selectedSlug)}`,
  });

  return q;
}

function selectTier(slug) {
  selectedSlug = slug;
  tierBtns.forEach((b) => b.classList.toggle('active', b.dataset.slug === slug));
  const url = new URL(location.href);
  url.searchParams.set('tier', slug);
  history.replaceState(null, '', url);
  refreshQuoteAndMount();
}

document.getElementById('btn-apply-coupon').addEventListener('click', () => {
  couponCode = couponInput.value.trim();
  refreshQuoteAndMount();
});

document.getElementById('btn-claim-free')?.addEventListener('click', async () => {
  clearBanner();
  await createCheckoutSession({ redirectInstant: true });
});

document.getElementById('btn-lock-whop-session')?.addEventListener('click', async () => {
  clearBanner();
  const created = await createCheckoutSession({ redirectInstant: true });
  if (!created || created.session?.mode !== 'whop_embed') return;

  const meRes = await fetch('/api/v1/auth/me');
  if (meRes.ok) {
    const { user } = await meRes.json();
    if (user) {
      currentUser = user;
      document.getElementById('signed-in-card').hidden = false;
      document.getElementById('signed-in-user').textContent = `${user.full_name} (${user.email}) · Current Level ${user.max_tier_level}`;
      document.getElementById('guest-fields').hidden = true;
    }
  }

  const s = created.session;
  showBanner(`Order ${s.orderRef} bound to ${s.email}. Complete your payment in Whop Checkout below.`, 'ok');
  await mountWhopCheckout({
    planId: s.planId,
    buyerEmail: s.email,
    metadata: s.metadata,
    returnUrl: s.returnUrl,
  });
});

tierBtns.forEach((b) => b.addEventListener('click', () => selectTier(b.dataset.slug)));

async function bootstrap() {
  const [meRes, pkgRes] = await Promise.all([fetch('/api/v1/auth/me'), fetch('/api/v1/catalog/packages')]);
  if (meRes.ok) {
    const { user } = await meRes.json();
    if (user) {
      currentUser = user;
      document.getElementById('signed-in-card').hidden = false;
      document.getElementById('signed-in-user').textContent = `${user.full_name} (${user.email}) · Current Level ${user.max_tier_level}`;
      document.getElementById('guest-fields').hidden = true;
      const authNav = document.getElementById('ck-auth-nav');
      if (authNav) {
        authNav.textContent = 'Dashboard';
        authNav.href = '/dashboard';
      }
    }
  }
  if (pkgRes.ok) {
    const data = await pkgRes.json();
    packagesCatalog = data.packages || [];
    paymentRailsConfig = data.paymentRails || paymentRailsConfig;
  }
  if (couponCode) couponInput.value = couponCode;
  selectTier(selectedSlug);
}

bootstrap();
