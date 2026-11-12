/* Shared Procedural Canvas Blueprint Renderer for VERNIER (Site Lead + App Course Diagrams) */

const PAL = {
  bg: '#080d11',
  grid: 'rgba(127, 151, 156, 0.10)',
  gridStrong: 'rgba(127, 151, 156, 0.22)',
  ink: '#e4ecea',
  muted: '#7f979c',
  bull: '#2ea87e',
  bear: '#7f979c',
  bearHot: '#d45555',
  amber: '#f58a1f',
  amberSoft: 'rgba(245, 138, 31, 0.16)',
  infoSoft: 'rgba(74, 144, 184, 0.16)',
};

const CANDLES = [
  { o: 84200, h: 84650, l: 83950, c: 84500 },
  { o: 84500, h: 84920, l: 84320, c: 84850 },
  { o: 84850, h: 85100, l: 84400, c: 84520 },
  { o: 84520, h: 84980, l: 84450, c: 84940 },
  { o: 84940, h: 85120, l: 84620, c: 84710 }, // Equal High 1
  { o: 84710, h: 85110, l: 84380, c: 84420 }, // Equal High 2 (Liquidity Pool)
  { o: 84420, h: 84680, l: 83980, c: 84060 },
  { o: 84060, h: 84300, l: 83820, c: 84180 },
  { o: 84180, h: 84540, l: 83890, c: 83950 }, // Equal Low 1
  { o: 83950, h: 84260, l: 83880, c: 84120 }, // Equal Low 2
  { o: 84120, h: 84160, l: 83480, c: 83990 }, // SSL SWEEP WICK (Order Block origin!)
  { o: 83990, h: 84880, l: 83940, c: 84810 }, // Displacement + FVG
  { o: 84810, h: 85450, l: 84740, c: 85320 }, // MSS Break above swing
  { o: 85320, h: 85390, l: 84480, c: 84550 }, // Retrace into 50% FVG/OB
  { o: 84550, h: 85620, l: 84510, c: 85560 }, // Expansion
  { o: 85560, h: 86250, l: 85480, c: 86120 }, // Run above BSL Equal Highs!
];

export function renderBlueprintCanvas(canvas, options = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 720;
  const h = canvas.clientHeight || 420;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.save();
  ctx.scale(dpr, dpr);

  const mode = options.mode || 'liquidity_sweep';
  const step = Number(options.step ?? 6); // 1..6 for Lead sequence
  const symbol = options.symbol || 'BTC/USDT · PERP · 15M';

  // 1. Background & Millimetre Caliper Grid
  ctx.fillStyle = PAL.bg;
  ctx.fillRect(0, 0, w, h);

  const padL = 44;
  const padR = 68;
  const padT = 38;
  const padB = 34;
  const cw = w - padL - padR;
  const ch = h - padT - padB;

  ctx.strokeStyle = PAL.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const x = padL + (cw * i) / 10;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, h - padB);
    ctx.stroke();
  }
  for (let j = 0; j <= 6; j++) {
    const y = padT + (ch * j) / 6;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
  }

  // Vernier tick border
  ctx.strokeStyle = PAL.gridStrong;
  ctx.strokeRect(padL, padT, cw, ch);

  // Header telemetry
  ctx.fillStyle = PAL.muted;
  ctx.font = '600 11px "JetBrains Mono", monospace';
  ctx.fillText(symbol, padL, 22);
  ctx.textAlign = 'right';
  ctx.fillStyle = PAL.amber;
  ctx.fillText(options.tag || `STATE 0${Math.min(6, Math.max(1, step))} // CALIBRATED`, w - padR, 22);
  ctx.textAlign = 'left';

  if (mode === 'risk_curve') {
    drawRiskCurve(ctx, padL, padT, cw, ch);
  } else if (mode === 'oi_funding_squeeze') {
    drawOiSqueeze(ctx, padL, padT, cw, ch);
  } else if (mode === 'volume_profile_cvd') {
    drawVolumeCvd(ctx, padL, padT, cw, ch);
  } else if (mode === 'macro_rotation') {
    drawMacroRotation(ctx, padL, padT, cw, ch);
  } else if (mode === 'delta_neutral_basis') {
    drawDeltaNeutral(ctx, padL, padT, cw, ch);
  } else if (mode === 'custody_map') {
    drawCustodyMap(ctx, padL, padT, cw, ch);
  } else {
    drawPriceStructure(ctx, padL, padT, cw, ch, step, mode);
  }

  ctx.restore();
}

function drawPriceStructure(ctx, x0, y0, cw, ch, step, mode) {
  const minP = 83200;
  const maxP = 86500;
  const yOf = (p) => y0 + ch - ((p - minP) / (maxP - minP)) * ch;
  const slot = cw / CANDLES.length;

  // Price axis
  ctx.fillStyle = PAL.muted;
  ctx.font = '10px "JetBrains Mono", monospace';
  [83500, 84200, 85000, 85800].forEach((p) => {
    const y = yOf(p);
    ctx.fillText(p.toLocaleString(), x0 + cw + 8, y + 3);
  });

  // State 2+: Equal Highs (BSL) & Equal Lows (SSL)
  if (step >= 2 || mode === 'liquidity_sweep') {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(228, 236, 234, 0.45)';
    ctx.beginPath();
    ctx.moveTo(x0 + slot * 3.5, yOf(85120));
    ctx.lineTo(x0 + cw, yOf(85120));
    ctx.stroke();
    ctx.fillStyle = PAL.ink;
    ctx.fillText('BSL // EQUAL HIGHS 85,120', x0 + slot * 4, yOf(85120) - 6);

    ctx.strokeStyle = 'rgba(245, 138, 31, 0.55)';
    ctx.beginPath();
    ctx.moveTo(x0 + slot * 7.5, yOf(83880));
    ctx.lineTo(x0 + slot * 14, yOf(83880));
    ctx.stroke();
    ctx.fillStyle = PAL.amber;
    ctx.fillText('SSL SWEPT // 83,880', x0 + slot * 7.5, yOf(83880) + 14);
    ctx.restore();
  }

  // State 3+: Order Block & Fair Value Gap
  if (step >= 3 || mode === 'order_block_fvg') {
    const obX = x0 + slot * 10;
    const obTop = yOf(84160);
    const obBot = yOf(83480);
    ctx.fillStyle = PAL.infoSoft;
    ctx.fillRect(obX, obTop, cw - slot * 10, obBot - obTop);
    ctx.strokeStyle = '#4a90b8';
    ctx.strokeRect(obX, obTop, cw - slot * 10, obBot - obTop);

    const fvgTop = yOf(84740);
    const fvgBot = yOf(84160);
    ctx.fillStyle = PAL.amberSoft;
    ctx.fillRect(x0 + slot * 11, fvgTop, cw - slot * 11, fvgBot - fvgTop);
    ctx.fillStyle = PAL.amber;
    ctx.fillText('OB + FVG (50% CE)', x0 + slot * 11.2, fvgTop - 5);
  }

  // Draw Candlesticks
  const visibleCount = step === 1 ? 10 : CANDLES.length;
  for (let i = 0; i < visibleCount; i++) {
    const c = CANDLES[i];
    const cx = x0 + slot * (i + 0.5);
    const bull = c.c >= c.o;
    const bodyTop = yOf(Math.max(c.o, c.c));
    const bodyBot = yOf(Math.min(c.o, c.c));
    const color = bull ? PAL.bull : step === 1 ? PAL.bearHot : PAL.bear;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, yOf(c.h));
    ctx.lineTo(cx, yOf(c.l));
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillRect(cx - slot * 0.28, bodyTop, slot * 0.56, Math.max(2, bodyBot - bodyTop));
  }

  // State 4-5: Stop Loss, Entry & Thermal Amber Execution Strike
  if (step >= 4) {
    const entryY = yOf(84480);
    const stopY = yOf(83440);
    const tpY = yOf(86120);
    const ex = x0 + slot * 13.5;

    ctx.fillStyle = 'rgba(212, 85, 85, 0.14)';
    ctx.fillRect(ex, entryY, cw - slot * 13.5, stopY - entryY);
    ctx.fillStyle = 'rgba(46, 168, 126, 0.14)';
    ctx.fillRect(ex, tpY, cw - slot * 13.5, entryY - tpY);

    ctx.strokeStyle = PAL.amber;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ex, entryY, 5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = PAL.ink;
    ctx.fillText('ENTRY 84,480 | SL 83,440 (1.00% RISK)', ex - 120, entryY - 10);
  }

  // State 6: Settled R-Multiple
  if (step >= 6) {
    ctx.fillStyle = PAL.amber;
    ctx.font = '700 12px "JetBrains Mono", monospace';
    ctx.fillText('+3.15R TARGET HIT · LEDGER SETTLED', x0 + 16, y0 + 26);
  }
}

function drawRiskCurve(ctx, x0, y0, cw, ch) {
  ctx.font = '11px "JetBrains Mono", monospace';
  const trades = 12;
  const pts1 = [];
  const pts10 = [];
  let eq1 = 100;
  let eq10 = 100;
  for (let i = 0; i <= trades; i++) {
    pts1.push(eq1);
    pts10.push(eq10);
    eq1 *= 0.99;
    eq10 *= 0.9;
  }
  const plot = (arr, color, label) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    arr.forEach((v, i) => {
      const px = x0 + (cw * i) / trades;
      const py = y0 + ch - (v / 105) * ch;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    const last = arr[arr.length - 1];
    ctx.fillStyle = color;
    ctx.fillText(`${label}: ${last.toFixed(1)}% LEFT`, x0 + 14, y0 + ch - (last / 105) * ch - 8);
  };
  plot(pts1, PAL.bull, '1.0% RISK');
  plot(pts10, PAL.bearHot, '10.0% OVER-LEVERAGED');
}

function drawOiSqueeze(ctx, x0, y0, cw, ch) {
  const splitY = y0 + ch * 0.56;
  ctx.strokeStyle = PAL.gridStrong;
  ctx.beginPath();
  ctx.moveTo(x0, splitY);
  ctx.lineTo(x0 + cw, splitY);
  ctx.stroke();

  // Rising OI bars then liquidation drop
  const bars = [22, 28, 35, 44, 58, 72, 89, 96, 38, 31, 40, 48];
  const bw = cw / bars.length;
  bars.forEach((b, i) => {
    const bh = (b / 100) * (ch * 0.36);
    ctx.fillStyle = i >= 6 && i <= 7 ? PAL.amber : 'rgba(127, 151, 156, 0.45)';
    ctx.fillRect(x0 + bw * i + 6, y0 + ch - bh, bw - 12, bh);
  });

  ctx.fillStyle = PAL.ink;
  ctx.font = '11px "JetBrains Mono", monospace';
  ctx.fillText('CROWDED OI SPIKE + +0.09% FUNDING -> LIQUIDATION CASCADE', x0 + 14, y0 + 24);
  ctx.fillStyle = PAL.amber;
  ctx.fillText('OPEN INTEREST COLLAPSES ON SWEEP', x0 + 14, splitY + 20);
}

function drawVolumeCvd(ctx, x0, y0, cw, ch) {
  // Volume Profile horizontal bars on right edge
  const rows = [14, 24, 58, 92, 64, 20, 16, 48, 74, 30];
  const rh = ch / rows.length;
  rows.forEach((v, i) => {
    const bw = (v / 100) * (cw * 0.35);
    ctx.fillStyle = i === 3 ? PAL.amber : 'rgba(74, 144, 184, 0.35)';
    ctx.fillRect(x0 + cw - bw, y0 + i * rh + 2, bw, rh - 4);
  });
  ctx.fillStyle = PAL.amber;
  ctx.font = '11px "JetBrains Mono", monospace';
  ctx.fillText('POC // HIGH VOLUME NODE', x0 + 16, y0 + 3 * rh + 14);
  ctx.fillStyle = PAL.bull;
  ctx.fillText('SPOT CVD MAKING HIGHER LOWS (ABSORPTION)', x0 + 16, y0 + ch - 18);
}

function drawMacroRotation(ctx, x0, y0, cw, ch) {
  const boxes = [
    { label: '01 · STABLECOINS (USDT.D DOWN)', x: 0.04, y: 0.25 },
    { label: '02 · BTC LEADS (BTC.D UP)', x: 0.28, y: 0.25 },
    { label: '03 · ETH / SOL MAJORS', x: 0.54, y: 0.25 },
    { label: '04 · ALT ROTATION', x: 0.78, y: 0.25 },
  ];
  ctx.font = '11px "JetBrains Mono", monospace';
  boxes.forEach((b, idx) => {
    const bx = x0 + b.x * cw;
    const by = y0 + b.y * ch;
    const bw = cw * 0.2;
    const bh = 74;
    ctx.strokeStyle = idx === 1 ? PAL.amber : PAL.gridStrong;
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = idx === 1 ? PAL.amber : PAL.ink;
    ctx.fillText(b.label.slice(0, 16), bx + 8, by + 32);
    ctx.fillStyle = PAL.muted;
    ctx.fillText(b.label.slice(16), bx + 8, by + 50);
  });
}

function drawDeltaNeutral(ctx, x0, y0, cw, ch) {
  ctx.font = '11px "JetBrains Mono", monospace';
  ctx.strokeStyle = PAL.bull;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0 + 20, y0 + ch * 0.65);
  ctx.lineTo(x0 + cw - 20, y0 + ch * 0.28);
  ctx.stroke();

  ctx.strokeStyle = PAL.muted;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x0 + 20, y0 + ch * 0.65);
  ctx.lineTo(x0 + cw - 20, y0 + ch * 0.65);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = PAL.bull;
  ctx.fillText('+ FUNDING YIELD ACCRUAL (DELTA = 0.00)', x0 + 24, y0 + 30);
  ctx.fillStyle = PAL.muted;
  ctx.fillText('NET DIRECTIONAL EXPOSURE: HEDGED 1:1', x0 + 24, y0 + ch * 0.65 - 10);
}

function drawCustodyMap(ctx, x0, y0, cw, ch) {
  const tiers = [
    ['COLD HARDWARE VAULT', '60–80% LONG-TERM SPOT', PAL.bull],
    ['HOT EXECUTION WALLET', '10–20% DEX / GAS ONLY', PAL.muted],
    ['EXCHANGE MARGIN', 'MAX 10× TRADE RISK', PAL.amber],
  ];
  ctx.font = '11px "JetBrains Mono", monospace';
  tiers.forEach(([title, sub, col], i) => {
    const bx = x0 + 24 + i * (cw * 0.31);
    const by = y0 + ch * 0.24;
    ctx.strokeStyle = col;
    ctx.strokeRect(bx, by, cw * 0.27, ch * 0.5);
    ctx.fillStyle = col;
    ctx.fillText(title, bx + 12, by + 32);
    ctx.fillStyle = PAL.ink;
    ctx.fillText(sub, bx + 12, by + 56);
  });
}

