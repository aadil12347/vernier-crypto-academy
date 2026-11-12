import { createReel } from '/kit/reel.js';
import { createGrade, applyLook } from '/kit/grade.js';
import { uiPlane } from '/kit/plane.js';
import { typeFx } from '/kit/type-fx.js';
import { renderBlueprintCanvas } from '/js/blueprint-canvas.js';

const BP_MODES = {
  1: { mode: 'candlestick_basics', code: '01 / MARKET STRUCTURE', title: 'HIGHER TIMEFRAME SWINGS & BOS', metric: 'BIAS: BULLISH HH/HL' },
  2: { mode: 'liquidity_sweep', code: '02 / LIQUIDITY SWEEP', title: 'EQUAL LOW STOP-RUN & RECLAIM', metric: 'TARGET: +3.00R' },
  3: { mode: 'order_block_fvg', code: '03 / FVG IMBALANCE', title: 'FAIR VALUE GAP DISPLACEMENT FILL', metric: 'ENTRY: 50% FVG EQ' },
  4: { mode: 'risk_curve', code: '04 / INVALIDATION RISK', title: 'FIXED 1.0R POSITION SIZING CURVE', metric: 'MAX RISK: 1.00% EQ' },
  5: { mode: 'oi_funding_squeeze', code: '05 / CVD & OPEN INTEREST', title: 'OI DIVERGENCE & FUNDING SQUEEZE', metric: 'FUNDING: -0.025%' },
  6: { mode: 'custody_map', code: '06 / COLD CUSTODY VAULT', title: '2-OF-3 MULTISIG & EXCHANGE CAP', metric: 'HOT CAP: <= 15%' },
};

const SCENE_CODES = {
  arrival: '01',
  contrast: '02',
  blueprint: '03',
  calculator: '04',
  packages: '05',
  roadmap: '06',
  faq: '07',
  dispatch: '08',
};

function dismissLoader(immediate = false) {
  const loader = document.getElementById('cal-loader');
  const fill = document.getElementById('cal-bar-fill');
  if (!loader) return;
  if (immediate) {
    if (fill) fill.style.width = '100%';
    loader.classList.add('done');
    return;
  }
  if (fill) fill.style.width = '100%';
  setTimeout(() => loader.classList.add('done'), 160);
}

function initHeroAndBpCanvas() {
  const heroCanvas = document.getElementById('hero-canvas');
  if (heroCanvas) renderBlueprintCanvas(heroCanvas, { mode: 'liquidity_sweep', symbol: 'BTC-USDT PERP', step: 2 });

  const bpCanvas = document.getElementById('bp-canvas');
  const codeEl = document.getElementById('bp-active-code');
  const titleEl = document.getElementById('bp-board-title');
  const metricEl = document.getElementById('bp-board-metric');
  const buttons = [...document.querySelectorAll('[data-bp-step]')];

  function setBpStep(step) {
    const cfg = BP_MODES[step] || BP_MODES[2];
    buttons.forEach((b) => {
      const on = Number(b.dataset.bpStep) === Number(step);
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (codeEl) codeEl.textContent = cfg.code;
    if (titleEl) titleEl.textContent = cfg.title;
    if (metricEl) metricEl.textContent = cfg.metric;
    if (bpCanvas) renderBlueprintCanvas(bpCanvas, { mode: cfg.mode, symbol: 'VERNIER LAB', step: Number(step) });
  }

  buttons.forEach((btn) => btn.addEventListener('click', () => setBpStep(btn.dataset.bpStep)));
  setBpStep(2);
  return { setBpStep };
}

function initRiskCalculator() {
  const eq = document.getElementById('calc-equity');
  const rk = document.getElementById('calc-risk');
  const en = document.getElementById('calc-entry');
  const st = document.getElementById('calc-stop');
  const tg = document.getElementById('calc-target');
  const fe = document.getElementById('calc-fee');
  if (!eq || !en || !st) return;

  const outRisk = document.getElementById('out-risk-usd');
  const outNotional = document.getElementById('out-notional');
  const outUnits = document.getElementById('out-units');
  const outRr = document.getElementById('out-rr');
  const outRewardUsd = document.getElementById('out-reward-usd');
  const outBe = document.getElementById('out-breakeven');
  const outDist = document.getElementById('out-stop-dist');

  function recompute() {
    const equity = Math.max(0, Number(eq.value) || 0);
    const riskPct = Math.max(0.05, Number(rk.value) || 1);
    const entry = Math.max(0.0001, Number(en.value) || 1);
    const stop = Math.max(0.0001, Number(st.value) || 0.9);
    const target = Math.max(0.0001, Number(tg.value) || entry * 1.03);
    const feePct = Math.max(0, Number(fe.value) || 0) / 100;

    const maxRiskUsd = equity * (riskPct / 100);
    const stopDistFrac = Math.max(0.0005, Math.abs(entry - stop) / entry);
    const effectiveLossFrac = stopDistFrac + feePct;
    const notional = maxRiskUsd / effectiveLossFrac;
    const units = notional / entry;
    const rewardFrac = Math.abs(target - entry) / entry;
    const rr = rewardFrac / effectiveLossFrac;
    const projGain = notional * (rewardFrac - feePct);
    const breakeven = rr > 0 ? (1 / (1 + rr)) * 100 : 100;

    outRisk.textContent = `$${maxRiskUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    outNotional.textContent = `$${notional.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    outUnits.textContent = `${units.toFixed(4)} units (${(notional / Math.max(1, equity)).toFixed(2)}x eff. lev)`;
    outRr.textContent = `${rr.toFixed(2)}R`;
    outRewardUsd.textContent = `Proj. net gain ${projGain >= 0 ? '+' : ''}$${projGain.toFixed(2)}`;
    outBe.textContent = `${breakeven.toFixed(1)}%`;
    outDist.textContent = `Stop distance: ${(stopDistFrac * 100).toFixed(2)}%`;
  }

  [eq, rk, en, st, tg, fe].forEach((input) => input.addEventListener('input', recompute));
  recompute();
}

async function hydrateAuthAndCredits() {
  try {
    const [meRes, pkgRes] = await Promise.all([
      fetch('/api/v1/auth/me'),
      fetch('/api/v1/catalog/packages'),
    ]);
    if (meRes.ok) {
      const { user } = await meRes.json();
      const authLink = document.getElementById('nav-auth-link');
      if (user && authLink) {
        authLink.textContent = user.role === 'admin' ? 'Admin Console' : 'Dashboard';
        authLink.href = user.role === 'admin' ? '/admin' : '/dashboard';
      }
    }
    if (pkgRes.ok) {
      const { packages } = await pkgRes.json();
      for (const pkg of packages) {
        const card = document.querySelector(`[data-pkg-slug="${pkg.slug}"]`);
        if (!card) continue;
        const priceEl = card.querySelector('.pkg-price');
        const noteEl = card.querySelector('[data-credit-note]');
        const btnEl = card.querySelector('.btn');
        if (pkg.owned) {
          if (noteEl) noteEl.textContent = 'OWNED IN PORTFOLIO';
          if (btnEl) {
            btnEl.textContent = 'Open Unlocked Modules';
            btnEl.href = '/course';
          }
        } else if (pkg.upgrade_credit_cents > 0) {
          const effDollars = Math.round(pkg.effective_price_cents / 100);
          const creditDollars = Math.round(pkg.upgrade_credit_cents / 100);
          if (priceEl) priceEl.textContent = `$${effDollars}`;
          if (noteEl) noteEl.textContent = `Includes -$${creditDollars} upgrade credit`;
          if (btnEl) btnEl.textContent = `Upgrade for $${effDollars}`;
        }
      }
    }
  } catch {
    // Non-blocking fallback keeps static SSR copy intact
  }
}

function initCineReel(setBpStep) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gsap = window.gsap;
  if (!gsap) {
    dismissLoader(true);
    return;
  }

  // Michael Mann / Thief sodium-vapor slate look published to window.__grade for screening
  const grade = createGrade({
    clock: false,
    spec: {
      palette: ['#080d11', '#f58a1f', '#0f171d'],
      ground: '#080d11',
      ink: '#e4ecea',
    },
  });
  applyLook(grade.look, {
    saturation: 0.92,
    contrast: 1.04,
    temperature: -0.06,
    grain: 0,
    vignette: 0.22,
  });
  window.__grade = grade;

  const LenisCtor = window.Lenis;
  const lenis = !reduced && LenisCtor ? new LenisCtor({ autoRaf: false, lerp: 0.1 }) : null;
  const reel = createReel({ gsap, lenis, reducedMotion: reduced });

  const edgeCode = document.getElementById('edge-scene-code');
  const edgeFill = document.getElementById('edge-fill');
  const edgePct = document.getElementById('edge-pct');

  const board = document.getElementById('plane-board');
  const fitMag = board?.parentElement ? Math.min(0.95, Math.max(0.4, (board.parentElement.clientWidth - 24) / 780)) : 0.9;
  const planeRig = board
    ? uiPlane(board, {
        dof: false,
        pose: { mag: fitMag, pitch: 8, roll: -1.5, yaw: -5, persp: 2200, fx: 390, fy: 230, cx: 0.5, cy: 0.5 },
      })
    : null;
  if (planeRig) planeRig.apply();
  let lastAutoStep = 2;

  const statementEl = document.getElementById('contrast-statement');
  const statementFx = statementEl
    ? typeFx(statementEl, 'read-fill', { colors: ['#4c6166', '#e4ecea'], reduced })
    : null;

  const pkgHeadingEl = document.getElementById('pkg-heading');
  const pkgFx = pkgHeadingEl
    ? typeFx(pkgHeadingEl, 'select-box', {
        target: 'Weight.',
        colors: ['#e4ecea', '#f58a1f', '#080d11'],
        label: 'SPEC L1-L4',
        reduced,
      })
    : null;

  if (reduced) {
    if (statementFx) statementFx.p = 1;
    if (pkgFx) pkgFx.p = 1;
    dismissLoader(true);
  } else {
    dismissLoader(false);
    reel.intro((tl) => {
      tl.from('#hero-title .line-mask > span', { yPercent: 105, duration: 0.7, stagger: 0.07, ease: 'power3.out' }, 0)
        .from('#hero-blueprint-card', { opacity: 0.3, scale: 0.98, duration: 0.65, ease: 'power2.out' }, 0.1);
    });
  }

  reel.scene('arrival', ({ main, q }) => {
    main.fromTo(q('#hero-blueprint-card'), { y: 0 }, { y: -14 }, 0);
  });

  reel.scene('contrast', ({ enter, main, frame }) => {
    enter.fromTo(frame, { clipPath: 'inset(12% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)', ease: 'power2.out' }, 0);
    if (statementFx) main.fromTo(statementFx, { p: 0.12 }, { p: 1, duration: 0.5 }, 0);
  });

  reel.scene('blueprint', ({ main }) => {
    if (planeRig) {
      const m = board?.parentElement ? Math.min(0.95, Math.max(0.4, (board.parentElement.clientWidth - 24) / 780)) : fitMag;
      main.fromTo(
        planeRig.pose,
        { pitch: 12, yaw: -8, roll: -2, mag: m * 0.92 },
        { pitch: 2, yaw: 1.5, roll: 0, mag: m, duration: 0.55 },
        0
      );
    }
    const ticker = { stepProgress: 1 };
    main.fromTo(
      ticker,
      { stepProgress: 1 },
      {
        stepProgress: 6,
        duration: 0.65,
        onUpdate: () => {
          const s = Math.max(1, Math.min(6, Math.round(ticker.stepProgress)));
          if (s !== lastAutoStep) {
            lastAutoStep = s;
            setBpStep(s);
          }
          if (planeRig) planeRig.apply();
        },
      },
      0
    );
  });

  reel.scene('packages', ({ main }) => {
    if (pkgFx) main.fromTo(pkgFx, { p: 0 }, { p: 1, duration: 0.45 }, 0);
  });

  let lastFillStr = '';
  let lastPctStr = '';
  let lastCodeStr = '';

  reel.onFrame((f) => {
    grade.render(f.time || 0);
    if (planeRig) planeRig.apply();
    const prog = Math.max(0, Math.min(1, f.progress || 0));
    if (edgeFill) {
      const fillStr = `${(prog * 100).toFixed(1)}%`;
      if (fillStr !== lastFillStr) {
        edgeFill.style.height = fillStr;
        lastFillStr = fillStr;
      }
    }
    if (edgePct) {
      const pctStr = `${String(Math.round(prog * 100)).padStart(2, '0')}%`;
      if (pctStr !== lastPctStr) {
        edgePct.textContent = pctStr;
        lastPctStr = pctStr;
      }
    }
    if (edgeCode && f.scene?.name && SCENE_CODES[f.scene.name]) {
      const codeStr = SCENE_CODES[f.scene.name];
      if (codeStr !== lastCodeStr) {
        edgeCode.textContent = codeStr;
        lastCodeStr = codeStr;
      }
    }
  });

  reel.start();
}

const { setBpStep } = initHeroAndBpCanvas();
initRiskCalculator();
hydrateAuthAndCredits();
initCineReel(setBpStep);
