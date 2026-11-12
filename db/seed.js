import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStore, closeStore } from './store.js';
import { hashPassword } from '../src/services/authService.js';
import { config } from '../src/config.js';

const PACKAGES = [
  {
    slug: 'starter-pass',
    name: 'Starter Pass',
    tier_level: 1,
    price_cents: 100,
    badge_code: 'T1 // $1.00',
    tagline: 'Beginner foundation, exchange/wallet defense & your live $1 execution key.',
    features: [
      'Modules 1–2 (6 Beginner Lessons)',
      'CEX vs Self-Custody & Stablecoin Network Safety',
      'Order Types (Post-Only, Reduce-Only, Stop-Limit)',
      'Candlestick Mechanics & 1% Account Risk Rule',
      'Interactive Position Size Calculator Lab',
      '$1 Upgrade Credit applied automatically toward $25+',
    ],
    whop_plan_id: config.payments.whop.plans['starter-pass'],
  },
  {
    slug: 'price-action',
    name: 'Structural Price Action',
    tier_level: 2,
    price_cents: 2500,
    badge_code: 'T2 // $25.00',
    tagline: 'Complete liquidity, Order Block, FVG & multi-timeframe crypto execution.',
    features: [
      'Everything in Starter Pass ($1)',
      'Modules 3–5 (10 Intermediate Lessons)',
      'Liquidity Sweeps, Killzones & Top-Down Mapping',
      'Valid Order Blocks, Fair Value Gaps & MSS Entries',
      'Spot vs Perp Leverage Math (Zero Surprise Liquidations)',
      'Unlocked Personal Trade Journal & Expectancy Tracker',
    ],
    whop_plan_id: config.payments.whop.plans['price-action'],
  },
  {
    slug: 'pro-orderflow',
    name: 'Pro Orderflow & Cycles',
    tier_level: 3,
    price_cents: 10000,
    badge_code: 'T3 // $100.00',
    tagline: 'Derivatives positioning, Spot vs Perp CVD, heatmaps & altcoin rotation.',
    features: [
      'Everything in Price Action ($25)',
      'Modules 6–9 (14 Advanced Lessons)',
      'Open Interest + Price Matrix & Funding Squeezes',
      'Liquidation Heatmaps, Volume Profile & CVD Absorption',
      'BTC.D, USDT.D, TOTAL2/3 & Macro Event Playbooks',
      '100-Trade Backtest System + Private Discord/Telegram Access',
    ],
    whop_plan_id: config.payments.whop.plans['pro-orderflow'],
  },
  {
    slug: 'institutional-vault',
    name: 'Institutional Vault & Mentorship',
    tier_level: 4,
    price_cents: 50000,
    badge_code: 'T4 // $500.00',
    tagline: 'Delta-neutral hedging, capital scaling, webhook bots & 1-on-1 audits.',
    features: [
      'Everything in Pro Orderflow ($100)',
      'Modules 10–13 (9 Mastery Lessons + Live Sessions)',
      'Cash-and-Carry Basis Yield & Perp Spot Hedging',
      'Prop-Firm & 6-Figure Portfolio Scaling Math',
      'TradingView Alert Codification & Webhook Bots',
      'Weekly NY Live Audits, 1-on-1 Review & Verified Certificate',
    ],
    whop_plan_id: config.payments.whop.plans['institutional-vault'],
  },
];

const MODULES = [
  { min_tier: 1, idx: 1, level: 'beginner', slug: 'm1-infrastructure', title: '01 · Infrastructure & Capital Protection', summary: 'Exchange selection, cold storage hygiene, phishing immunity & zero-error stablecoin rails.', mins: 55 },
  { min_tier: 1, idx: 2, level: 'beginner', slug: 'm2-execution-basics', title: '02 · Order Execution & Market Structure Basics', summary: 'Limit vs Market vs Post-Only execution, reading raw candles & the 1% account preservation rule.', mins: 65 },
  { min_tier: 2, idx: 3, level: 'intermediate', slug: 'm3-liquidity-sessions', title: '03 · Liquidity Engineering & Sessions', summary: 'How stop hunts clear retail highs/lows across Asia, London & New York crypto killzones.', mins: 85 },
  { min_tier: 2, idx: 4, level: 'intermediate', slug: 'm4-institutional-zones', title: '04 · Order Blocks, FVGs & Structure Shifts', summary: 'Distinguishing high-probability displacement zones from fake supply/demand traps.', mins: 110 },
  { min_tier: 2, idx: 5, level: 'intermediate', slug: 'm5-workspace-journal', title: '05 · Execution Workspace & Risk Journaling', summary: 'Clean chart rules, Spot vs Perps leverage sizing math & logging your first 20 structured trades.', mins: 70 },
  { min_tier: 3, idx: 6, level: 'advanced', slug: 'm6-derivatives-data', title: '06 · Derivatives: OI, Funding & Liquidations', summary: 'Reading leverage crowding before violent short squeezes and long cascades occur.', mins: 120 },
  { min_tier: 3, idx: 7, level: 'advanced', slug: 'm7-volume-cvd', title: '07 · Volume Profile & Cumulative Volume Delta', summary: 'Detecting Spot whale absorption behind falling perpetual futures prices.', mins: 95 },
  { min_tier: 3, idx: 8, level: 'advanced', slug: 'm8-macro-rotation', title: '08 · Macro Liquidity, BTC.D & Altcoin Cycles', summary: 'Timing capital rotation between Bitcoin, Ethereum, majors, and high-beta narratives.', mins: 105 },
  { min_tier: 3, idx: 9, level: 'advanced', slug: 'm9-backtest-psychology', title: '09 · 100-Trade Edge & Drawdown Control', summary: 'Statistical expectancy formulas, daily loss circuit breakers & community execution protocol.', mins: 80 },
  { min_tier: 4, idx: 10, level: 'institutional', slug: 'm10-hedging-basis', title: '10 · Delta-Neutral Yield & Portfolio Hedging', summary: 'Capturing positive funding rates and hedging spot portfolios during macro shocks.', mins: 115 },
  { min_tier: 4, idx: 11, level: 'institutional', slug: 'm11-scaling-prop', title: '11 · Scaling Capital & Prop-Firm Playbooks', summary: 'Surviving trailing drawdowns and managing correlation risk across 5-to-6-figure accounts.', mins: 90 },
  { min_tier: 4, idx: 12, level: 'institutional', slug: 'm12-automation-webhooks', title: '12 · Systematic Alerts & Webhook Automation', summary: 'Converting discretionary blueprint criteria into rule-based alerts and execution hooks.', mins: 85 },
  { min_tier: 4, idx: 13, level: 'institutional', slug: 'm13-mentorship-audit', title: '13 · Weekly Live Audits & 1-on-1 Review', summary: 'Live NY session tape breakdowns, 1-on-1 journal audits & final mastery certification.', mins: 90 },
];

const LESSONS = [
  // Module 1 ($1)
  {
    mod: 'm1-infrastructure', idx: 1, preview: 1, dur: 640, slug: 'cex-vs-self-custody-wallets',
    title: '1.1 Centralized Exchanges vs Self-Custody Wallets',
    diagram: { mode: 'custody_map', symbol: 'SECURITY ARCHITECTURE', caption: 'Split capital: Active margin stays bounded on Tier-1 CEX; cold reserves stay offline.' },
    md: `### Why Security Is Lesson One\nMost new crypto traders lose money before placing a bad trade—through wrong deposit networks, exchange freezes, or malicious wallet signatures.\n\n### The Three-Vault Capital Split\n1. **Cold Vault (Hardware / Multi-Sig):** Holds 60–80% of long-term BTC/ETH spot reserves. Never connects to random dApps.\n2. **Hot Execution Wallet (Phantom / Rabby):** Holds only the exact capital needed for on-chain swaps or DEX perpetuals.\n3. **Exchange Margin Account (Binance / Bybit / Coinbase):** Holds strictly active trading margin—never your life savings.\n\n### Rule to Lock In\nNever keep more than **10× your single trade risk** sitting on a high-leverage sub-account. If a trade risks $50 (1% of $5,000), only $500–$1,000 needs to sit in active perps margin.`,
    quiz: [
      { q: 'Where should 60–80% of long-term spot holdings live?', options: ['High-leverage exchange wallet', 'Offline hardware / cold custody wallet', 'Browser extension connected to new airdrops'], answer: 1 },
    ],
  },
  {
    mod: 'm1-infrastructure', idx: 2, preview: 0, dur: 720, slug: 'seed-phrase-and-phishing-defense',
    title: '1.2 Seed Phrase Hygiene & Phishing Defense',
    diagram: { mode: 'custody_map', symbol: 'APPROVAL FIREWALL', caption: 'Hardware isolation + zero-unlimited ERC20 approvals protect active wallets.' },
    md: `### Operational Security Protocol\n- **Zero cloud storage:** Seed phrases never touch screenshots, Google Drive, iCloud, Telegram Saved Messages, or password managers.\n- **Revoke approvals monthly:** Whenever you approve an unlimited token spend on a DEX, revoke stale allowances using Revoke.cash.\n- **Address poisoning check:** Never copy a destination address from transaction history; always verify the **first 6 and last 6 characters** manually.`,
    quiz: [
      { q: 'Which characters must you always verify before sending on-chain funds?', options: ['Only the first 2 characters', 'First 6 and last 6 characters from a verified address book', 'Whatever appears at the top of recent history'], answer: 1 },
    ],
  },
  {
    mod: 'm1-infrastructure', idx: 3, preview: 0, dur: 610, slug: 'stablecoin-networks-zero-error',
    title: '1.3 Stablecoin Networks (TRC20, ERC20, SOL, Base) Without Losses',
    diagram: { mode: 'custody_map', symbol: 'USDT / USDC RAILS', caption: 'Sender network must match Receiver network 1:1 — always run a $5 test transfer first.' },
    md: `### Matching Network Rails\nSending USDT on ERC20 to a TRC20 address or sending on an unsupported L2 is one of the fastest preventable losses in crypto.\n\n### Quick Cost vs Speed Reference\n- **Solana / Arbitrum / Base (USDC):** Sub-second to 2s finality, ~$0.01–$0.05 fee.\n- **TRC20 (USDT):** Widely supported by global exchanges and OTC desks, ~$1 fee.\n- **Ethereum Mainnet (ERC20):** Higher gas ($2–$15+), reserved for larger cold-storage settlements.\n\n**Mandatory Habit:** Any first-time wallet transfer above $250 gets a **$5 test packet first**.`,
    quiz: [
      { q: 'Before sending $2,000 to a brand-new exchange deposit address, what do you send first?', options: ['The full $2,000 immediately', 'A small $5 test transfer to verify chain & memo', 'Split into 20 identical transactions'], answer: 1 },
    ],
  },

  // Module 2 ($1)
  {
    mod: 'm2-execution-basics', idx: 1, preview: 1, dur: 780, slug: 'order-types-maker-vs-taker',
    title: '2.1 Market, Limit, Post-Only, Stop-Limit & Reduce-Only Orders',
    diagram: { mode: 'candlestick_basics', symbol: 'BTC/USDT // ORDER BOOK', caption: 'Post-Only Limit orders earn lower Maker fees; Reduce-Only prevents accidental flip-overs.' },
    md: `### Stop Paying Double Fees on Every Trade\nOn crypto perpetual exchanges, a **Market Order** crosses the spread immediately and pays the higher **Taker fee (~0.05%)**. On 10× leverage, entering and exiting by market eats ~1% of your margin before price even moves.\n\n### The 4 Essential Order Types\n1. **Limit (Post-Only):** Guarantees you sit on the book as a Maker (~0.01%–0.02% fee). Never accidentally fills as a Market taker.\n2. **Stop-Market:** Guarantees exit at your invalidation line (never use a Stop-Limit for your emergency stop-loss—if price gaps through your limit, you stay trapped!).\n3. **Take-Profit Limit (Reduce-Only):** Ensures partial take-profits can ONLY shrink your position, never accidentally open an opposite trade.\n4. **OCO (One Cancels the Other):** Links TP and SL together cleanly.`,
    quiz: [
      { q: 'Why should an emergency Stop-Loss almost always be Stop-Market rather than Stop-Limit?', options: ['Stop-Market guarantees execution if price plunges quickly past your trigger', 'Stop-Market has zero slippage', 'Stop-Limit costs double fees'], answer: 0 },
    ],
  },
  {
    mod: 'm2-execution-basics', idx: 2, preview: 0, dur: 840, slug: 'reading-candlesticks-without-indicators',
    title: '2.2 Reading Candlesticks Cleanly: Body, Wicks & Displacement',
    diagram: { mode: 'candlestick_basics', symbol: 'BTC/USDT // 4H TAPE', caption: 'Long upper wicks after sweeping a prior high reveal rejected buying & trapped longs.' },
    md: `### Every Candle Tells an Auction Story\nIndicators lag because they average past candles. Price and candle anatomy tell you **who got trapped right now**:\n- **Open & Close (Body):** Where institutional volume agreed to settle the period.\n- **Upper/Lower Wicks:** Failed auctions—prices tested, rejected, and pushed back inside range.\n- **Displacement Candle:** A wide-bodied candle closing near its extreme with minimal opposite wick, proving aggressive one-sided orderflow.`,
    quiz: [
      { q: 'What does a long upper wick closing back below a previous swing high indicate?', options: ['Bullish continuation guaranteed', 'Buy-side liquidity was swept and sellers rejected higher prices', 'Zero volume'], answer: 1 },
    ],
  },
  {
    mod: 'm2-execution-basics', idx: 3, preview: 0, dur: 900, slug: 'market-structure-and-one-percent-risk',
    title: '2.3 Swing Structure & The 1% Account Preservation Formula',
    diagram: { mode: 'risk_curve', symbol: 'SURVIVAL MATH // 1.00% RISK', caption: 'At 1% risk per trade, a 10-loss streak leaves 90.4% capital intact. At 10% risk, you are down 65%.' },
    md: `### The Math That Keeps You Alive\nPosition Size (Coins) = (Account Balance × Risk %) / |Entry Price - Stop Loss Price|\nNotice that **leverage does NOT determine your risk**—your **Stop-Loss distance × Position Size** determines your risk.\n\n### Rule of 1%\nRisking **1% per setup** means even a brutal 8-trade losing streak leaves **92.3%** of your account intact. Use the Position Calculator tool inside \`/course\` before every trade.`,
    quiz: [
      { q: 'With a $5,000 account and 1% max risk ($50), Entry $100,000, Stop $98,000 ($2,000 distance), what is your exact BTC position size?', options: ['0.25 BTC', '0.025 BTC ($2,500 notional)', '1.00 BTC'], answer: 1 },
    ],
  },

  // Module 3 ($25)
  {
    mod: 'm3-liquidity-sessions', idx: 1, preview: 0, dur: 960, slug: 'liquidity-traps-equal-highs-lows',
    title: '3.1 Liquidity Engineering: Equal Highs, Equal Lows & Stop Hunts',
    diagram: { mode: 'liquidity_sweep', symbol: 'ETH/USDT // BSL SWEEP', caption: 'Clustered stop-losses above equal highs act as fuel for smart money short entries.' },
    md: `### Why Price Always Hits Your Stop Before Reversing\nLarge orders cannot fill in thin air—to sell $20M of BTC without massive slippage, smart capital needs $20M of eager buyers. Where are guaranteed market buy orders clustered? **Right above obvious double-tops and equal highs** (breakout buyers + short-sellers' buy-stops).\n\n### The 3-Step Sweep Blueprint\n1. Identify clean **Equal Highs (BSL)** or **Equal Lows (SSL)**.\n2. Wait for price to pierce the level and **fail to close beyond it** on your execution timeframe.\n3. Enter only *after* a Market Structure Shift confirms the trap.`,
    quiz: [
      { q: 'What rests directly above clean Equal Highs on a crypto chart?', options: ['Sell stops and short liquidations / breakout buy orders (Buy-Side Liquidity)', 'Support', 'Nothing'], answer: 0 },
    ],
  },
  {
    mod: 'm3-liquidity-sessions', idx: 2, preview: 0, dur: 820, slug: 'asia-london-new-york-killzones',
    title: '3.2 Asia Range, London Open & New York Killzone Profiles',
    diagram: { mode: 'liquidity_sweep', symbol: 'SESSION TIMING // UTC', caption: 'Crypto trades 24/7, yet 70%+ of clean sweeps occur during London & NY equity overlaps.' },
    md: `### When Volatility Is Worth Trading\nEven though Bitcoin trades 24/7, institutional desks and CME futures flows follow strict UTC clocks:\n- **Asia Session (00:00–05:00 UTC):** Often builds a tight range (Asia High / Asia Low).\n- **London Open (07:00–10:00 UTC):** Frequently sweeps one side of the Asia range to trap early breakouts.\n- **New York Open (13:30–16:30 UTC):** Highest daily volume and US spot ETF / Nasdaq correlation expansion.`,
    quiz: [
      { q: 'Which session commonly establishes the tight initial range that London or NY sweeps?', options: ['Asia Session', 'Weekend close', 'Midnight UTC'], answer: 0 },
    ],
  },
  {
    mod: 'm3-liquidity-sessions', idx: 3, preview: 0, dur: 980, slug: 'top-down-multi-timeframe-mapping',
    title: '3.3 Top-Down Multi-Timeframe Mapping (Weekly → 4H → 15m)',
    diagram: { mode: 'order_block_fvg', symbol: 'MTF ALIGNMENT', caption: 'Never short a 5m OB directly into an unmitigated Daily FVG support zone.' },
    md: `### Solving Timeframe Whiplash\nThe #1 beginner mistake is finding a "perfect 5-minute short" directly inside a massive 4H demand zone. Lock in one strict triad:\n- **HTF Bias (Daily / 4H):** Marks external liquidity pools and macro trend.\n- **POI Frame (1H / 15m):** Where you wait for a liquidity sweep + Order Block / FVG.\n- **Trigger Frame (5m / 1m):** Only entered once price taps your 1H/4H POI.`,
    quiz: [
      { q: 'What is the purpose of the Daily / 4H chart in a top-down workflow?', options: ['Scalping 1-minute wicks', 'Setting overall directional bias and external liquidity targets', 'Ignoring risk'], answer: 1 },
    ],
  },

  // Module 4 ($25)
  {
    mod: 'm4-institutional-zones', idx: 1, preview: 0, dur: 1120, slug: 'valid-order-blocks-vs-traps',
    title: '4.1 Valid Order Blocks vs Fake Supply/Demand Zones',
    diagram: { mode: 'order_block_fvg', symbol: 'BULLISH OB + DISPLACEMENT', caption: 'A valid Order Block MUST sweep prior liquidity AND leave behind displacement + FVG.' },
    md: `### Why 90% of Drawn Order Blocks Fail\nNot every last down-candle before an up-move is an institutional Order Block. To pass the **Vernier 3-Point Filter**, the origin candle must:\n1. **Sweep prior liquidity** (or rebalance a prior inefficiency).\n2. Launch **energetic displacement** leaving an open **Fair Value Gap (FVG)**.\n3. **Break structure (BOS/MSS)** with a full candle body close—never just a wick.`,
    quiz: [
      { q: 'Which 3 conditions separate a valid Order Block from random candles?', options: ['Any red candle on a 1m chart', 'Liquidity sweep + strong displacement with FVG + clean structure break', '200 EMA cross'], answer: 1 },
    ],
  },
  {
    mod: 'm4-institutional-zones', idx: 2, preview: 0, dur: 1040, slug: 'fair-value-gaps-entry-invalidation',
    title: '4.2 Fair Value Gaps (FVG): Entry, Consequent Encroachment & Invalidation',
    diagram: { mode: 'order_block_fvg', symbol: '3-CANDLE FVG // 50% CE', caption: 'Consequent Encroachment (50% midpoint of an FVG) offers razor-tight stops and 3R+ RR.' },
    md: `### Anatomy of an Imbalance\nA **Fair Value Gap** forms across 3 consecutive candles when Candle 1's high and Candle 3's low fail to overlap, leaving an area where only buyers (or only sellers) executed.\n- **Aggressive Entry:** Proximal edge of the FVG.\n- **Precision Entry:** **50% Consequent Encroachment (CE)** for higher R-multiple.\n- **Invalidation:** Full candle body close through the far edge turns the FVG into an **Inversion FVG (IFVG)**.`,
    quiz: [
      { q: 'What is Consequent Encroachment (CE) of a Fair Value Gap?', options: ['The exact 50% midpoint of the gap', 'The 200-day high', 'Funding rate'], answer: 0 },
    ],
  },
  {
    mod: 'm4-institutional-zones', idx: 3, preview: 0, dur: 990, slug: 'mss-vs-choch-live-triggers',
    title: '4.3 Market Structure Shift (MSS) vs Change of Character',
    diagram: { mode: 'order_block_fvg', symbol: 'EXECUTION TRIGGER // MSS', caption: 'Wait for an opposing swing to break WITH displacement before committing capital.' },
    md: `### Never Catch a Falling Knife Blindly\nPredicting tops and bottoms destroys accounts. Instead of limit-buying blindly, drop one timeframe down when price hits your HTF zone and wait for a **Market Structure Shift (MSS)**—a decisive close past the most recent lower high accompanied by an FVG.`,
    quiz: [
      { q: 'What confirms a reversal at an HTF liquidity zone without blind guessing?', options: ['A Market Structure Shift (MSS) with displacement', 'RSI touching 30', 'A tweet'], answer: 0 },
    ],
  },
  {
    mod: 'm4-institutional-zones', idx: 4, preview: 0, dur: 890, slug: 'multi-target-take-profits-scaling',
    title: '4.4 Multi-Target Take Profits, Partials & Trailing Rules',
    diagram: { mode: 'risk_curve', symbol: 'TP1 2.0R // RUNNER 4.5R', caption: 'Bank 50% at internal opposing liquidity (2R); trail stop to breakeven only after structure breaks.' },
    md: `### Turning 3R Setups Into Realized Equity\nMany traders watch a +2.8R trade reverse back to -1R because they refused to pay themselves.\n- **TP1 (50% closed at 2.0R or opposing internal pool):** Covers risk and locks psychological calm.\n- **Breakeven Rule:** Move SL to entry *only after* an intermediate structural swing breaks in your favor.\n- **TP2 (Final 50% at HTF external liquidity).**`,
    quiz: [
      { q: 'When should your stop-loss move to breakeven?', options: ['Immediately after +0.2R', 'Only after price breaks intermediate structure in your favor or reaches TP1', 'Never'], answer: 1 },
    ],
  },

  // Module 5 ($25)
  {
    mod: 'm5-workspace-journal', idx: 1, preview: 0, dur: 690, slug: 'clean-tradingview-blueprint-setup',
    title: '5.1 Building a Distraction-Free TradingView Blueprint',
    diagram: { mode: 'candlestick_basics', symbol: 'CLEAN WORKSPACE', caption: 'Slate ground, clear candle contrast, session separators & zero lagging oscillators.' },
    md: `### Visual Hygiene Reduces Bad Decisions\nStrip rainbow moving averages, neon cloud indicators, and 8-pane clutter. Keep only: clean OHLC candles, Session Range boxes (Asia/London/NY), HTF Horizontal Liquidity lines, and Volume.`,
    quiz: [
      { q: 'Why remove lagging oscillators from your primary execution chart?', options: ['They hide raw price reaction at liquidity pools and slow down execution', 'They cost extra fees', 'Charts look prettier'], answer: 0 },
    ],
  },
  {
    mod: 'm5-workspace-journal', idx: 2, preview: 0, dur: 870, slug: 'spot-vs-perps-leverage-math',
    title: '5.2 Spot vs Perpetual Futures Leverage Math (Liquidation Safety)',
    diagram: { mode: 'risk_curve', symbol: 'ISOLATED VS CROSS MARGIN', caption: 'Keep liquidation price strictly beyond 2× your Stop-Loss distance; use Isolated margin for beginners.' },
    md: `### Leverage Is a Margin Tool, Not a Multiplier on Ego\nIf you want a $2,500 BTC position with only $500 on an exchange, 5× leverage makes that possible—**while keeping your Stop-Loss risk strictly at $50 (1% of your total $5,000 portfolio)**.\n- Always verify your **Estimated Liquidation Price** sits *safely past* your stop-loss so a sudden 1% wick never liquidates you before your stop fires.`,
    quiz: [
      { q: 'What is the safe rule for your liquidation price relative to your stop-loss?', options: ['Closer than the stop-loss', 'Safely further away than your stop-loss invalidation', 'Exactly equal to entry'], answer: 1 },
    ],
  },
  {
    mod: 'm5-workspace-journal', idx: 3, preview: 0, dur: 740, slug: 'pre-trade-checklist-and-first-20-trades',
    title: '5.3 Pre-Trade Blueprint Checklist & Your First 20 Logged Trades',
    diagram: { mode: 'risk_curve', symbol: '20-TRADE COHORT', caption: 'Log every setup in /course#/tools/journal before scaling beyond 0.5% risk.' },
    md: `### Earning the Right to Size Up\nComplete 20 documented setups inside the **Trade Journal** (` + '`/course#/tools/journal`' + `) following all 5 checklist items: HTF Bias → Liquidity Sweep → Zone Tap → MSS Trigger → 1% Risk Calculation.`,
    quiz: [
      { q: 'Before increasing risk per trade, what sample should every trader log?', options: ['1 lucky trade', 'At least 20 rule-compliant documented trades', '0 trades'], answer: 1 },
    ],
  },

  // Module 6 ($100)
  {
    mod: 'm6-derivatives-data', idx: 1, preview: 0, dur: 1180, slug: 'open-interest-price-matrix',
    title: '6.1 Open Interest + Price Matrix (Real Breakouts vs Squeezes)',
    diagram: { mode: 'oi_funding_squeeze', symbol: 'OI + PRICE MATRIX', caption: 'Price Up + OI Spiking at resistance = crowded longs vulnerable to a sharp long squeeze.' },
    md: `### Seeing Behind the Candlestick\nOpen Interest (OI) tracks total active futures contracts.\n- **Price Up + OI Up:** Fresh aggressive longs entering (healthy until overheated at HTF resistance).\n- **Price Up + OI Down:** Short covering squeeze—often stalls once forced buybacks finish.\n- **Price Down + OI Up:** Aggressive fresh shorting—fuel for violent upside squeezes if a sweep reclaims range.`,
    quiz: [
      { q: 'If Price rises sharply while Open Interest drops sharply, what is driving the move?', options: ['Short covering / short liquidations', 'Fresh institutional spot accumulation', 'Zero leverage'], answer: 0 },
    ],
  },
  {
    mod: 'm6-derivatives-data', idx: 2, preview: 0, dur: 940, slug: 'funding-rate-extremes-crowd-traps',
    title: '6.2 Funding Rate Extremes & Contrarian Crowd Traps',
    diagram: { mode: 'oi_funding_squeeze', symbol: '8H FUNDING // +0.08%', caption: 'Extreme positive funding (>0.05%/8h) at range highs warns late retail longs are paying to stay trapped.' },
    md: `### When Crowd Greed Pays You to Fade\nPerpetual futures stay anchored to spot prices via the 8-hour funding rate. When funding spikes past **+0.05% to +0.10%** while price stalls at weekly resistance, retail longs are overcrowded and one downward sweep triggers cascading liquidations.`,
    quiz: [
      { q: 'What does deeply negative funding at major support often foreshadow?', options: ['Crowded late short sellers exposed to an upward short squeeze', 'Guaranteed zero volatility', 'Delisting'], answer: 0 },
    ],
  },
  {
    mod: 'm6-derivatives-data', idx: 3, preview: 0, dur: 1020, slug: 'liquidation-heatmaps-magnetic-targets',
    title: '6.3 Reading Liquidation Heatmaps & Magnetic Price Targets',
    diagram: { mode: 'oi_funding_squeeze', symbol: 'LIQUIDATION CLUSTERS', caption: 'Dense 25×–50× liquidation bands act like liquidity magnets before true trend reversals.' },
    md: `### Mapping Forced Market Orders\nHigh-leverage retail entries (20×, 50×, 100×) broadcast exact liquidation bands 1%–5% away from price. Combine **Liquidation Heatmaps** with your **HTF Order Blocks**—the highest-probability reversals happen *immediately after* a dense liquidation shelf clears.`,
    quiz: [
      { q: 'When is a Liquidation Heatmap band most useful?', options: ['In isolation anywhere', 'When a dense liquidation shelf aligns directly over an HTF swing high/low sweep', 'Only on 1-second charts'], answer: 1 },
    ],
  },
  {
    mod: 'm6-derivatives-data', idx: 4, preview: 0, dur: 880, slug: 'exchange-netflows-perp-premium',
    title: '6.4 Exchange Reserve Netflows & Perpetual Premium Index',
    diagram: { mode: 'oi_funding_squeeze', symbol: 'COINBASE SPOT PREMIUM', caption: 'Positive Coinbase Spot Premium signals real US institutional spot bid leading derivatives.' },
    md: `### Spot-Led vs Leverage-Led Rallies\nCompare the **Perp Premium Index** and **Coinbase Spot Premium**. Rallies led by **spot inflows** sustain trends; rallies driven purely by **offshore perps premium** snap back viciously.`,
    quiz: [
      { q: 'Which type of crypto rally historically holds trend better?', options: ['Purely 50x perp leverage premium', 'Real Spot demand premium with rising spot CVD', 'Low-volume weekend spikes'], answer: 1 },
    ],
  },

  // Module 7 ($100)
  {
    mod: 'm7-volume-cvd', idx: 1, preview: 0, dur: 1090, slug: 'fixed-range-volume-profile',
    title: '7.1 Fixed-Range Volume Profile: POC, VAH, VAL & LVNs',
    diagram: { mode: 'volume_profile_cvd', symbol: 'FRVP // POC & VAH/VAL', caption: '70% of range volume clusters inside the Value Area; Low-Volume Nodes trigger rapid air-pocket moves.' },
    md: `### Auction Market Theory Applied to Crypto\n- **Point of Control (POC):** Highest traded volume price—acts like fair-value gravity.\n- **Value Area High/Low (VAH/VAL):** Upper and lower edges of 70% accepted value.\n- **Low-Volume Nodes (LVN):** Air pockets where price accelerates rapidly until reaching the next high-volume shelf.`,
    quiz: [
      { q: 'How does price typically behave when entering a Low-Volume Node (LVN)?', options: ['Chops sideways forever', 'Travels rapidly through the air pocket toward the next high-volume zone', 'Freezes'], answer: 1 },
    ],
  },
  {
    mod: 'm7-volume-cvd', idx: 2, preview: 0, dur: 1140, slug: 'spot-cvd-vs-perp-cvd-absorption',
    title: '7.2 Spot CVD vs Perpetual CVD Divergence (Whale Absorption)',
    diagram: { mode: 'volume_profile_cvd', symbol: 'SPOT CVD DIVERGENCE', caption: 'Price makes a lower low, Perp CVD dumps, while Spot CVD ticks higher = silent institutional accumulation.' },
    md: `### Spotting Passive Absorption Live\nWhen aggressive retail perp traders market-sell into HTF support (Perp CVD falling sharply), yet **Spot CVD rises or holds higher lows**, passive limit buyers on Spot are absorbing every panic sell before launching the reversal.`,
    quiz: [
      { q: 'What signals institutional absorption at support?', options: ['Price makes a lower low while Spot CVD makes a higher low and holds bid', 'Everyone uses 100x', 'Spot CVD collapses faster than price'], answer: 0 },
    ],
  },
  {
    mod: 'm7-volume-cvd', idx: 3, preview: 0, dur: 960, slug: 'footprint-delta-traps-at-sweeps',
    title: '7.3 Footprint & Delta Traps at Key Liquidity Sweeps',
    diagram: { mode: 'volume_profile_cvd', symbol: 'TRAPPED DELTA // EXHAUSTION', caption: 'Massive positive delta inside an upper wick with zero price progress = buyers trapped at the highs.' },
    md: `### Exhaustion Inside a Single Candle\nWhen huge positive market-buy delta prints inside the top wick of a 15m sweep candle—yet the candle closes red—every late breakout buyer is now underwater and trapped.`,
    quiz: [
      { q: 'Huge positive buy delta trapped inside a wick that closes near its low indicates:', options: ['Trapped buyers facing passive limit sellers', 'Breakout confirmation', 'Zero supply'], answer: 0 },
    ],
  },

  // Module 8 ($100)
  {
    mod: 'm8-macro-rotation', idx: 1, preview: 0, dur: 980, slug: 'total-market-cap-and-usdtd',
    title: '8.1 TOTAL, TOTAL2, TOTAL3 & Tether Dominance (USDT.D) Signals',
    diagram: { mode: 'macro_rotation', symbol: 'USDT.D INVERSE CONFLUENCE', caption: 'When USDT.D hits major HTF resistance while BTC taps daily support, probability stacks sharply.' },
    md: `### Reading Crypto Liquidity at Macro Scale\n- **USDT.D** moves inversely to crypto prices as traders rotate between stablecoins and risk assets.\n- **TOTAL2 & TOTAL3** expose whether altcoins are genuinely gaining breadth or merely bleeding against Bitcoin.`,
    quiz: [
      { q: 'How does USDT Dominance (USDT.D) normally move relative to BTC?', options: ['Inversely — falling USDT.D indicates stablecoins deploying into crypto', 'Identically', 'Unrelated'], answer: 0 },
    ],
  },
  {
    mod: 'm8-macro-rotation', idx: 2, preview: 0, dur: 1050, slug: 'btc-dominance-ethbtc-altseason',
    title: '8.2 Bitcoin Dominance (BTC.D) & ETH/BTC Altcoin Rotation',
    diagram: { mode: 'macro_rotation', symbol: 'CAPITAL ROTATION FLOW', caption: 'USD -> BTC -> ETH/SOL Majors -> Mid-Cap Narratives -> Cycle Reset.' },
    md: `### Why Altcoins Bleed When BTC Moves First\nCapital flows cleanly in 4 phases: **Bitcoin leads** (BTC.D climbs) → **Bitcoin consolidates near highs** while **ETH/BTC bottoms** → **Majors & Mid-Caps outperform** → **Retail froth signals exit**. Never hold illiquid micro-caps during a rising BTC.D breakdown.`,
    quiz: [
      { q: 'When is altcoin outperformance statistically cleanest?', options: ['During a sharp BTC crash', 'When BTC stabilizes near range highs and BTC.D rolls over from resistance', 'During zero volume'], answer: 1 },
    ],
  },
  {
    mod: 'm8-macro-rotation', idx: 3, preview: 0, dur: 890, slug: 'trading-cpi-fomc-etf-flows',
    title: '8.3 Navigating CPI, FOMC & Spot ETF Flows Without Gambling',
    diagram: { mode: 'macro_rotation', symbol: 'NEWS WHIPSAW FILTER', caption: 'First 15-minute post-FOMC spike frequently traps both directions; wait for the 30m settlement candle.' },
    md: `### The 30-Minute Macro Rule\nNever hold thin 10-pip stops across CPI or FOMC announcements—spread widening alone can slip your fill by 2×. Let the initial liquidity whipsaw clear both sides, then trade the settled direction.`,
    quiz: [
      { q: 'Why avoid placing tight stops 2 minutes before FOMC or CPI?', options: ['Spread widening and two-sided sweeps produce heavy slippage', 'Exchanges close permanently', 'Fees drop to zero'], answer: 0 },
    ],
  },
  {
    mod: 'm8-macro-rotation', idx: 4, preview: 0, dur: 910, slug: 'spotting-distribution-tops',
    title: '8.4 Spotting Cycle Distribution Tops & Bear Market Preservation',
    diagram: { mode: 'macro_rotation', symbol: 'DISTRIBUTION BLUEPRINT', caption: 'Flat/lower highs on Spot CVD + rising euphoric funding + retail inflows = exit discipline.' },
    md: `### Keeping What You Made\nBull markets make traders wealthy; bear markets reveal who keeps it. Watch for **multiple weekly supply taps, declining Spot CVD, meme-mania leverage spikes, and lost Weekly market structure** to rotate back into T-bill / stablecoin safety.`,
    quiz: [
      { q: 'What preserves bull-market profits when weekly structure turns bearish?', options: ['Averaging down 20x perps', 'Systematically rotating back into stablecoins and hedging spot', 'Deleting the app'], answer: 1 },
    ],
  },

  // Module 9 ($100)
  {
    mod: 'm9-backtest-psychology', idx: 1, preview: 0, dur: 920, slug: '100-trade-backtest-expectancy',
    title: '9.1 Running a 100-Trade Statistical Backtest & Expectancy Formula',
    diagram: { mode: 'risk_curve', symbol: 'EXPECTANCY = (WR*AW)-(LR*AL)', caption: 'A 42% win rate at 2.8R average winner delivers +0.60R per trade (+60R over 100 trades).' },
    md: `### Proving Edge Before Risking Real Capital\nExpectancy (R) = (Win% × Avg Win R) - (Loss% × 1R)\nEven a **40% win rate** makes massive returns if your average winner captures **2.5R to 3.0R** and losers stay capped strictly at **-1.0R**.`,
    quiz: [
      { q: 'If Win Rate is 40% with 3.0R average win and 1.0R average loss, what is your Expectancy per trade?', options: ['+0.60R per trade', '-0.20R per trade', '0.00R'], answer: 0 },
    ],
  },
  {
    mod: 'm9-backtest-psychology', idx: 2, preview: 0, dur: 840, slug: 'drawdown-psychology-tilt-circuit-breaker',
    title: '9.2 Drawdown Psychology & Hard Daily Loss Circuit Breakers',
    diagram: { mode: 'risk_curve', symbol: 'MAX DAILY LOSS: -2.0R', caption: 'Lock trading access for 24h automatically if daily realized losses reach -2R.' },
    md: `### Institutional Circuit Breakers\nProfessional prop desks have automated risk managers that lock terminals after **2R or 3R daily drawdown**. Adopt the **Two-Strike Rule**: two consecutive losing setups in one day ends your session immediately.`,
    quiz: [
      { q: 'What does the Two-Strike Rule enforce?', options: ['Doubling size on trade 3', 'Ending the trading session immediately after 2 losses to stop revenge trading', 'Switching to 100x leverage'], answer: 1 },
    ],
  },
  {
    mod: 'm9-backtest-psychology', idx: 3, preview: 0, dur: 600, slug: 'community-execution-protocol',
    title: '9.3 Private Discord & Telegram Community Protocol',
    diagram: { mode: 'custody_map', symbol: 'DAILY NY / LONDON BRIEFS', caption: 'Link your Discord/Telegram handle in /dashboard to sync Tier 3 & Tier 4 roles.' },
    md: `### How to Use Community Briefings Properly\nNever blindly copy another trader's limit order. Compare your own **Daily HTF Liquidity Map** against our session briefings inside \`#/community\` to sharpen independent pattern recognition.`,
    quiz: [
      { q: 'How should you use shared daily chart levels?', options: ['Blindly copy without knowing invalidation', 'Cross-check against your own HTF bias and 1% risk calculation', 'Bet 50% of account'], answer: 1 },
    ],
  },

  // Module 10 ($500)
  {
    mod: 'm10-hedging-basis', idx: 1, preview: 0, dur: 1180, slug: 'cash-and-carry-basis-arbitrage',
    title: '10.1 Cash-and-Carry Basis Arbitrage & Delta-Neutral Yield',
    diagram: { mode: 'delta_neutral_basis', symbol: 'SPOT LONG + 1X PERP SHORT', caption: 'Zero directional price exposure while harvesting positive annualized funding yield (10%–35% APR).' },
    md: `### Earning Yield Regardless of Market Direction\nDuring bullish euphoria, perpetual longs pay **+0.03% to +0.08% every 8 hours** (30%–85% annualized). By holding **1 BTC Spot** and shorting **1× Perp (1 BTC)** on low leverage, price swings net to zero while you collect funding payments cleanly.`,
    quiz: [
      { q: 'In a 1x Spot Long + 1x Perp Short basis trade, what is your net BTC price exposure?', options: ['Delta-neutral (zero directional exposure)', '2x Long', '2x Short'], answer: 0 },
    ],
  },
  {
    mod: 'm10-hedging-basis', idx: 2, preview: 0, dur: 990, slug: 'hedging-spot-bags-with-short-perps',
    title: '10.2 Hedging Long-Term Spot Holdings Using Short Perp Overlays',
    diagram: { mode: 'delta_neutral_basis', symbol: 'PORTFOLIO DELTA OVERLAY', caption: 'Protect tax-locked or staked spot holdings by shorting 25%–50% notional at weekly resistance.' },
    md: `### Dynamic Portfolio Protection\nInstead of panic-selling long-term spot holdings during a major macro pullback, open a partial **0.5× short hedge on BTC/ETH perps** at confirmed Weekly Distribution shifts to stabilize dollar equity.`,
    quiz: [
      { q: 'Why hedge spot holdings with partial perp shorts at weekly distribution?', options: ['To protect USD equity without liquidating staked or long-term spot positions', 'To pay extra fees', 'To increase beta'], answer: 0 },
    ],
  },
  {
    mod: 'm10-hedging-basis', idx: 3, preview: 0, dur: 920, slug: 'onchain-perp-dex-execution',
    title: '10.3 On-Chain Perp DEX Execution (Hyperliquid / dYdX) & Slippage',
    diagram: { mode: 'delta_neutral_basis', symbol: 'SELF-CUSTODY PERP ORDERBOOK', caption: 'Execute non-custodial perpetual trades with limit ladders & zero CEX withdrawal delays.' },
    md: `### Reducing Counterparty Risk on Size\nLearn how institutional traders route size across **Hyperliquid and dYdX**, manage cross-margin gas buffers, and split large orders with **TWAP / Scale Ladders** to cut market impact.`,
    quiz: [
      { q: 'Which order method helps execute larger sizes with minimal book slippage?', options: ['Single huge Market order', 'TWAP / Scaled limit orders across liquidity', 'Random clicks'], answer: 1 },
    ],
  },

  // Module 11 ($500)
  {
    mod: 'm11-scaling-prop', idx: 1, preview: 0, dur: 1060, slug: 'prop-firm-trailing-drawdown-math',
    title: '11.1 Prop-Firm Rules, Trailing Drawdowns & Survival Math',
    diagram: { mode: 'risk_curve', symbol: 'MAX DD 5% // 0.35% PER TRADE', caption: 'Size risk strictly as a fraction of ALLOWED DRAWDOWN (not nominal account size!).' },
    md: `### The Real Math of Passing & Keeping Funded Accounts\nA "$100,000 funded account" with a **5% max drawdown ($5,000)** is effectively a **$5,000 risk account**. Risking $1,000 per trade gives you only 5 losses before termination! Sizing **$250 risk (0.25% nominal = 5% of drawdown buffer)** gives you a **20-loss buffer** to pass smoothly.`,
    quiz: [
      { q: 'On a $100K account with a $5,000 max drawdown, what is your TRUE risk capital?', options: ['$100,000', '$5,000 (the drawdown allowance)', '$1,000,000'], answer: 1 },
    ],
  },
  {
    mod: 'm11-scaling-prop', idx: 2, preview: 0, dur: 930, slug: 'portfolio-correlation-caps',
    title: '11.2 Portfolio Risk Budgeting Across Correlated Crypto Pairs',
    diagram: { mode: 'macro_rotation', symbol: 'CORRELATION HEAT CAP', caption: 'Long BTC + Long ETH + Long SOL + Long AVAX = ONE leveraged beta bet (4× hidden risk!).' },
    md: `### Hidden Correlation Blowups\nWhen Bitcoin drops 4%, altcoins drop 8%–12% simultaneously. Never risk 1% each across four correlated longs at the same time—cap **Total Open Correlated Portfolio Heat at 2.0%**.`,
    quiz: [
      { q: 'Why is opening 4 simultaneous 1% longs on BTC, ETH, SOL, and DOGE dangerous?', options: ['In a BTC selloff they move together, creating ~4% correlated exposure at once', 'They cancel each other out', 'Exchanges forbid 4 trades'], answer: 0 },
    ],
  },
  {
    mod: 'm11-scaling-prop', idx: 3, preview: 0, dur: 880, slug: 'scaling-capital-1k-to-100k',
    title: '11.3 Scaling $1K → $10K → $100K+ Without Emotional Slippage',
    diagram: { mode: 'risk_curve', symbol: 'STEPWISE R SCALING', caption: 'Step up dollar risk by +25% only after every +10R realized milestone—never overnight.' },
    md: `### Conditioning Your Nervous System\nJumping from $20 risk to $1,000 risk overnight triggers hesitation and premature exits. Use **Stepwise R-Progression**: increase dollar risk by **20%–25% only after closing +10R net profit** at your current tier.`,
    quiz: [
      { q: 'How should dollar risk increase as your equity grows?', options: ['Jump 10x immediately', 'Step up 20%–25% systematically after verified +10R milestones', 'Randomly'], answer: 1 },
    ],
  },

  // Module 12 ($500)
  {
    mod: 'm12-automation-webhooks', idx: 1, preview: 0, dur: 940, slug: 'codifying-rules-into-binary-alerts',
    title: '12.1 Turning Discretionary Rules Into Binary TradingView Alerts',
    diagram: { mode: 'order_block_fvg', symbol: 'BINARY IF/THEN SPEC', caption: 'Replace vague feelings with deterministic conditions: HTF Sweep + MSS Close + Session Window.' },
    md: `### Eliminating Screen Fatigue\nStop staring at 5-minute charts for 8 hours a day. Map exact price alert corridors at your 4H/1H POIs so you ONLY sit down at your desk when price enters a high-probability execution window.`,
    quiz: [
      { q: 'What is the primary benefit of structured HTF POI alerts?', options: ['Staring at charts 18 hours a day', 'Preserving focus and reacting only when price reaches pre-planned zones', 'Entering blindly'], answer: 1 },
    ],
  },
  {
    mod: 'm12-automation-webhooks', idx: 2, preview: 0, dur: 1020, slug: 'webhook-alert-architecture',
    title: '12.2 Webhook Architecture (Discord / Telegram / Execution Hooks)',
    diagram: { mode: 'delta_neutral_basis', symbol: 'JSON WEBHOOK PIPELINE', caption: 'TradingView JSON alert -> Signed Webhook -> Telegram Execution Prompt / Paper Bot.' },
    md: `### Building Your Personal Alert Desk\nRoute structured JSON payloads from TradingView webhooks straight into private Telegram/Discord execution rooms with pre-calculated entry, stop distance, and position size.`,
    quiz: [
      { q: 'What does a structured alert payload include?', options: ['Symbol, timeframe, price trigger & invalidation zone', 'Memes', 'Seed phrase'], answer: 0 },
    ],
  },

  // Module 13 ($500)
  {
    mod: 'm13-mentorship-audit', idx: 1, preview: 0, dur: 1200, slug: 'weekly-ny-session-audits-and-certificate',
    title: '13.1 Weekly NY Live Audits, 1-on-1 Journal Review & Mastery Certification',
    diagram: { mode: 'liquidity_sweep', symbol: 'INSTITUTIONAL CHECKOUT', caption: 'Submit your 1-on-1 portfolio audit below and claim your verified VERNIER Certificate.' },
    md: `### Final Mastery Milestone\nWelcome to the top tier of **VERNIER**. Submit your trade journal cohort or portfolio allocation question directly inside the **1-on-1 Audit Form** in this lesson portal, join weekly New York Open tape sessions, and claim your verifiable **Tier 4 Graduation Certificate**.`,
    quiz: [
      { q: 'Which three pillars sustain long-term institutional crypto profitability?', options: ['Edge (Liquidity + Orderflow) + 1% Risk Discipline + Execution Review', 'High leverage + luck + signals', 'Never using stops'], answer: 0 },
    ],
  },
];

const COUPONS = [
  { code: 'TEST100', discountType: 'percent', discountValue: 100, minTierLevel: 1, maxUses: 5000 },
  { code: 'FOUNDER20', discountType: 'percent', discountValue: 20, minTierLevel: 2, maxUses: 1000 },
  { code: 'DESK10', discountType: 'fixed', discountValue: 1000, minTierLevel: 3, maxUses: 500 },
];

export async function seedDatabase(store = getStore(), { force = false } = {}) {
  if (typeof store.init === 'function') {
    await store.init();
  }

  // Fast skip on warm Cloud Firestore / SQLite when catalog + plan IDs are already present
  if (!force && (await store.isCatalogSeeded(LESSONS.length))) {
    return;
  }

  await store.upsertCatalog({
    packages: PACKAGES,
    modules: MODULES,
    lessons: LESSONS,
    coupons: COUPONS,
  });

  // Seed Dev Admin & Demo Student Accounts (only if not yet present)
  await store.ensureSeedUser({
    email: 'admin@vernier.academy',
    passwordHash: hashPassword('AdminVernier!2026'),
    fullName: 'Vernier Lead Desk',
    role: 'admin',
    country: 'PK',
  });
  const starterStudentId = await store.ensureSeedUser({
    email: 'student@vernier.academy',
    passwordHash: hashPassword('TraderTest!2026'),
    fullName: 'Marcus Vance (Demo $1)',
    role: 'student',
    country: 'US',
  });
  const vaultStudentId = await store.ensureSeedUser({
    email: 'pro@vernier.academy',
    passwordHash: hashPassword('VaultTest!2026'),
    fullName: 'Elena Rostova (Demo $500)',
    role: 'student',
    country: 'US',
  });

  const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

  // Give Demo Starter student Tier 1 ($1) & sample Whop order if they have 0 enrollments
  if (!(await store.hasUserEnrollments(starterStudentId))) {
    const p1 = await store.getPackageBySlug('starter-pass');
    if (p1) {
      await store.seedOrderAndEnrollment({
        orderRef: 'ORD-DEMO-0001',
        userId: starterStudentId,
        packageId: p1.id,
        tierLevel: 1,
        provider: 'whop',
        providerPaymentId: 'pay_whop_demo_1',
        grossCents: 100,
        finalCents: 100,
        paidAt: threeDaysAgo,
      });
    }
  }

  // Give Demo Vault student Tier 4 ($500) + verified certificate + sample trade journal entries
  if (!(await store.hasUserEnrollments(vaultStudentId))) {
    const p4 = await store.getPackageBySlug('institutional-vault');
    if (p4) {
      await store.seedOrderAndEnrollment({
        orderRef: 'ORD-DEMO-0500',
        userId: vaultStudentId,
        packageId: p4.id,
        tierLevel: 4,
        provider: 'whop',
        providerPaymentId: 'pay_whop_demo_500',
        grossCents: 50000,
        finalCents: 50000,
        paidAt: sevenDaysAgo,
      });
      await store.ensureCertificate({
        serialCode: 'VRN-2026-T4-DEMO01',
        userId: vaultStudentId,
        tierLevel: 4,
      });
      await store.seedJournalEntries([
        {
          userId: vaultStudentId,
          pair: 'BTC/USDT',
          direction: 'LONG',
          entryPrice: 88400,
          stopLoss: 87650,
          takeProfit: 90650,
          riskPct: 1.0,
          resultR: 3.0,
          setupTag: 'BSL_SWEEP+FVG',
          notes: 'NY open swept Asia low + 15m MSS displacement.',
        },
        {
          userId: vaultStudentId,
          pair: 'ETH/USDT',
          direction: 'SHORT',
          entryPrice: 3240,
          stopLoss: 3290,
          takeProfit: 3140,
          riskPct: 1.0,
          resultR: -1.0,
          setupTag: 'OB_TAP',
          notes: 'Stopped cleanly; waited for next NY sweep.',
        },
        {
          userId: vaultStudentId,
          pair: 'SOL/USDT',
          direction: 'LONG',
          entryPrice: 178.5,
          stopLoss: 174.2,
          takeProfit: 189.2,
          riskPct: 1.0,
          resultR: 2.49,
          setupTag: 'SPOT_CVD_ABSORB',
          notes: 'Spot CVD rising while perp funding went negative.',
        },
      ]);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await seedDatabase(getStore(), { force: true });
  console.log('Seed completed cleanly: 4 packages ($1, $25, $100, $500), 13 modules, 39 lessons.');
  await closeStore();
}
