import { createApp, keys, palette, toast, esc } from '/kit/app.js';

const adminSession = {
  checked: false,
  isAdmin: false,
  user: null,
};

async function ensureAdminSession() {
  if (adminSession.checked) return adminSession;
  const res = await fetch('/api/v1/auth/me');
  const data = res.ok ? await res.json() : { user: null };
  adminSession.user = data.user || null;
  adminSession.isAdmin = adminSession.user?.role === 'admin';
  adminSession.checked = true;

  const authBtn = document.getElementById('admin-auth-btn');
  if (authBtn && adminSession.user) {
    authBtn.textContent = adminSession.isAdmin ? `Signed: ${adminSession.user.full_name}` : 'Switch to Admin';
  }
  return adminSession;
}

function previewBanner() {
  if (adminSession.isAdmin) return '';
  return `
    <div class="app-panel lit-region" style="padding:12px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <span class="status-badge lit">PREVIEW CONSOLE · SIGN IN AS ADMIN FOR LIVE SQLITE MUTATIONS</span>
        <span class="meta" style="margin-left:8px;">Seeded account: <code>admin@vernier.academy</code></span>
      </div>
      <a class="app-btn commit" href="/login?next=/admin">Admin Sign In</a>
    </div>
  `;
}

function markActiveNav(path) {
  document.querySelectorAll('#admin-nav a').forEach((a) => {
    const href = a.getAttribute('href').replace(/^#/, '');
    if (href === path) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function renderLoading(title, sub) {
  return `
    <div class="page-head" data-region="head" data-region-grow><div><h1>${esc(title)}</h1><div class="meta">${esc(sub)}</div></div></div>
    <div class="kpi-strip">
      ${[1, 2, 3, 4].map(() => `<div class="kpi-cell"><div class="sk" style="width:55%;"></div><div class="k-val num"><span class="sk" style="width:45%;height:24px;"></span></div></div>`).join('')}
    </div>
    <div class="app-panel" style="padding:18px;display:grid;gap:12px;" data-region-grow>
      <div class="sk" style="width:65%;"></div><div class="sk" style="width:82%;"></div>
    </div>
  `;
}

function renderStateNote(kind, title, copy, href = '#/', cta = 'Return to Desk') {
  const cls = kind === 'error' || kind === 'denied' ? 'fail' : kind === 'done' ? 'ok' : 'info';
  return `
    <div class="state-note" data-region-grow>
      <span class="status-badge ${cls}">${esc(kind.toUpperCase())}</span>
      <h2 style="margin:4px 0 0;">${esc(title)}</h2>
      <p style="margin:0;color:var(--app-mid);">${esc(copy)}</p>
      <a class="app-btn commit" href="${esc(href)}">${esc(cta)}</a>
    </div>
  `;
}

const PREVIEW_ORDERS = [
  { id: 1, order_ref: 'ORD-DEMO-CRYPTO', student_email: 'student@vernier.academy', package_name: 'Tier 2: Structural Price Action', provider: 'crypto_manual', final_cents: 2400, status: 'awaiting_review', proof_text: '0x91af7c8e12b40099d21f... (TRC20)' },
  { id: 2, order_ref: 'ORD-SEED-SPARK', student_email: 'student@vernier.academy', package_name: 'Tier 1: Execution Blueprint', provider: 'sandbox', final_cents: 100, status: 'paid', proof_text: 'SBX-SEED-01' },
  { id: 3, order_ref: 'ORD-SEED-VAULT', student_email: 'pro@vernier.academy', package_name: 'Tier 4: Institutional Vault', provider: 'sandbox', final_cents: 50000, status: 'paid', proof_text: 'SBX-SEED-02' },
];

// ---------- VIEW 1: OVERVIEW (#/) ----------
async function adminOverview(ctx) {
  markActiveNav('/');
  await ensureAdminSession();

  if (ctx.state === 'loading') return renderLoading('Instructor Command Desk', 'Aggregating USD revenue, PKR equivalents, and TxID queue...');
  if (ctx.state === 'error') return `<div class="page-head" data-region="head" data-region-grow><h1>Instructor Command Desk</h1></div>` + renderStateNote('error', 'Revenue Aggregate Failed', 'SQLite summary view failed to lock. Retry synchronization.', '#/', 'Reload Desk');
  if (ctx.state === 'denied') return `<div class="page-head" data-region="head" data-region-grow><h1>Instructor Command Desk</h1></div>` + renderStateNote('denied', 'Instructor Role Required', 'Authenticate with your admin credentials to mutate orders and student grants.', '/login?next=/admin', 'Sign In Admin');
  if (ctx.state === 'empty') return `<div class="page-head" data-region="head" data-region-grow><h1>Instructor Command Desk</h1></div>` + renderStateNote('empty', 'Zero Settled Orders Yet', 'No student transactions have cleared yet. Open /checkout to test a $1 Sandbox run.', '/checkout?tier=starter-pass', 'Test $1 Checkout');
  if (ctx.state === 'done') return `<div class="page-head" data-region="head" data-region-grow><h1>Instructor Command Desk</h1></div>` + renderStateNote('done', 'Approval Queue Cleared (0 Pending)', 'All submitted Crypto TxID and PKR transfer proofs have been reconciled.', '#/orders', 'Inspect Order Ledger');

  let kpis = { totalRevenueCents: 50100, totalRevenuePkr: 139278, paidOrders: 2, awaitingReview: 1, totalStudents: 2, whopEnabled: false, sandboxEnabled: true };
  let byTier = [
    { slug: 'starter-pass', name: 'Tier 1: Execution Blueprint', tier_level: 1, price_cents: 100, orders_count: 1, revenue_cents: 100 },
    { slug: 'price-action', name: 'Tier 2: Structural Price Action', tier_level: 2, price_cents: 2500, orders_count: 0, revenue_cents: 0 },
    { slug: 'pro-orderflow', name: 'Tier 3: Orderflow & Perps Pro', tier_level: 3, price_cents: 10000, orders_count: 0, revenue_cents: 0 },
    { slug: 'institutional-vault', name: 'Tier 4: Institutional Vault', tier_level: 4, price_cents: 50000, orders_count: 1, revenue_cents: 50000 },
  ];

  if (adminSession.isAdmin) {
    const r = await fetch('/api/v1/admin/overview');
    if (r.ok) {
      const data = await r.json();
      kpis = data.kpis;
      byTier = data.byTier;
    }
  }

  document.getElementById('admin-rail-badge').textContent = `WHOP: ${kpis.whopEnabled ? 'LIVE MOR' : 'PHASE 6 PLUG'}`;

  if (ctx.state === 'huge') {
    kpis.totalRevenueCents = 4825900;
    kpis.totalRevenuePkr = 13416002;
    kpis.paidOrders = 318;
    kpis.totalStudents = 294;
  }

  const litClass = kpis.awaitingReview > 0 ? 'lit-region' : '';
  return `
    <div class="page-head" data-region="head" data-region-grow>
      <div><h1>Instructor Command Desk</h1><div class="meta">Borderless USD Revenue, PKR Settlement Value &amp; Tier Mix</div></div>
      <div style="display:flex;gap:8px;"><a class="app-btn commit" href="#/orders?status=awaiting_review">Review Queue (${kpis.awaitingReview})</a></div>
    </div>

    ${previewBanner()}

    <div class="kpi-strip">
      <div class="kpi-cell"><div class="meta">NET SETTLED REVENUE (USD)</div><div class="k-val num">$${(kpis.totalRevenueCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>
      <div class="kpi-cell"><div class="meta">PKR SETTLEMENT EQUIV.</div><div class="k-val num">Rs. ${kpis.totalRevenuePkr.toLocaleString('en-US')}</div></div>
      <div class="kpi-cell"><div class="meta">AWAITING TXID REVIEW</div><div class="k-val num">${kpis.awaitingReview}</div></div>
      <div class="kpi-cell"><div class="meta">ENROLLED STUDENTS</div><div class="k-val num">${kpis.totalStudents}</div></div>
    </div>

    <div class="app-panel ${litClass}" style="padding:14px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <span class="status-badge ${kpis.awaitingReview > 0 ? 'lit' : 'ok'}">${kpis.awaitingReview > 0 ? `${kpis.awaitingReview} TRANSFER PROOF NEEDING APPROVAL` : 'QUEUE CLEAR'}</span>
        <div class="meta" style="margin-top:4px;">Verify Crypto TxID / Bank IBFT hashes inside Orders &amp; Approvals to unlock student tiers in 1 click.</div>
      </div>
      <a class="app-btn commit" href="#/orders">Open Approvals Ledger</a>
    </div>

    <div class="table-wrap" data-region-grow>
      <table class="app-table">
        <thead><tr><th>Package Tier</th><th class="num">List Price</th><th class="num">Settled Seats</th><th class="num">Gross Settled</th></tr></thead>
        <tbody>
          ${byTier.slice(0, ctx.state === 'filtered' ? 2 : 4).map((t) => `
            <tr>
              <td title="${esc(t.name)} (L${t.tier_level})"><strong>${esc(t.name)}</strong> <span class="meta">(L${t.tier_level})</span></td>
              <td class="num" title="$${(t.price_cents / 100).toFixed(2)}">$${(t.price_cents / 100).toFixed(2)}</td>
              <td class="num" title="${t.orders_count} seats">${t.orders_count}</td>
              <td class="num" title="$${(t.revenue_cents / 100).toFixed(2)}">$${(t.revenue_cents / 100).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ---------- VIEW 2: ORDERS & APPROVALS (#/orders) ----------
async function adminOrders(ctx) {
  markActiveNav('/orders');
  await ensureAdminSession();

  if (ctx.state === 'loading') return renderLoading('Orders & TxID Approvals', 'Loading payment ledger...');
  if (ctx.state === 'error') return `<div class="page-head" data-region="head" data-region-grow><h1>Orders &amp; Approvals</h1></div>` + renderStateNote('error', 'Order Ledger Unavailable', 'Retry loading transactions.', '#/orders', 'Retry');
  if (ctx.state === 'denied') return `<div class="page-head" data-region="head" data-region-grow><h1>Orders &amp; Approvals</h1></div>` + renderStateNote('denied', 'Instructor Auth Required', 'Sign in as admin to approve crypto transfers or issue refunds.', '/login?next=/admin', 'Sign In Admin');

  const statusFilter = ctx.query.status || (ctx.state === 'filtered' ? 'awaiting_review' : '');
  const searchQ = ctx.query.q || '';

  let orders = PREVIEW_ORDERS;
  if (adminSession.isAdmin) {
    const sp = new URLSearchParams();
    if (statusFilter) sp.set('status', statusFilter);
    if (searchQ) sp.set('q', searchQ);
    const r = await fetch(`/api/v1/admin/orders?${sp.toString()}`);
    if (r.ok) orders = (await r.json()).orders || [];
  } else {
    orders = orders.filter((o) => (!statusFilter || o.status === statusFilter) && (!searchQ || `${o.order_ref} ${o.student_email} ${o.proof_text}`.toLowerCase().includes(searchQ.toLowerCase())));
  }

  if (ctx.state === 'empty') orders = [];
  if (ctx.state === 'done') return `<div class="page-head" data-region="head" data-region-grow><h1>Orders &amp; Approvals</h1></div>` + renderStateNote('done', 'All Transfer Proofs Reconciled', 'Zero pending orders left in awaiting_review queue.', '#/orders', 'Inspect Full History');
  if (ctx.state === 'huge') {
    orders = Array.from({ length: 24 }, (_, i) => ({
      ...PREVIEW_ORDERS[i % 3],
      id: i + 1,
      order_ref: `ORD-BATCH-${1000 + i}`,
    }));
  }

  ctx.onMount(() => {
    document.querySelectorAll('[data-order-status]').forEach((btn) => {
      btn.addEventListener('click', () => ctx.setQuery({ status: btn.dataset.orderStatus || '' }));
    });
    document.querySelectorAll('[data-order-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!adminSession.isAdmin) return toast('Sign in as admin first to approve or refund.');
        const id = btn.dataset.orderId;
        const action = btn.dataset.orderAction;
        const res = await fetch(`/api/v1/admin/orders/${id}/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Desk admin verification' }),
        });
        const data = await res.json();
        if (!res.ok) return toast(data.error || 'Action failed');
        toast(`Order #${id} ${action}d.`);
        ctx.refresh();
      });
    });
  });

  return `
    <div class="page-head" data-region="head" data-region-grow>
      <div><h1>Orders, Crypto TxIDs &amp; Refunds</h1><div class="meta num">${orders.length} ledger rows</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${[['', 'ALL'], ['awaiting_review', 'NEEDS REVIEW'], ['paid', 'PAID'], ['failed', 'FAILED'], ['refunded', 'REFUNDED']].map(([s, lbl]) => `<button type="button" class="app-btn ${statusFilter === s ? 'commit' : ''}" data-order-status="${s}">${lbl}</button>`).join('')}
      </div>
    </div>

    ${previewBanner()}

    <div class="table-wrap" data-region-grow>
      <table class="app-table">
        <thead><tr><th title="Order Ref">Order Ref</th><th title="Student">Student</th><th title="Package">Package</th><th title="Payment Rail">Rail</th><th title="Order Status">Status</th><th class="num" title="Settled Amount">Amount</th><th title="Proof / TxID Hash">Proof / TxID</th><th title="Actions">Actions</th></tr></thead>
        <tbody>
          ${orders.map((o) => `
            <tr>
              <td class="mono" title="${esc(o.order_ref)}">${esc(o.order_ref)}</td>
              <td title="${esc(o.student_email)}">${esc(o.student_email)}</td>
              <td title="${esc(o.package_name)}">${esc(o.package_name)}</td>
              <td class="mono" title="${esc(o.provider)}">${esc(o.provider)}</td>
              <td title="${esc(o.status)}"><span class="status-badge ${o.status === 'paid' ? 'ok' : o.status === 'awaiting_review' ? 'lit' : o.status === 'pending' ? 'warn' : 'fail'}">${esc(o.status.toUpperCase())}</span></td>
              <td class="num" title="$${(o.final_cents / 100).toFixed(2)}">$${(o.final_cents / 100).toFixed(2)}</td>
              <td class="mono" title="${esc(o.proof_text || '')}">${esc(o.proof_text || '—')}</td>
              <td>
                <div style="display:flex;gap:4px;">
                  ${o.status === 'awaiting_review' || o.status === 'pending' ? `<button type="button" class="app-btn commit" data-order-id="${o.id}" data-order-action="approve">Approve</button><button type="button" class="app-btn" data-order-id="${o.id}" data-order-action="reject">Reject</button>` : ''}
                  ${o.status === 'paid' ? `<button type="button" class="app-btn" data-order-id="${o.id}" data-order-action="refund">Refund</button>` : ''}
                </div>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="8" class="meta">No orders match filter.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

// ---------- VIEW 3: STUDENTS & MANUAL GRANTS (#/students) ----------
async function adminStudents(ctx) {
  markActiveNav('/students');
  await ensureAdminSession();
  if (ctx.state === 'loading') return renderLoading('Students & Tier Grants', 'Querying enrolled seats...');
  if (ctx.state === 'error') return `<div class="page-head" data-region="head" data-region-grow><h1>Students</h1></div>` + renderStateNote('error', 'Failed to read students.', 'Retry loading user rows.', '#/students', 'Retry');
  if (ctx.state === 'denied') return `<div class="page-head" data-region="head" data-region-grow><h1>Students</h1></div>` + renderStateNote('denied', 'Admin Auth Required', 'Sign in to grant complimentary tiers.', '/login?next=/admin', 'Sign In Admin');
  if (ctx.state === 'empty') return `<div class="page-head" data-region="head" data-region-grow><h1>Students</h1></div>` + renderStateNote('empty', 'Zero Registered Students', 'Students register automatically at checkout or /login.', '#/students', 'Refresh');
  if (ctx.state === 'done') return `<div class="page-head" data-region="head" data-region-grow><h1>Students &amp; Tier Grants</h1></div>` + renderStateNote('done', 'Student Seat Audit Synced', 'All complimentary grants and tier entitlements are verified.', '#/students', 'View Roster');

  let students = [
    { id: 2, email: 'student@vernier.academy', full_name: 'Ali Raza (Spark)', country: 'PK', active_tier: 1, completed_lessons: 2 },
    { id: 3, email: 'pro@vernier.academy', full_name: 'Marcus Vance (Vault)', country: 'US', active_tier: 4, completed_lessons: 38 },
  ];
  if (adminSession.isAdmin) {
    const r = await fetch('/api/v1/admin/students');
    if (r.ok) students = (await r.json()).students || [];
  }
  if (ctx.state === 'filtered') students = students.filter((s) => s.active_tier >= 4 || s.country === 'US');
  if (ctx.state === 'huge') {
    students = Array.from({ length: 18 }, (_, i) => ({
      id: 100 + i,
      email: `desk.trader${i + 1}@vernier.academy`,
      full_name: `Desk Member #${i + 1}`,
      country: i % 2 === 0 ? 'US' : 'PK',
      active_tier: (i % 4) + 1,
      completed_lessons: (i * 3) % 39,
    }));
  }

  ctx.onMount(() => {
    document.querySelectorAll('[data-grant-btn]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!adminSession.isAdmin) return toast('Admin sign-in required.');
        const uid = btn.dataset.grantBtn;
        const pkgSlug = document.getElementById(`grant-sel-${uid}`)?.value || 'price-action';
        const res = await fetch(`/api/v1/admin/students/${uid}/grant`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageSlug, note: 'Complimentary grant via Admin Desk' }),
        });
        if (!res.ok) return toast('Grant failed.');
        toast(`Granted ${pkgSlug} cleanly.`);
        ctx.refresh();
      });
    });
  });

  return `
    <div class="page-head" data-region="head" data-region-grow>
      <div><h1>Enrolled Students &amp; Manual Grants</h1><div class="meta num">${students.length} student accounts${ctx.state === 'filtered' ? ' · Tier 4 / US filter' : ''}</div></div>
    </div>
    ${previewBanner()}
    <div class="table-wrap" data-region-grow>
      <table class="app-table">
        <thead><tr><th title="Student Name">Name</th><th title="Email Address">Email</th><th title="Country">Country</th><th class="num" title="Active Tier">Active Tier</th><th class="num" title="Completed Lessons">Completed</th><th title="Manual Grant Tier">Manual Grant Tier</th></tr></thead>
        <tbody>
          ${students.map((s) => `
            <tr>
              <td title="${esc(s.full_name)}">${esc(s.full_name)}</td>
              <td class="mono" title="${esc(s.email)}">${esc(s.email)}</td>
              <td class="mono" title="${esc(s.country)}">${esc(s.country)}</td>
              <td class="num" title="LEVEL ${s.active_tier}">LEVEL ${s.active_tier}</td>
              <td class="num" title="${s.completed_lessons} completed">${s.completed_lessons}</td>
              <td>
                <div style="display:flex;gap:6px;align-items:center;">
                  <select class="app-select" id="grant-sel-${s.id}" aria-label="Choose tier to grant ${esc(s.email)}">
                    <option value="starter-pass">Tier 1 ($1)</option>
                    <option value="price-action">Tier 2 ($25)</option>
                    <option value="pro-orderflow">Tier 3 ($100)</option>
                    <option value="institutional-vault">Tier 4 ($500)</option>
                  </select>
                  <button type="button" class="app-btn" data-grant-btn="${s.id}">Grant</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ---------- VIEW 4: COURSE CMS (#/cms) ----------
async function adminCms(ctx) {
  markActiveNav('/cms');
  await ensureAdminSession();
  if (ctx.state === 'loading') return renderLoading('Course CMS', 'Loading modules and lesson video links...');
  if (ctx.state === 'error' || ctx.state === 'denied' || ctx.state === 'empty' || ctx.state === 'done') {
    return `<div class="page-head" data-region="head" data-region-grow><h1>Course CMS</h1></div>` + renderStateNote(ctx.state, `Course CMS: ${ctx.state.toUpperCase()}`, ctx.state === 'done' ? 'Playbook draft synced cleanly to SQLite curriculum.' : 'Inspect or add lessons cleanly when signed in as Instructor Admin.', '#/cms', 'Reset View');
  }

  let modules = [];
  let lessons = [];
  if (adminSession.isAdmin) {
    const r = await fetch('/api/v1/admin/cms');
    if (r.ok) ({ modules, lessons } = await r.json());
  } else {
    const r = await fetch('/api/v1/catalog/curriculum');
    if (r.ok) {
      modules = (await r.json()).modules || [];
      lessons = modules.flatMap((m) => (m.lessons || []).map((l) => ({ ...l, module_id: m.id, video_url: '' })));
    }
  }
  if (ctx.state === 'filtered') lessons = lessons.filter((l) => l.is_free_preview);
  const shownLessons = ctx.state === 'huge' ? [...lessons, ...lessons] : lessons.slice(0, 40);

  ctx.onMount(() => {
    document.getElementById('cms-add-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!adminSession.isAdmin) return toast('Admin sign-in required.');
      const res = await fetch('/api/v1/admin/cms/lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moduleId: Number(document.getElementById('cms-mod').value),
          title: document.getElementById('cms-title').value,
          slug: document.getElementById('cms-slug').value,
          videoUrl: document.getElementById('cms-vid').value,
          isFreePreview: document.getElementById('cms-free').checked,
          contentMarkdown: document.getElementById('cms-md').value,
        }),
      });
      const data = await res.json();
      if (!res.ok) return toast(data.error || 'CMS create failed');
      toast('New lesson published to SQLite!');
      ctx.refresh();
    });
  });

  return `
    <div class="page-head" data-region="head" data-region-grow><div><h1>Course CMS &amp; Video Slots</h1><div class="meta num">${modules.length} modules · ${lessons.length} playbooks${ctx.state === 'filtered' ? ' (Free Previews Only)' : ''}</div></div></div>
    ${previewBanner()}
    <form id="cms-add-form" class="app-panel" style="padding:14px;margin-bottom:14px;display:grid;gap:10px;">
      <strong>Publish New Lesson or Attach MP4 / Bunny Stream URL</strong>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;">
        <select id="cms-mod" class="app-select" aria-label="Module">${modules.map((m) => `<option value="${m.id}">M${m.order_index}: ${esc(m.title)}</option>`).join('')}</select>
        <input id="cms-title" class="app-input" placeholder="Lesson Title" required>
        <input id="cms-slug" class="app-input mono" placeholder="m1-custom-slug" required>
        <input id="cms-vid" class="app-input" placeholder="Optional MP4 / Stream URL">
      </div>
      <textarea id="cms-md" class="app-textarea" rows="3" placeholder="# Lesson Overview&#10;- Key bullet..."></textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <label style="display:inline-flex;align-items:center;gap:8px;min-height:28px;padding:2px 6px;cursor:pointer;"><input type="checkbox" id="cms-free" style="width:18px;height:18px;accent-color:var(--accent);"> Free Preview</label>
        <button type="submit" class="app-btn commit">Publish Playbook</button>
      </div>
    </form>

    <div class="table-wrap" data-region-grow>
      <table class="app-table">
        <thead><tr><th title="Playbook Slug">Slug</th><th title="Lesson Title">Title</th><th title="Preview Access">Preview</th><th title="Video Slot">Video Slot</th></tr></thead>
        <tbody>
          ${shownLessons.map((l) => `
            <tr>
              <td class="mono" title="${esc(l.slug)}">${esc(l.slug)}</td>
              <td title="${esc(l.title)}">${esc(l.title)}</td>
              <td title="${l.is_free_preview ? 'FREE' : 'TIERED'}"><span class="status-badge ${l.is_free_preview ? 'ok' : 'info'}">${l.is_free_preview ? 'FREE' : 'TIERED'}</span></td>
              <td class="mono" title="${esc(l.video_url || 'Canvas Blueprint')}">${esc(l.video_url || 'Canvas Blueprint')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ---------- VIEW 5: COUPONS & 1-ON-1 AUDITS (#/coupons) ----------
async function adminCouponsAudits(ctx) {
  markActiveNav('/coupons');
  await ensureAdminSession();
  if (ctx.state === 'loading') return renderLoading('Coupons & Tier 4 Audits', 'Loading discount codes...');
  if (ctx.state === 'error' || ctx.state === 'denied' || ctx.state === 'empty' || ctx.state === 'done') {
    return `<div class="page-head" data-region="head" data-region-grow><h1>Promo Coupons &amp; Tier 4 Audits</h1></div>` + renderStateNote(ctx.state, `Coupons & Audits: ${ctx.state.toUpperCase()}`, ctx.state === 'done' ? 'All Tier 4 trader tape audits marked reviewed.' : 'Sign in as Instructor Admin to issue discount codes or audit logs.', '#/coupons', 'Reset View');
  }

  let coupons = [
    { code: 'TEST100', discount_type: 'percent', discount_value: 100, current_uses: 0, max_uses: 999 },
    { code: 'FOUNDER20', discount_type: 'percent', discount_value: 20, current_uses: 0, max_uses: 500 },
    { code: 'DESK10', discount_type: 'percent', discount_value: 10, current_uses: 0, max_uses: 500 },
  ];
  let audits = [];

  if (adminSession.isAdmin) {
    const [cr, ar] = await Promise.all([fetch('/api/v1/admin/coupons'), fetch('/api/v1/admin/audits')]);
    if (cr.ok) coupons = (await cr.json()).coupons || [];
    if (ar.ok) audits = (await ar.json()).audits || [];
  }
  if (ctx.state === 'filtered') coupons = coupons.filter((c) => c.discount_value >= 50);
  if (ctx.state === 'huge') {
    coupons = Array.from({ length: 14 }, (_, i) => ({
      code: i === 0 ? 'TEST100' : `COHORT${20 + i}`,
      discount_type: 'percent',
      discount_value: i === 0 ? 100 : (10 + i * 5) % 80,
      current_uses: i * 3,
      max_uses: 500,
    }));
    audits = [
      { full_name: 'Marcus Vance', question_text: 'BTC Perps CVD divergence review on 15m NY open sweep.' },
      { full_name: 'Ali Raza', question_text: 'SOL funding reset sizing audit at 0.5R stop distance.' },
    ];
  }

  ctx.onMount(() => {
    document.getElementById('cpn-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!adminSession.isAdmin) return toast('Admin sign-in required.');
      const res = await fetch('/api/v1/admin/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: document.getElementById('cpn-code').value,
          discountType: document.getElementById('cpn-type').value,
          discountValue: Number(document.getElementById('cpn-val').value),
        }),
      });
      if (!res.ok) return toast('Failed to save coupon.');
      toast('Coupon updated.');
      ctx.refresh();
    });
  });

  return `
    <div class="page-head" data-region="head" data-region-grow><div><h1>Promo Coupons &amp; Tier 4 Audits</h1><div class="meta">Manage 100% test coupons, cohort discounts, and 1-on-1 desk reviews</div></div></div>
    ${previewBanner()}
    <form id="cpn-form" class="app-panel" style="padding:14px;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:10px;align-items:end;">
      <div><label class="meta" for="cpn-code">Coupon Code</label><input id="cpn-code" class="app-input mono" placeholder="COHORT25" required></div>
      <div><label class="meta" for="cpn-type">Type</label><select id="cpn-type" class="app-select"><option value="percent">Percent (%)</option><option value="fixed">Fixed (Cents)</option></select></div>
      <div><label class="meta" for="cpn-val">Value</label><input id="cpn-val" class="app-input num" type="number" value="25" required></div>
      <button type="submit" class="app-btn commit">Upsert Coupon</button>
    </form>

    <div class="table-wrap" data-region-grow>
      <table class="app-table">
        <thead><tr><th title="Coupon Code">Code</th><th title="Discount Type">Discount Type</th><th class="num" title="Discount Value">Value</th><th class="num" title="Used / Max">Used / Max</th></tr></thead>
        <tbody>
          ${coupons.map((c) => `<tr><td class="mono" title="${esc(c.code)}">${esc(c.code)}</td><td title="${esc(c.discount_type)}">${esc(c.discount_type)}</td><td class="num" title="${c.discount_value}">${c.discount_value}</td><td class="num" title="${c.current_uses} / ${c.max_uses}">${c.current_uses} / ${c.max_uses}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>

    ${audits.length ? `<div class="app-panel" style="margin-top:14px;padding:14px;"><strong>Pending Tier 4 Desk Audits (${audits.length})</strong><div class="meta" style="margin-top:6px;">${audits.map((a) => `${esc(a.full_name)}: ${esc(a.question_text)}`).join(' · ')}</div></div>` : ''}
  `;
}

// ---------- VIEW 6: WEBHOOK LEDGER (#/webhooks) ----------
async function adminWebhooks(ctx) {
  markActiveNav('/webhooks');
  await ensureAdminSession();
  if (ctx.state === 'loading') return renderLoading('Webhook Idempotency Log', 'Inspecting signed Whop & IPN deliveries...');
  if (ctx.state === 'error' || ctx.state === 'denied' || ctx.state === 'empty' || ctx.state === 'done') {
    return `<div class="page-head" data-region="head" data-region-grow><h1>Webhook Delivery Ledger</h1></div>` + renderStateNote(ctx.state, `Webhook Log: ${ctx.state.toUpperCase()}`, ctx.state === 'done' ? 'All incoming webhook signatures verified and idempotent.' : 'Idempotent delivery ledger for /api/v1/webhooks/whop and crypto IPN.', '#/webhooks', 'Inspect Live Log');
  }

  let events = [
    { event_id: 'evt_whop_seed_01', provider: 'whop', event_type: 'payment.succeeded', signature_valid: 1, received_at: '2026-11-12T10:15:00Z' },
    { event_id: 'invalid_evt_spoof_09', provider: 'whop', event_type: 'payment.succeeded', signature_valid: 0, received_at: '2026-11-12T10:18:22Z' },
  ];
  if (adminSession.isAdmin) {
    const r = await fetch('/api/v1/admin/webhooks');
    if (r.ok) {
      const rows = (await r.json()).events || [];
      if (rows.length) events = rows;
    }
  }
  if (ctx.state === 'filtered') events = events.filter((ev) => ev.signature_valid);
  if (ctx.state === 'huge') {
    events = Array.from({ length: 18 }, (_, i) => ({
      event_id: `evt_batch_${900 + i}`,
      provider: i % 3 === 0 ? 'crypto_ipn' : 'whop',
      event_type: i % 5 === 0 ? 'payment.refunded' : 'payment.succeeded',
      signature_valid: i === 4 ? 0 : 1,
      received_at: `2026-11-12T1${i % 9}:0${i % 6}:12Z`,
    }));
  }

  return `
    <div class="page-head" data-region="head" data-region-grow><div><h1>Webhook Delivery Ledger</h1><div class="meta">Idempotent delivery log for /api/v1/webhooks/whop &amp; crypto IPN${ctx.state === 'filtered' ? ' · Verified Only' : ''}</div></div></div>
    ${previewBanner()}
    <div class="table-wrap" data-region-grow>
      <table class="app-table">
        <thead><tr><th title="Webhook Event ID">Event ID</th><th title="Provider">Provider</th><th title="Event Type">Type</th><th title="Signature Status">Signature</th><th title="Received At">Received At</th></tr></thead>
        <tbody>
          ${events.map((ev) => `
            <tr>
              <td class="mono" title="${esc(ev.event_id)}">${esc(ev.event_id)}</td>
              <td class="mono" title="${esc(ev.provider)}">${esc(ev.provider)}</td>
              <td class="mono" title="${esc(ev.event_type)}">${esc(ev.event_type)}</td>
              <td title="${ev.signature_valid ? 'VERIFIED' : 'INVALID'}"><span class="status-badge ${ev.signature_valid ? 'ok' : 'fail'}">${ev.signature_valid ? 'VERIFIED' : 'INVALID'}</span></td>
              <td class="mono" title="${esc(ev.received_at)}">${esc(ev.received_at)}</td>
            </tr>
          `).join('') || '<tr><td colspan="5" class="meta">No webhook events logged yet. Run npm test or send a signed Whop webhook to inspect entries here.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

// ---------- MOUNT ADMIN ROUTER + PALETTE + HOTKEYS ----------
const app = createApp({
  root: '#view',
  routes: {
    '/': adminOverview,
    '/orders': adminOrders,
    '/students': adminStudents,
    '/cms': adminCms,
    '/coupons': adminCouponsAudits,
    '/webhooks': adminWebhooks,
  },
});

const cmdPalette = palette([
  { label: 'Overview · Revenue & Queue KPIs', key: '1', run: () => app.navigate('/') },
  { label: 'Orders & Crypto TxID Approvals', key: '2', run: () => app.navigate('/orders') },
  { label: 'Filter: Awaiting Review Queue', run: () => app.navigate('/orders', { status: 'awaiting_review' }) },
  { label: 'Students & Manual Tier Grants', key: '3', run: () => app.navigate('/students') },
  { label: 'Course CMS & Video Links', key: '4', run: () => app.navigate('/cms') },
  { label: 'Promo Coupons & Desk Audits', key: '5', run: () => app.navigate('/coupons') },
  { label: 'Webhook Idempotency Log', key: '6', run: () => app.navigate('/webhooks') },
]);

document.getElementById('btn-admin-palette')?.addEventListener('click', () => cmdPalette.open());
document.getElementById('btn-admin-theme')?.addEventListener('click', () => {
  const html = document.documentElement;
  html.dataset.theme = html.dataset.theme === 'light' ? 'dark' : 'light';
});

const searchInput = document.getElementById('admin-search');
searchInput?.addEventListener('input', () => {
  if (!location.hash.startsWith('#/orders')) {
    app.navigate('/orders', { q: searchInput.value.trim() });
  } else {
    app.setQuery({ q: searchInput.value.trim() });
  }
});

keys({
  '1': { run: () => app.navigate('/'), label: 'Overview', group: 'Admin' },
  '2': { run: () => app.navigate('/orders'), label: 'Orders', group: 'Admin' },
  '3': { run: () => app.navigate('/students'), label: 'Students', group: 'Admin' },
  '4': { run: () => app.navigate('/cms'), label: 'Course CMS', group: 'Admin' },
  '5': { run: () => app.navigate('/coupons'), label: 'Coupons', group: 'Admin' },
  '6': { run: () => app.navigate('/webhooks'), label: 'Webhooks', group: 'Admin' },
  '/': { run: () => searchInput?.focus(), label: 'Focus search', group: 'Global' },
});
