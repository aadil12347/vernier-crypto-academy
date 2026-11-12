const params = new URLSearchParams(location.search);
let selectedSlug = params.get('tier') || 'starter-pass';
let selectedProvider = 'sandbox';
let couponCode = params.get('coupon') || '';
let paymentRailsConfig = { whopEnabled: false, pkrUsdRate: 278 };

const banner = document.getElementById('ck-banner');
const tierBtns = [...document.querySelectorAll('.tier-pill')];
const railBtns = [...document.querySelectorAll('.rail-btn')];
const couponInput = document.getElementById('ck-coupon');

function showBanner(msg, type = 'err') {
  banner.className = `msg-banner show ${type}`;
  banner.textContent = msg;
}

function clearBanner() {
  banner.className = 'msg-banner';
}

async function refreshQuote() {
  clearBanner();
  const res = await fetch('/api/v1/checkout/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packageSlug: selectedSlug, couponCode }),
  });
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.error || 'Could not compute quote.');
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
  const pkr = Math.round((q.final_cents / 100) * (paymentRailsConfig.pkrUsdRate || 278));
  document.getElementById('q-pkr').textContent = `Approx. Rs. ${pkr.toLocaleString('en-US')} PKR (at Rs. ${paymentRailsConfig.pkrUsdRate}/USD)`;
  if (q.coupon_error) showBanner(q.coupon_error, 'err');
  else if (q.coupon_code) showBanner(`Coupon ${q.coupon_code} applied.`, 'ok');
  return q;
}

function selectTier(slug) {
  selectedSlug = slug;
  tierBtns.forEach((b) => b.classList.toggle('active', b.dataset.slug === slug));
  const url = new URL(location.href);
  url.searchParams.set('tier', slug);
  history.replaceState(null, '', url);
  refreshQuote();
}

function selectProvider(provider) {
  selectedProvider = provider;
  railBtns.forEach((b) => b.classList.toggle('active', b.dataset.provider === provider));
  document.getElementById('rail-sandbox-panel').hidden = provider !== 'sandbox';
  document.getElementById('rail-crypto-panel').hidden = provider !== 'crypto_manual';
  document.getElementById('rail-pk-panel').hidden = provider !== 'local_pk';
  document.getElementById('rail-whop-panel').hidden = provider !== 'whop';
}

async function createCheckoutSession(provider) {
  clearBanner();
  const payload = {
    packageSlug: selectedSlug,
    provider,
    couponCode,
    email: document.getElementById('ck-email')?.value || '',
    fullName: document.getElementById('ck-name')?.value || '',
    password: document.getElementById('ck-password')?.value || '',
    network: document.getElementById('crypto-network')?.value || '',
  };
  const res = await fetch('/api/v1/checkout/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    showBanner(data.error || 'Could not initialize checkout session.');
    return null;
  }
  if (data.session?.mode === 'instant_coupon' && data.session.redirectUrl) {
    location.href = data.session.redirectUrl;
    return null;
  }
  return data;
}

document.getElementById('btn-apply-coupon').addEventListener('click', () => {
  couponCode = couponInput.value.trim();
  refreshQuote();
});

document.getElementById('btn-sbx-approve').addEventListener('click', async () => {
  const created = await createCheckoutSession('sandbox');
  if (!created) return;
  const res = await fetch('/api/v1/checkout/sandbox/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderRef: created.session.orderRef, outcome: 'approve', methodLabel: 'US Visa (Sandbox Pass)' }),
  });
  const data = await res.json();
  if (!res.ok) return showBanner(data.error || 'Sandbox confirmation failed.');
  location.href = data.redirectUrl || `/checkout/success?ref=${encodeURIComponent(created.session.orderRef)}`;
});

document.getElementById('btn-sbx-decline').addEventListener('click', async () => {
  const created = await createCheckoutSession('sandbox');
  if (!created) return;
  const res = await fetch('/api/v1/checkout/sandbox/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderRef: created.session.orderRef, outcome: 'decline', methodLabel: 'US Visa (Decline Simulation)' }),
  });
  const data = await res.json();
  showBanner(`${data.error || 'Simulated Decline'} (Order ${created.session.orderRef} marked failed)`, 'err');
});

document.getElementById('btn-create-crypto').addEventListener('click', async () => {
  const created = await createCheckoutSession('crypto_manual');
  if (created?.session?.redirectUrl) location.href = created.session.redirectUrl;
});

document.getElementById('btn-create-pk').addEventListener('click', async () => {
  const created = await createCheckoutSession('local_pk');
  if (created?.session?.redirectUrl) location.href = created.session.redirectUrl;
});

document.getElementById('btn-create-whop').addEventListener('click', async () => {
  const created = await createCheckoutSession('whop');
  if (!created) return;
  const s = created.session;
  const mount = document.getElementById('whop-embed-root');
  mount.innerHTML = '';
  const el = document.createElement('div');
  el.setAttribute('data-whop-checkout-plan-id', s.planId);
  el.setAttribute('data-whop-checkout-email', s.email);
  el.setAttribute('data-whop-checkout-return-url', s.returnUrl);
  el.setAttribute('data-whop-checkout-theme', 'dark');
  mount.append(el);
  if (window.WhopCheckoutLoader?.mount) window.WhopCheckoutLoader.mount();
  showBanner(`Whop Checkout mounted for Order ${s.orderRef}. Complete card or Apple Pay inside frame.`, 'ok');
});

tierBtns.forEach((b) => b.addEventListener('click', () => selectTier(b.dataset.slug)));
railBtns.forEach((b) => b.addEventListener('click', () => selectProvider(b.dataset.provider)));

async function bootstrap() {
  const [meRes, pkgRes] = await Promise.all([fetch('/api/v1/auth/me'), fetch('/api/v1/catalog/packages')]);
  if (meRes.ok) {
    const { user } = await meRes.json();
    if (user) {
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
    paymentRailsConfig = data.paymentRails || paymentRailsConfig;
    const whopStatus = document.getElementById('whop-tab-status');
    const whopCopy = document.getElementById('whop-status-copy');
    const whopBtn = document.getElementById('btn-create-whop');
    if (paymentRailsConfig.whopEnabled) {
      whopStatus.textContent = 'Live Cards & Apple Pay';
      whopCopy.textContent = 'Whop Merchant-of-Record Checkout is LIVE. Pay seamlessly with Visa, Mastercard, Apple Pay, or Cash App.';
    } else {
      whopStatus.textContent = 'Phase 6 Plug';
      whopCopy.textContent = 'Whop Checkout is cleanly wired via js.whop.com/static/checkout/loader.js and HMAC webhooks. Enable WHOP_ENABLED=true + your Whop Plan IDs in .env at final launch (Phase 6). Use Developer Sandbox or Crypto Direct to test immediately.';
      if (whopBtn) whopBtn.textContent = 'Preview Whop Phase-6 Trigger';
    }
  }
  if (couponCode) couponInput.value = couponCode;
  selectTier(selectedSlug);
  selectProvider('sandbox');
}

bootstrap();
