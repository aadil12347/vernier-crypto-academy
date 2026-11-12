import { createApp, keys, palette, toast, esc } from '/kit/app.js';
import { renderBlueprintCanvas } from '/js/blueprint-canvas.js';

const TIER_SLUGS = { 1: 'starter-pass', 2: 'price-action', 3: 'pro-orderflow', 4: 'institutional-vault' };
const TIER_PRICES = { 1: '$1', 2: '$25', 3: '$100', 4: '$500' };

const stateStore = {
  loaded: false,
  user: null,
  modules: [],
  overview: null,
};

async function loadBootstrap(force = false) {
  if (stateStore.loaded && !force) return stateStore;
  const [meRes, currRes] = await Promise.all([
    fetch('/api/v1/auth/me'),
    fetch('/api/v1/catalog/curriculum'),
  ]);
  const meData = meRes.ok ? await meRes.json() : { user: null };
  const currData = currRes.ok ? await currRes.json() : { modules: [] };
  stateStore.user = meData.user || null;
  stateStore.modules = currData.modules || [];

  if (stateStore.user) {
    const ovRes = await fetch('/api/v1/course/overview');
    if (ovRes.ok) stateStore.overview = await ovRes.json();
  } else {
    stateStore.overview = null;
  }
  stateStore.loaded = true;
  syncSidebarChrome();
  return stateStore;
}

function syncSidebarChrome() {
  const metaEl = document.getElementById('side-seat-meta');
  const ctaEl = document.getElementById('side-upgrade-cta');
  if (!metaEl || !ctaEl) return;
  if (!stateStore.user) {
    metaEl.textContent = 'GUEST PREVIEW · FREE PLAYBOOKS OPEN';
    ctaEl.textContent = 'Start $1 Blueprint';
    ctaEl.href = '/checkout?tier=starter-pass';
  } else {
    const t = stateStore.user.max_tier_level || 0;
    metaEl.textContent = `SEAT LEVEL ${t} · ${(stateStore.user.full_name || '').toUpperCase().slice(0, 18)}`;
    const nextTier = Math.min(4, t + 1);
    if (t >= 4) {
      ctaEl.textContent = 'Vault Tier 4 Active';
      ctaEl.href = '#/community';
    } else {
      ctaEl.textContent = `Upgrade Level ${nextTier} (${TIER_PRICES[nextTier]})`;
      ctaEl.href = `/checkout?tier=${TIER_SLUGS[nextTier]}`;
    }
  }
}

function markActiveNav(path) {
  const links = document.querySelectorAll('#course-nav a');
  links.forEach((a) => {
    const href = a.getAttribute('href').replace(/^#/, '');
    const match =
      href === path ||
      (href === '/curriculum' && path.startsWith('/lesson/'));
    if (match) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function formatDuration(sec) {
  const m = Math.max(1, Math.round((Number(sec) || 300) / 60));
  return `${m} min`;
}

function renderMarkdown(md) {
  const safe = esc(md || '');
  const lines = safe.split(/\r?\n/);
  let html = '';
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      if (inList) { html += '</ul>'; inList = false; }
      continue;
    }
    const inline = (s) =>
      s
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code class="mono" style="background:var(--app-bg);padding:1px 5px;border:1px solid var(--app-line);">$1</code>');
    if (line.startsWith('### ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h3 style="margin:16px 0 6px;font-size:1.05rem;">${inline(line.slice(4))}</h3>`;
    } else if (line.startsWith('## ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h2 style="margin:18px 0 8px;font-size:1.22rem;">${inline(line.slice(3))}</h2>`;
    } else if (line.startsWith('# ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h2 style="margin:0 0 10px;font-size:1.3rem;">${inline(line.slice(2))}</h2>`;
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) { html += '<ul style="margin:8px 0 14px;padding-left:20px;display:grid;gap:6px;">'; inList = true; }
      html += `<li>${inline(line.slice(2))}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p style="margin:8px 0;line-height:1.6;">${inline(line)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

function renderStateNote(kind, title, copy, actionHref = '#/curriculum', actionLabel = 'Open Curriculum') {
  const badge =
    kind === 'error'
      ? '<span class="status-badge fail">ERROR // SYNC INTERRUPTED</span>'
      : kind === 'denied'
        ? '<span class="status-badge fail">ACCESS RESTRICTED // TIER LOCKED</span>'
        : kind === 'done'
          ? '<span class="status-badge ok">DESK COMPLETE // NO PENDING ITEMS</span>'
          : '<span class="status-badge info">EMPTY WORKSPACE</span>';
  return `
    <div class="state-note" data-region-grow>
      ${badge}
      <h2 style="margin:4px 0 0;">${esc(title)}</h2>
      <p style="margin:0;color:var(--app-mid);">${esc(copy)}</p>
      <a class="app-btn commit" href="${esc(actionHref)}">${esc(actionLabel)}</a>
    </div>
  `;
}

function renderLoadingKpis(heading, sub) {
  return `
    <div class="page-head" data-region="head" data-region-grow>
      <div><h1>${esc(heading)}</h1><div class="meta">${esc(sub)}</div></div>
    </div>
    <div class="kpi-strip">
      ${[1, 2, 3, 4].map(() => `<div class="kpi-cell"><div class="sk" style="width:60%;"></div><div class="k-val num"><span class="sk" style="width:45%;height:24px;"></span></div></div>`).join('')}
    </div>
    <div class="app-panel" style="padding:18px;display:grid;gap:12px;" data-region-grow>
      <div class="sk" style="width:48%;"></div>
      <div class="sk" style="width:76%;"></div>
      <div class="sk" style="width:62%;"></div>
    </div>
  `;
}

// ---------- VIEW: OVERVIEW (#/) ----------
async function overviewView(ctx) {
  markActiveNav('/');
  await loadBootstrap();

  if (ctx.state === 'loading') {
    return renderLoadingKpis('Vernier Execution Portal', 'Synchronizing seat progress and unlocked modules...');
  }
  if (ctx.state === 'error') {
    return `<div class="page-head" data-region="head" data-region-grow><h1>Vernier Execution Portal</h1></div>` +
      renderStateNote('error', 'Failed to synchronize lesson state.', 'Database connection timed out while fetching seat progress. Retry refresh or verify session.', '#/', 'Reload Workspace');
  }
  if (ctx.state === 'denied') {
    return `<div class="page-head" data-region="head" data-region-grow><h1>Vernier Execution Portal</h1></div>` +
      renderStateNote('denied', 'Authenticated Tier Required', 'This workspace configuration requires an enrolled account. Sign in or unlock Level 1 ($1 Spark Blueprint).', '/checkout?tier=starter-pass', 'Unlock $1 Access');
  }
  if (ctx.state === 'empty') {
    return `<div class="page-head" data-region="head" data-region-grow><h1>Vernier Execution Portal</h1></div>` +
      renderStateNote('empty', 'No Enrolled Modules Active', 'Start with the free preview playbooks inside Curriculum or settle the $1 Execution Blueprint to track completion.', '/checkout?tier=starter-pass', 'Activate $1 Seat');
  }
  if (ctx.state === 'done') {
    return `<div class="page-head" data-region="head" data-region-grow><h1>Vernier Execution Portal</h1></div>` +
      renderStateNote('done', 'All Unlocked Playbooks Completed (100%)', 'You have completed every module in your current tier. Mint your credential serial or upgrade to unlock advanced institutional playbooks.', '#/community', 'Claim Certificate');
  }

  const ov = stateStore.overview;
  const user = stateStore.user;
  const unlockedCount = ov ? ov.stats.unlockedLessons : stateStore.modules.reduce((n, m) => n + m.lessons.filter((l) => l.accessible).length, 0);
  const completedCount = ov ? ov.stats.completedLessons : 0;
  const pct = ov ? ov.stats.completionPct : 0;
  const netR = ov ? ov.stats.netR : 0;
  const nextSlug = ov?.nextLesson?.slug || stateStore.modules[0]?.lessons[0]?.slug || 'cex-vs-self-custody-wallets';
  const nextTitle = ov?.nextLesson?.title || stateStore.modules[0]?.lessons[0]?.title || 'Market Infrastructure & Wallet Mechanics';

  const displayModules = ctx.state === 'huge'
    ? [...stateStore.modules, ...stateStore.modules, ...stateStore.modules].map((m, idx) => ({ ...m, displayIdx: idx + 1 }))
    : stateStore.modules.map((m, idx) => ({ ...m, displayIdx: idx + 1 }));

  const firstLockedIdx = displayModules.findIndex((m) => !m.unlocked);

  const authNotice = !user
    ? `<div class="app-panel lit-region" style="padding:12px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div><span class="status-badge lit">GUEST PREVIEW MODE</span> <span style="margin-left:8px;">Free Level 1 lessons open cleanly below. Sign in or commit $1 to save notes &amp; track progress.</span></div>
        <div style="display:flex;gap:8px;"><a class="app-btn" href="/login?next=/course">Sign In</a><a class="app-btn commit" href="/checkout?tier=starter-pass">Start $1</a></div>
      </div>`
    : `<div class="app-panel lit-region" style="padding:12px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div><span class="status-badge lit">NEXT UP IN DESK</span> <strong style="margin-left:8px;">${esc(nextTitle)}</strong></div>
        <a class="app-btn commit" href="#/lesson/${encodeURIComponent(nextSlug)}">Resume Lesson</a>
      </div>`;

  const tiles = displayModules.slice(0, ctx.state === 'filtered' ? 4 : displayModules.length).map((m, idx) => {
    const firstLesson = m.lessons?.[0];
    const targetHref = m.unlocked || firstLesson?.is_free_preview
      ? `#/lesson/${encodeURIComponent(firstLesson?.slug || nextSlug)}`
      : `/checkout?tier=${TIER_SLUGS[m.min_tier_level] || 'starter-pass'}`;
    const isNext = (idx === firstLockedIdx - 1) || (!user && idx === 0);
    return `
      <a class="mod-tile ${m.unlocked ? '' : 'locked'} ${isNext ? 'next-focus' : ''}" href="${targetHref}">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="mono" style="font-size:11px;color:var(--app-mid);">M${String(m.displayIdx).padStart(2, '0')} · ${esc(m.level_badge)}</span>
          <span class="status-badge ${m.unlocked ? 'ok' : 'warn'}">${m.unlocked ? 'OPEN' : TIER_PRICES[m.min_tier_level]}</span>
        </div>
        <strong style="font-size:0.95rem;">${esc(m.title)}</strong>
        <span class="meta num">${m.lessons?.length || 0} playbooks · ${m.estimated_minutes} min</span>
      </a>
    `;
  }).join('');

  return `
    <div class="page-head" data-region="head" data-region-grow>
      <div>
        <h1>Vernier Execution Portal</h1>
        <div class="meta">Cumulative Tier Architecture · 13 Modules · 39 Playbooks</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <a class="app-btn" href="#/tools/calculator">Risk Sizing Bench</a>
        <a class="app-btn commit" href="#/lesson/${encodeURIComponent(nextSlug)}">Open Active Playbook</a>
      </div>
    </div>

    ${authNotice}

    <div class="kpi-strip">
      <div class="kpi-cell"><div class="meta">ACTIVE SEAT TIER</div><div class="k-val num">LEVEL ${user ? user.max_tier_level : 0}</div></div>
      <div class="kpi-cell"><div class="meta">UNLOCKED LESSONS</div><div class="k-val num">${unlockedCount} / 39</div></div>
      <div class="kpi-cell"><div class="meta">DESK COMPLETION</div><div class="k-val num">${pct}% (${completedCount})</div></div>
      <div class="kpi-cell"><div class="meta">JOURNAL EXPECTANCY</div><div class="k-val num">${netR >= 0 ? '+' : ''}${netR.toFixed(2)}R</div></div>
    </div>

    <div data-region-grow>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <strong>Mastery Blueprint Grid (${ctx.state === 'filtered' ? 'Filtered Level 1' : `${displayModules.length} Modules`})</strong>
        <a class="app-btn" href="#/curriculum">Inspect Full Lesson Matrix</a>
      </div>
      <div class="blueprint-grid">${tiles}</div>
    </div>
  `;
}

// ---------- VIEW: CURRICULUM (#/curriculum) ----------
async function curriculumView(ctx) {
  markActiveNav('/curriculum');
  await loadBootstrap();

  if (ctx.state === 'loading') return renderLoadingKpis('Curriculum Directory', 'Indexing 39 playbooks across 13 modules...');
  if (ctx.state === 'error') return `<div class="page-head" data-region="head"><h1>Curriculum Directory</h1></div>` + renderStateNote('error', 'Failed to index lessons.', 'Retry loading the Firestore syllabus cache.', '#/curriculum', 'Retry Load');
  if (ctx.state === 'denied') return `<div class="page-head" data-region="head"><h1>Curriculum Directory</h1></div>` + renderStateNote('denied', 'Seat Required', 'Authenticate or purchase a tier to access locked desk files.', '/login', 'Sign In');
  if (ctx.state === 'empty') return `<div class="page-head" data-region="head"><h1>Curriculum Directory</h1></div>` + renderStateNote('empty', 'Zero Lessons Matched Query', 'Reset tier and keyword filters to inspect all 39 playbooks.', '#/curriculum', 'Show All Modules');
  if (ctx.state === 'done') return `<div class="page-head" data-region="head"><h1>Curriculum Directory</h1></div>` + renderStateNote('done', 'All Filtered Lessons Completed', 'Clear filter or claim graduate serial inside Certificates & Audit.', '#/community', 'Open Certificates');

  const q = (ctx.query.q || '').toLowerCase();
  const tierFilter = ctx.query.tier || (ctx.state === 'filtered' ? '1' : '');

  let sourceMods = stateStore.modules;
  if (ctx.state === 'huge') {
    sourceMods = [...stateStore.modules, ...stateStore.modules, ...stateStore.modules];
  }

  const rows = [];
  for (const mod of sourceMods) {
    if (tierFilter && String(mod.min_tier_level) !== String(tierFilter)) continue;
    for (const les of mod.lessons || []) {
      if (q && !`${mod.title} ${les.title} ${les.slug}`.toLowerCase().includes(q)) continue;
      rows.push({ mod, les });
    }
  }

  ctx.onMount(() => {
    document.querySelectorAll('[data-tier-chip]').forEach((btn) => {
      btn.addEventListener('click', () => ctx.setQuery({ tier: btn.dataset.tierChip || '' }));
    });
  });

  return `
    <div class="page-head" data-region="head" data-region-grow>
      <div><h1>Curriculum Directory</h1><div class="meta num">${rows.length} playbooks displayed</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${[
          ['', 'ALL'],
          ['1', 'L1 ($1)'],
          ['2', 'L2 ($25)'],
          ['3', 'L3 ($100)'],
          ['4', 'L4 ($500)'],
        ].map(([val, label]) => `<button type="button" class="app-btn ${String(tierFilter) === val ? 'commit' : ''}" data-tier-chip="${val}">${label}</button>`).join('')}
      </div>
    </div>

    <div class="table-wrap" data-region-grow>
      <table class="app-table">
        <thead>
          <tr>
            <th style="width:120px;">Tier</th>
            <th>Module &amp; Playbook</th>
            <th style="width:130px;">Status</th>
            <th class="num" style="width:90px;">Study</th>
            <th style="width:130px;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(({ mod, les }) => {
            const canOpen = mod.unlocked || les.is_free_preview;
            const tierLabel = `L${mod.min_tier_level} (${TIER_PRICES[mod.min_tier_level]})`;
            const action = canOpen
              ? `<a class="app-btn" href="#/lesson/${encodeURIComponent(les.slug)}">Open</a>`
              : `<a class="app-btn" href="/checkout?tier=${TIER_SLUGS[mod.min_tier_level]}">Unlock ${TIER_PRICES[mod.min_tier_level]}</a>`;
            return `
              <tr data-row data-id="${esc(les.slug)}">
                <td class="mono" title="${esc(tierLabel)}">${esc(tierLabel)}</td>
                <td title="${esc(`${mod.title} — ${les.title}`)}"><strong>${esc(les.title)}</strong> <span class="meta">· ${esc(mod.title)}</span></td>
                <td title="${les.is_free_preview ? 'FREE PREVIEW' : canOpen ? 'UNLOCKED' : 'LOCKED'}"><span class="status-badge ${canOpen ? 'ok' : 'warn'}">${les.is_free_preview ? 'FREE PREVIEW' : canOpen ? 'UNLOCKED' : 'LOCKED'}</span></td>
                <td class="num" title="${formatDuration(les.duration_sec)}">${formatDuration(les.duration_sec)}</td>
                <td title="${canOpen ? 'Open playbook' : 'Unlock package'}">${action}</td>
              </tr>
            `;
          }).join('') || '<tr><td colspan="5" class="meta">No lessons match the current filter.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

// ---------- VIEW: LESSON PLAYER (#/lesson/:slug) ----------
async function lessonView(ctx) {
  markActiveNav('/curriculum');
  await loadBootstrap();
  const slug = ctx.params.slug || stateStore.modules[0]?.lessons[0]?.slug || 'cex-vs-self-custody-wallets';

  if (ctx.state === 'loading') return renderLoadingKpis('Playbook Loader', `Decrypting playbook ${slug}...`);
  if (ctx.state === 'error') return `<div class="page-head" data-region="head" data-region-grow><h1>Playbook Loader</h1></div>` + renderStateNote('error', 'Playback Render Failed', 'Could not load diagram canvas buffer or markdown body.', `#/lesson/${encodeURIComponent(slug)}`, 'Retry Lesson');
  if (ctx.state === 'denied') return `<div class="page-head" data-region="head" data-region-grow><h1>Playbook Locked</h1></div>` + renderStateNote('denied', 'Higher Package Required', 'This playbook belongs to a higher tier package. Upgrade with 100% credit deduction to unlock.', '/checkout?tier=price-action', 'Upgrade Package');
  if (ctx.state === 'empty') return `<div class="page-head" data-region="head" data-region-grow><h1>Playbook Empty</h1></div>` + renderStateNote('empty', 'Lesson Body Not Found', 'Choose a lesson from the curriculum matrix.', '#/curriculum', 'Browse All Lessons');
  if (ctx.state === 'done') return `<div class="page-head" data-region="head" data-region-grow><h1>Playbook Completed</h1></div>` + renderStateNote('done', 'Playbook Marked Complete & Quiz Passed', 'Continue sequentially to the next module or review your execution notes.', '#/curriculum', 'Next Module');

  const res = await fetch(`/api/v1/course/lessons/${encodeURIComponent(slug)}`);
  if (res.status === 403) {
    const errData = await res.json();
    const pkgSlug = errData.requiredPackage?.slug || 'price-action';
    return `
      <div class="page-head" data-region="head"><div><h1>Locked Playbook</h1><div class="meta">${esc(errData.error)}</div></div></div>
      ${renderStateNote('denied', `${errData.requiredPackage?.name || 'Upgrade'} Required`, 'Every previous dollar paid deducts automatically inside checkout.', `/checkout?tier=${encodeURIComponent(pkgSlug)}`, `Unlock ${errData.requiredPackage?.name || 'Tier'}`)}
    `;
  }
  if (!res.ok) {
    return `<div class="page-head" data-region="head"><h1>Lesson Missing</h1></div>` + renderStateNote('error', 'Playbook not found.', `Slug "${slug}" is not present in Firestore.`, '#/curriculum', 'Return to Syllabus');
  }

  const { lesson } = await res.json();

  // Compute flat ordered lessons for prev/next stepping
  const flatLessons = stateStore.modules.flatMap((m) => m.lessons || []);
  const idx = flatLessons.findIndex((l) => l.slug === lesson.slug);
  const nextLes = idx >= 0 && idx < flatLessons.length - 1 ? flatLessons[idx + 1] : null;

  const quizHtml = (lesson.quiz || []).map((qItem, qi) => `
    <div style="padding:12px 0;border-bottom:1px solid var(--app-line);">
      <div style="font-weight:600;margin-bottom:8px;">Q${qi + 1}. ${esc(qItem.question)}</div>
      <div style="display:grid;gap:6px;">
        ${(qItem.options || []).map((opt, oi) => `
          <label style="display:flex;align-items:center;gap:8px;min-height:28px;cursor:pointer;">
            <input type="radio" name="quiz-${qi}" value="${oi}">
            <span>${esc(opt)}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');

  const mediaBlock = lesson.video_url
    ? `<div class="lesson-canvas-frame"><video controls style="width:100%;max-height:420px;display:block;" src="${esc(lesson.video_url)}"></video></div>`
    : `<div class="lesson-canvas-frame">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-family:var(--font-mono);font-size:11px;color:#8ba3a8;">
          <span>INTERACTIVE SCHEMATIC // ${esc(lesson.diagram_config?.mode || 'liquidation_map').toUpperCase()}</span>
          <span class="num">${formatDuration(lesson.duration_sec)}</span>
        </div>
        <canvas id="lesson-canvas" width="760" height="420"></canvas>
      </div>`;

  ctx.onMount(() => {
    const canvas = document.getElementById('lesson-canvas');
    if (canvas) renderBlueprintCanvas(canvas, lesson.diagram_config || { mode: 'liquidity_sweep', symbol: 'VERNIER DESK' });

    const btnComplete = document.getElementById('btn-toggle-complete');
    const btnSaveNotes = document.getElementById('btn-save-notes');
    const btnCheckQuiz = document.getElementById('btn-grade-quiz');

    async function saveProgress(patch, msg) {
      if (!stateStore.user) {
        toast('Sign in first to persist progress and notes.', {});
        return;
      }
      const r = await fetch(`/api/v1/course/lessons/${encodeURIComponent(lesson.slug)}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        toast('Could not save lesson progress.');
        return;
      }
      stateStore.loaded = false;
      toast(msg);
      if (patch.completed !== undefined) ctx.refresh();
    }

    btnComplete?.addEventListener('click', () => {
      saveProgress({ completed: !lesson.progress.completed }, !lesson.progress.completed ? 'Playbook marked complete.' : 'Marked incomplete.');
    });

    btnSaveNotes?.addEventListener('click', () => {
      const notesText = document.getElementById('lesson-notes')?.value || '';
      saveProgress({ notesText }, 'Desk notes saved to Firestore.');
    });

    btnCheckQuiz?.addEventListener('click', () => {
      const qs = lesson.quiz || [];
      if (!qs.length) return;
      let passed = true;
      qs.forEach((qItem, qi) => {
        const picked = document.querySelector(`input[name="quiz-${qi}"]:checked`)?.value;
        if (Number(picked) !== Number(qItem.answerIndex)) passed = false;
      });
      const out = document.getElementById('quiz-feedback');
      if (passed) {
        out.innerHTML = '<span class="status-badge ok">CHECK PASSED · 100%</span>';
        saveProgress({ quizPassed: true, completed: true }, 'Quiz passed & playbook marked complete.');
      } else {
        out.innerHTML = '<span class="status-badge fail">INCORRECT ANSWER · REVIEW PLAYBOOK</span>';
      }
    });
  });

  return `
    <div class="page-head" data-region="head" data-region-grow>
      <div>
        <div class="meta">${esc(lesson.level_badge)} · ${esc(lesson.module_title)}</div>
        <h1>${esc(lesson.title)}</h1>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="app-btn ${lesson.progress.completed ? 'commit' : ''}" id="btn-toggle-complete">
          ${lesson.progress.completed ? 'Completed' : 'Mark Completed'}
        </button>
        ${nextLes ? `<a class="app-btn" href="#/lesson/${encodeURIComponent(nextLes.slug)}">Next Playbook</a>` : ''}
      </div>
    </div>

    <div class="lesson-workbench" data-region-grow>
      <section>
        ${ctx.state === 'filtered' ? '' : mediaBlock}
        <article class="app-panel" style="padding:20px;">
          ${ctx.state === 'filtered' ? '<div class="status-badge lit" style="margin-bottom:10px;">QUIZ-ONLY STUDY FILTER ACTIVE</div>' : ''}
          ${renderMarkdown(lesson.content_markdown)}
          ${ctx.state === 'huge' ? `<hr style="border:0;border-top:1px solid var(--app-line);margin:18px 0;">${renderMarkdown(lesson.content_markdown)}` : ''}
        </article>
      </section>

      <aside style="display:grid;gap:14px;">
        <section class="app-panel" style="padding:14px;">
          <div class="app-panel-head" style="padding:0 0 10px;">
            <span>Mastery Verification Check</span>
            ${lesson.progress.quiz_passed ? '<span class="status-badge ok">PASSED</span>' : ''}
          </div>
          ${quizHtml || '<p class="meta">No quiz items for this lab. Complete the schematic drill.</p>'}
          ${quizHtml ? '<div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;"><button type="button" class="app-btn commit" id="btn-grade-quiz">Verify Answers</button><span id="quiz-feedback"></span></div>' : ''}
        </section>

        <section class="app-panel" style="padding:14px;display:grid;gap:8px;">
          <label for="lesson-notes" style="font-weight:600;">Execution Desk Notes</label>
          <textarea id="lesson-notes" class="app-textarea" rows="5" placeholder="Record key liquidity levels, stop rules, or questions...">${esc(lesson.progress.notes_text || '')}</textarea>
          <button type="button" class="app-btn" id="btn-save-notes">Save Notes to Account</button>
        </section>
      </aside>
    </div>
  `;
}

// ---------- VIEW: POSITION SIZE CALCULATOR (#/tools/calculator) ----------
async function calculatorView(ctx) {
  markActiveNav('/tools/calculator');
  await loadBootstrap();
  if (ctx.state === 'loading') return renderLoadingKpis('Position Size & R-Risk Bench', 'Loading mathematical solver...');
  if (ctx.state === 'error') return `<div class="page-head" data-region="head" data-region-grow><h1>Position Size Bench</h1></div>` + renderStateNote('error', 'Calculator state interrupted.', 'Reset bench parameters to default USD sizing.', '#/tools/calculator', 'Reset Bench');
  if (ctx.state === 'denied') return `<div class="page-head" data-region="head" data-region-grow><h1>Position Size Bench</h1></div>` + renderStateNote('denied', 'Disabled Under Policy', 'Switch out of denied state preview.', '#/tools/calculator', 'Enable Bench');
  if (ctx.state === 'empty') return `<div class="page-head" data-region="head" data-region-grow><h1>Position Size Bench</h1></div>` + renderStateNote('empty', 'Zero Equity Profile Entered', 'Load default $5,000 paper risk profile to compute stop coordinates.', '#/tools/calculator', 'Load Default Profile');
  if (ctx.state === 'done') return `<div class="page-head" data-region="head" data-region-grow><h1>Position Size Bench</h1></div>` + renderStateNote('done', 'Risk Cap Locked & Verified (1.00% Max Risk)', 'Invalidation stop and notional contract ceiling passed pre-trade safety check.', '#/tools/journal', 'Log Setup in Journal');

  ctx.onMount(() => {
    const inputs = ['t-eq', 't-rk', 't-en', 't-st', 't-tg'].map((id) => document.getElementById(id));
    function run() {
      const eq = Math.max(10, Number(inputs[0].value) || 1000);
      const rk = Math.max(0.1, Number(inputs[1].value) || 1);
      const en = Math.max(0.0001, Number(inputs[2].value) || 1);
      const st = Math.max(0.0001, Number(inputs[3].value) || 0.9);
      const tg = Math.max(0.0001, Number(inputs[4].value) || 1.1);
      const riskUsd = eq * (rk / 100);
      const stopFrac = Math.max(0.0005, Math.abs(en - st) / en + 0.0008);
      const notional = riskUsd / stopFrac;
      const rr = Math.abs(tg - en) / en / stopFrac;
      document.getElementById('r-usd').textContent = `$${riskUsd.toFixed(2)}`;
      document.getElementById('r-notional').textContent = `$${notional.toFixed(2)}`;
      document.getElementById('r-units').textContent = `${(notional / en).toFixed(4)} units`;
      document.getElementById('r-rr').textContent = `${rr.toFixed(2)}R`;
    }
    inputs.forEach((i) => i?.addEventListener('input', run));
    run();
  });

  const defaultRiskVal = ctx.state === 'filtered' ? 0.5 : 1;
  const riskLadder = ctx.state === 'huge'
    ? `<div class="table-wrap" style="margin-top:14px;"><table class="app-table"><thead><tr><th>Risk Profile</th><th class="num">Risk %</th><th class="num">Max Loss (USD)</th><th class="num">Effective Leverage</th></tr></thead><tbody>${[0.25, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0].map((r) => `<tr><td class="mono">${r <= 1 ? 'STANDARD' : 'AGGRESSIVE'}</td><td class="num">${r.toFixed(2)}%</td><td class="num">$${(5000 * r / 100).toFixed(2)}</td><td class="num">${((5000 * r / 100) / (5000 * 0.021)).toFixed(2)}x</td></tr>`).join('')}</tbody></table></div>`
    : '';

  return `
    <div class="page-head" data-region="head" data-region-grow>
      <div><h1>Position Size &amp; Invalidation Bench</h1><div class="meta">Zero-Liquidation Sizing Formula (Includes 0.08% Round-Trip Taker Buffer) ${ctx.state === 'filtered' ? '· Conservative 0.5% Preset Active' : ''}</div></div>
    </div>

    <div class="kpi-strip">
      <div class="kpi-cell"><div class="meta">MAX ACCOUNT RISK</div><div class="k-val num" id="r-usd">$50.00</div></div>
      <div class="kpi-cell"><div class="meta">POSITION NOTIONAL</div><div class="k-val num" id="r-notional">$2,377.78</div></div>
      <div class="kpi-cell"><div class="meta">CONTRACTS / UNITS</div><div class="k-val num" id="r-units">0.0370 units</div></div>
      <div class="kpi-cell"><div class="meta">REWARD : RISK RATIO</div><div class="k-val num" id="r-rr">3.00R</div></div>
    </div>

    <div class="app-panel" style="padding:18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;" data-region-grow>
      <div><label class="meta" for="t-eq">Equity (USD)</label><input id="t-eq" class="app-input num" style="width:100%;" type="number" value="5000"></div>
      <div><label class="meta" for="t-rk">Risk %</label><input id="t-rk" class="app-input num" style="width:100%;" type="number" step="0.25" value="${defaultRiskVal}"></div>
      <div><label class="meta" for="t-en">Entry Price</label><input id="t-en" class="app-input num" style="width:100%;" type="number" step="any" value="64200"></div>
      <div><label class="meta" for="t-st">Invalidation Stop</label><input id="t-st" class="app-input num" style="width:100%;" type="number" step="any" value="62850"></div>
      <div><label class="meta" for="t-tg">Take Profit</label><input id="t-tg" class="app-input num" style="width:100%;" type="number" step="any" value="68250"></div>
    </div>
    ${riskLadder}
  `;
}

// ---------- VIEW: TRADE JOURNAL (#/tools/journal) ----------
async function journalView(ctx) {
  markActiveNav('/tools/journal');
  await loadBootstrap();

  if (ctx.state === 'loading') return renderLoadingKpis('Trade Execution Journal', 'Querying Firestore R-multiple history...');
  if (ctx.state === 'error') return `<div class="page-head" data-region="head" data-region-grow><h1>Trade Execution Journal</h1></div>` + renderStateNote('error', 'Failed to read journal entries.', 'Check session state and retry.', '#/tools/journal', 'Retry Sync');

  if (ctx.state === 'denied' || (stateStore.user && stateStore.user.max_tier_level < 2)) {
    return `<div class="page-head" data-region="head" data-region-grow><h1>Trade Execution Journal</h1></div>` + renderStateNote('denied', 'Level 2 ($25 Foundation) Unlocks Journal Persistence', 'Upgrade your seat to log trades, track win-rate expectancy, and export audit ledgers.', '/checkout?tier=price-action', 'Upgrade to Level 2 ($25)');
  }

  let entries = [];
  let metrics = { total: 0, winRate: 0, netR: 0, expectancyR: 0 };

  if (stateStore.user && stateStore.user.max_tier_level >= 2 && ctx.state !== 'empty' && ctx.state !== 'done') {
    const res = await fetch('/api/v1/course/journal');
    if (res.ok) {
      const data = await res.json();
      entries = data.entries || [];
      metrics = data.metrics || metrics;
    }
  }

  if (ctx.state === 'huge') {
    const sample = { id: 901, pair: 'BTCUSDT', direction: 'LONG', entry_price: 64200, stop_loss: 62850, take_profit: 68250, risk_pct: 1.0, result_r: 2.5, setup_tag: 'SWEEP_FVG', notes: 'Clean NY killzone sweep' };
    entries = Array.from({ length: 24 }, (_, i) => ({ ...sample, id: 900 + i, pair: i % 2 ? 'ETHUSDT' : 'BTCUSDT', result_r: i % 3 === 0 ? -1.0 : 2.2 }));
    metrics = { total: 24, winRate: 67, netR: 27.2, expectancyR: 1.13 };
  }

  const sideFilter = ctx.query.side || (ctx.state === 'filtered' ? 'LONG' : '');
  const visible = sideFilter ? entries.filter((e) => e.direction === sideFilter) : entries;

  ctx.onMount(() => {
    document.getElementById('journal-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!stateStore.user || stateStore.user.max_tier_level < 2) {
        toast('Sign in with Tier 2+ to save live entries.');
        return;
      }
      const res = await fetch('/api/v1/course/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair: document.getElementById('j-pair').value,
          direction: document.getElementById('j-dir').value,
          entryPrice: Number(document.getElementById('j-en').value),
          stopLoss: Number(document.getElementById('j-st').value),
          takeProfit: Number(document.getElementById('j-tp').value),
          riskPct: Number(document.getElementById('j-rk').value),
          resultR: Number(document.getElementById('j-res').value),
          setupTag: document.getElementById('j-tag').value,
          notes: document.getElementById('j-notes').value,
        }),
      });
      if (!res.ok) return toast('Failed to record trade.');
      toast('Trade logged to Firestore.');
      stateStore.loaded = false;
      ctx.refresh();
    });

    document.querySelectorAll('[data-del-trade]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const res = await fetch(`/api/v1/course/journal/${btn.dataset.delTrade}`, { method: 'DELETE' });
        if (res.ok) {
          toast('Trade deleted.');
          stateStore.loaded = false;
          ctx.refresh();
        }
      });
    });

    document.querySelectorAll('[data-side-btn]').forEach((b) => {
      b.addEventListener('click', () => ctx.setQuery({ side: b.dataset.sideBtn || '' }));
    });
  });

  if (!stateStore.user && ctx.state === 'default') {
    return `<div class="page-head" data-region="head" data-region-grow><div><h1>Trade Execution Journal</h1><div class="meta">Audit setups using fixed R-multiples</div></div></div>` + renderStateNote('denied', 'Sign In to Record & Track Live Trades', 'Use demo Tier 4 account (pro@vernier.academy) or enroll in Level 2 ($25) to save persistent journal logs.', '/login?next=/course%23/tools/journal', 'Sign In');
  }
  if (ctx.state === 'empty') {
    return `<div class="page-head" data-region="head" data-region-grow><div><h1>Trade Execution Journal</h1><div class="meta">Audit setups using fixed R-multiples</div></div></div>` + renderStateNote('empty', 'Zero Trades Logged Yet', 'Submit your first R-multiple setup below or clear active side filters.', '#/tools/journal', 'Reset View');
  }
  if (ctx.state === 'done') {
    return `<div class="page-head" data-region="head" data-region-grow><div><h1>Trade Execution Journal</h1><div class="meta">Audit setups using fixed R-multiples</div></div></div>` + renderStateNote('done', 'Weekly Review Reconciled', 'All journaled trades for this week carry verified R-multiples and tags.', '#/tools/journal', 'View Ledger');
  }

  return `
    <div class="page-head" data-region="head" data-region-grow>
      <div><h1>Trade Execution Journal</h1><div class="meta">Audit setups using fixed R-multiples — never dollar emotions</div></div>
      <div style="display:flex;gap:6px;">
        ${[['', 'ALL'], ['LONG', 'LONG'], ['SHORT', 'SHORT']].map(([v, lbl]) => `<button type="button" class="app-btn ${sideFilter === v ? 'commit' : ''}" data-side-btn="${v}">${lbl}</button>`).join('')}
      </div>
    </div>

    <div class="kpi-strip">
      <div class="kpi-cell"><div class="meta">LOGGED TRADES</div><div class="k-val num">${metrics.total}</div></div>
      <div class="kpi-cell"><div class="meta">WIN RATE</div><div class="k-val num">${metrics.winRate}%</div></div>
      <div class="kpi-cell"><div class="meta">NET R-MULTIPLE</div><div class="k-val num">${metrics.netR >= 0 ? '+' : ''}${metrics.netR}R</div></div>
      <div class="kpi-cell"><div class="meta">EXPECTANCY / TRADE</div><div class="k-val num">${metrics.expectancyR >= 0 ? '+' : ''}${metrics.expectancyR}R</div></div>
    </div>

    <form id="journal-form" class="app-panel" style="padding:14px;margin-bottom:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;align-items:end;">
      <div><label class="meta" for="j-pair">Pair</label><input id="j-pair" class="app-input" style="width:100%;" value="BTCUSDT" required></div>
      <div><label class="meta" for="j-dir">Direction</label><select id="j-dir" class="app-select" style="width:100%;"><option>LONG</option><option>SHORT</option></select></div>
      <div><label class="meta" for="j-en">Entry</label><input id="j-en" class="app-input num" style="width:100%;" type="number" step="any" value="64200"></div>
      <div><label class="meta" for="j-st">Stop</label><input id="j-st" class="app-input num" style="width:100%;" type="number" step="any" value="62850"></div>
      <div><label class="meta" for="j-tp">Target</label><input id="j-tp" class="app-input num" style="width:100%;" type="number" step="any" value="68250"></div>
      <div><label class="meta" for="j-rk">Risk %</label><input id="j-rk" class="app-input num" style="width:100%;" type="number" step="0.1" value="1"></div>
      <div><label class="meta" for="j-res">Result (R)</label><input id="j-res" class="app-input num" style="width:100%;" type="number" step="0.1" value="2.5"></div>
      <div><label class="meta" for="j-tag">Setup Tag</label><input id="j-tag" class="app-input" style="width:100%;" value="SWEEP_FVG"></div>
      <div style="grid-column:1 / -1;"><label class="meta" for="j-notes">Execution Note</label><input id="j-notes" class="app-input" style="width:100%;" placeholder="Waited for 15m close reclaim"></div>
      <div><button type="submit" class="app-btn commit" style="width:100%;">Log Setup</button></div>
    </form>

    <div class="table-wrap" data-region-grow>
      <table class="app-table">
        <thead><tr><th>Pair</th><th>Side</th><th class="num">Entry</th><th class="num">Stop</th><th class="num">Result R</th><th>Setup</th><th>Notes</th><th style="width:120px;">Action</th></tr></thead>
        <tbody>
          ${visible.map((e) => `
            <tr>
              <td class="mono" title="${esc(e.pair)}">${esc(e.pair)}</td>
              <td title="${esc(e.direction)}"><span class="status-badge ${e.direction === 'LONG' ? 'ok' : 'warn'}">${esc(e.direction)}</span></td>
              <td class="num" title="${Number(e.entry_price).toLocaleString('en-US')}">${Number(e.entry_price).toLocaleString('en-US')}</td>
              <td class="num" title="${Number(e.stop_loss).toLocaleString('en-US')}">${Number(e.stop_loss).toLocaleString('en-US')}</td>
              <td class="num" title="${Number(e.result_r).toFixed(2)}R">${Number(e.result_r) >= 0 ? '+' : ''}${Number(e.result_r).toFixed(2)}R</td>
              <td class="mono" title="${esc(e.setup_tag)}">${esc(e.setup_tag)}</td>
              <td title="${esc(e.notes)}">${esc(e.notes)}</td>
              <td title="Delete entry"><button type="button" class="app-btn" data-del-trade="${e.id}">Delete</button></td>
            </tr>
          `).join('') || '<tr><td colspan="8" class="meta">No trades recorded under current side filter.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

// ---------- VIEW: CERTIFICATES & TIER 4 AUDITS (#/community) ----------
async function communityView(ctx) {
  markActiveNav('/community');
  await loadBootstrap();

  if (ctx.state === 'loading') return renderLoadingKpis('Certificates & Desk Audits', 'Verifying issuance eligibility...');
  if (ctx.state === 'error') return `<div class="page-head" data-region="head" data-region-grow><h1>Certificates &amp; Desk Audits</h1></div>` + renderStateNote('error', 'Audit Sync Failed', 'Could not reach mentorship ledger.', '#/community', 'Retry');
  if (ctx.state === 'denied') return `<div class="page-head" data-region="head" data-region-grow><h1>Certificates &amp; Desk Audits</h1></div>` + renderStateNote('denied', 'Tier 4 Seat Required for 1-on-1 Audit', 'Upgrade to Tier 4 ($500 Institutional Vault) to submit direct portfolio audits.', '/checkout?tier=institutional-vault', 'Upgrade Tier 4');

  const user = stateStore.user;
  const certs = stateStore.overview?.certificates || [];
  let audits = [];
  if (user && user.max_tier_level >= 4) {
    const ar = await fetch('/api/v1/course/audits');
    if (ar.ok) audits = (await ar.json()).audits || [];
  }

  ctx.onMount(() => {
    document.getElementById('btn-portal-claim-cert')?.addEventListener('click', async () => {
      if (!user) return toast('Please sign in first.');
      const res = await fetch('/api/v1/course/certificates/claim', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) return toast(data.error || 'Unable to claim certificate.');
      toast(`Certificate minted: ${data.certificate.serial_code}`);
      stateStore.loaded = false;
      ctx.refresh();
    });

    document.getElementById('audit-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/api/v1/course/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolioSizeUsd: Number(document.getElementById('aud-size').value),
          focusPair: document.getElementById('aud-pair').value,
          questionText: document.getElementById('aud-q').value,
        }),
      });
      const data = await res.json();
      if (!res.ok) return toast(data.error || 'Could not submit audit.');
      toast('1-on-1 Desk Audit submitted to queue.');
      ctx.refresh();
    });
  });

  if (ctx.state === 'empty') return `<div class="page-head" data-region="head" data-region-grow><h1>Certificates &amp; Desk Audits</h1></div>` + renderStateNote('empty', 'No Certificates Minted Yet', 'Complete your unlocked lessons to mint an official verifiable credential.', '#/curriculum', 'Resume Playbooks');
  if (ctx.state === 'done') return `<div class="page-head" data-region="head" data-region-grow><h1>Certificates &amp; Desk Audits</h1></div>` + renderStateNote('done', 'Desk Audits Reviewed', 'All submitted institutional reviews have been answered by the instructor.', '/verify?serial=VRN-2026-T4-DEMO01', 'Inspect Verify Registry');

  const shownCerts = ctx.state === 'huge'
    ? Array.from({ length: 8 }, (_, i) => ({ serial_code: `VRN-2026-T4-000${i + 1}`, tier_level: 4 }))
    : ctx.state === 'filtered'
      ? certs.filter((c) => c.tier_level === 4)
      : certs;

  return `
    <div class="page-head" data-region="head" data-region-grow>
      <div><h1>Certificates, Cohort Links &amp; Desk Audits</h1><div class="meta">${ctx.state === 'filtered' ? 'Filtered: Level 4 Vault Honors Only' : 'Publicly verifiable completion serials & Tier 4 1-on-1 desk reviews'}</div></div>
      <button type="button" class="app-btn commit" id="btn-portal-claim-cert">Mint Certificate</button>
    </div>

    <div style="display:grid;gap:16px;" data-region-grow>
      <section class="app-panel" style="padding:16px;">
        <strong>Your Verified Certificates (${shownCerts.length})</strong>
        <div style="display:grid;gap:10px;margin-top:10px;">
          ${shownCerts.map((c) => `
            <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--app-line);padding-bottom:8px;">
              <div><span class="mono">${esc(c.serial_code)}</span> <span class="meta">· Tier ${c.tier_level}</span></div>
              <a class="app-btn" href="/verify?serial=${encodeURIComponent(c.serial_code)}">Public Registry Link</a>
            </div>
          `).join('') || '<div class="meta">No active certificate on this account yet. Try sample check: <code>VRN-2026-T4-DEMO01</code> on <a href="/verify" style="color:var(--accent-text);">/verify</a>.</div>'}
        </div>
      </section>

      <section class="app-panel" style="padding:16px;">
        <strong>Tier 4 ($500 Vault) — 1-on-1 Execution Audit Desk</strong>
        ${
          user && user.max_tier_level >= 4
            ? `
              <form id="audit-form" style="display:grid;gap:10px;margin-top:12px;">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">
                  <input id="aud-size" class="app-input num" type="number" value="25000" placeholder="Portfolio USD">
                  <input id="aud-pair" class="app-input" value="BTCUSDT" placeholder="Focus Pair">
                  <input id="aud-q" class="app-input" required placeholder="Describe setup, leverage cap, or portfolio hedge question...">
                </div>
                <button type="submit" class="app-btn commit" style="justify-self:start;">Submit 1-on-1 Desk Audit</button>
              </form>
              <div style="margin-top:14px;display:grid;gap:8px;">
                ${audits.map((a) => `
                  <div style="padding:10px;border:1px solid var(--app-line);background:var(--app-bg);">
                    <div class="mono" style="font-size:11px;color:var(--app-mid);">${esc(a.focus_pair)} · $${Number(a.portfolio_size_usd).toLocaleString()} · STATUS: ${esc(a.status.toUpperCase())}</div>
                    <div style="margin-top:4px;">${esc(a.question_text)}</div>
                    ${a.instructor_reply ? `<div style="margin-top:6px;color:var(--ok);">Instructor Reply: ${esc(a.instructor_reply)}</div>` : ''}
                  </div>
                `).join('') || '<div class="meta">No audit threads submitted yet.</div>'}
              </div>
            `
            : `<p class="meta" style="margin:8px 0 12px;">Locked below Tier 4 ($500 Vault). Upgrade using full prior payment credit to unlock asynchronous execution reviews.</p><a class="app-btn" href="/checkout?tier=institutional-vault">Unlock Tier 4 ($500)</a>`
        }
      </section>
    </div>
  `;
}

// ---------- MOUNT KIT ROUTER + PALETTE + HOTKEYS ----------
const app = createApp({
  root: '#view',
  routes: {
    '/': overviewView,
    '/curriculum': curriculumView,
    '/lesson/:slug': lessonView,
    '/tools/calculator': calculatorView,
    '/tools/journal': journalView,
    '/community': communityView,
  },
});

const cmdPalette = palette([
  { label: 'Overview · Blueprint Grid', key: '1', run: () => app.navigate('/') },
  { label: 'Curriculum · All 39 Playbooks', key: '2', run: () => app.navigate('/curriculum') },
  { label: 'Risk Tuner · Position Sizing Bench', key: '3', run: () => app.navigate('/tools/calculator') },
  { label: 'Trade Execution Journal', key: '4', run: () => app.navigate('/tools/journal') },
  { label: 'Certificates & 1-on-1 Desk Audit', key: '5', run: () => app.navigate('/community') },
  { label: 'Public Checkout Hub ($1–$500)', run: () => { location.href = '/checkout?tier=starter-pass'; } },
  { label: 'Account & Billing Dashboard', run: () => { location.href = '/dashboard'; } },
]);

loadBootstrap().then(({ modules }) => {
  const lessonCommands = modules.flatMap((m) =>
    (m.lessons || []).map((l) => ({
      label: `Playbook: ${l.title}`,
      keywords: `${m.title} ${l.slug}`,
      run: () => app.navigate(`/lesson/${encodeURIComponent(l.slug)}`),
    }))
  );
  cmdPalette.add(lessonCommands);
});

document.getElementById('btn-palette')?.addEventListener('click', () => cmdPalette.open());
document.getElementById('btn-theme')?.addEventListener('click', () => {
  const html = document.documentElement;
  html.dataset.theme = html.dataset.theme === 'light' ? 'dark' : 'light';
});

const searchInput = document.getElementById('portal-search');
searchInput?.addEventListener('input', () => {
  if (!location.hash.startsWith('#/curriculum')) {
    app.navigate('/curriculum', { q: searchInput.value.trim() });
  } else {
    app.setQuery({ q: searchInput.value.trim() });
  }
});

keys({
  '1': { run: () => app.navigate('/'), label: 'Overview', group: 'Portal' },
  '2': { run: () => app.navigate('/curriculum'), label: 'Curriculum', group: 'Portal' },
  '3': { run: () => app.navigate('/tools/calculator'), label: 'Risk Bench', group: 'Portal' },
  '4': { run: () => app.navigate('/tools/journal'), label: 'Trade Journal', group: 'Portal' },
  '5': { run: () => app.navigate('/community'), label: 'Certificates', group: 'Portal' },
  '/': { run: () => searchInput?.focus(), label: 'Focus search', group: 'Global' },
});
