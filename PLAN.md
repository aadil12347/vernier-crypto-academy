FULL-STACK MASTER PLAN: CRYPTO TRADING ACADEMY ($1, $25, $100, and $500 PACKAGES)

Project Folder: e:\0.1 Antigravity Repo\Website building trading
Design Method: cinematic-ui skill (Public Website + Student Course Portal + Admin Console)
Payment Plan: Build all payment options first, and connect live Whop checkout at the final step.


SECTION 1. TECHNOLOGY STACK AND SYSTEM ARCHITECTURE

1.1 Backend and Database
  Server Runtime: Node.js v24.19.0 with Express.js
  How it runs: One unified server handles both the website pages and the API.
  Video Support: Configured with byte-range streaming so course videos seek smoothly.

  Database: Built-in Node SQLite (DatabaseSync, already active in Node 24)
  - Runs in fast WAL mode with strict data safety rules.
  - Uses clean SQL migration files so upgrading to PostgreSQL later is effortless.

  Security Protections:
  - Passwords are encrypted using Node scrypt with unique random salts.
  - Login sessions use secure HttpOnly browser cookies stored in the database.
  - Rate limiting protects login, checkout, and payment webhook endpoints.
  - Webhook endpoints verify cryptographic signatures before unlocking any course.
  - Prices are always calculated on the server (nobody can fake a price in the browser).

1.2 Frontend Design Structure (Using cinematic-ui Skill)
  Following the cinematic-ui skill rules, the public website and the logged-in
  course area are designed as two separate visual experiences:

  A. Public Marketing and Sales Pages (Site Mode)
     Pages: Home, Curriculum, Pricing, Checkout, Certificate Check, Legal Pages
     Tools: cinematic-ui kit (reel.js, grade.js, plane.js, type-fx.js, GSAP, Lenis)
     Why crisp 2D blueprints instead of heavy 3D:
       Trading charts, candlestick patterns, and risk calculators need razor-sharp
       text and clean lines on every phone and laptop without lagging.

  B. Student Course Portal and Owner Admin Console (App Mode)
     Pages: Course Learning Portal (/course), Account Dashboard, Owner Console (/admin)
     Tools: cinematic-ui app kit (app.js, fixtures.js, app-mode rules)
     Key Features:
     - Focuses on speed and daily usability rather than heavy scroll effects.
     - Full keyboard shortcuts (up/down arrows, j/k keys, quick search palette).
     - Clean right-aligned numbers for prices, risk percentages, and profits.
     - Covers every interface state: loading skeletons, empty states, locked lessons,
       error recovery messages, and large data tables.


SECTION 2. VISUAL DIRECTION (CINEMATIC-UI DIRECTOR'S CUT)

2.1 Story and Visitor Experience
  Logline:
  A trader tired of noisy hype and blown accounts enters a calm, precise execution
  room where confusing market charts become a clear step-by-step blueprint,
  starting with a $1 starter key.

  What visitors think when they arrive:
  Crypto courses are loud neon scams, and international payments get blocked.

  What visitors believe when they leave:
  Crypto trading is a disciplined skill built on liquidity, math, and risk rules,
  easy to try for $1 with smooth US-friendly payment options.

2.2 Film Direction Choice
  Chosen Film Reference: Thief (1981), directed by Michael Mann
  Why it fits:
  Instead of flashy casino graphics, every scene focuses on quiet preparation,
  close-up inspection of tools and blueprints, and precise timing before action.
  Generic purple gradients and fake neon greens are strictly avoided.

2.3 Color Palette, Lead Object, and Typography
  Colors:
  - Deep Background: Dark slate asphalt (#080d11)
  - Card Surfaces: Cool dark slate (#0f171d and #152129)
  - Main Text: Soft crisp off-white (#e4ecea)
  - Muted Labels: Cool grey-teal (#7f979c)
  - Action Accent: Warm amber (#f58a1f), used sparingly ONLY on main Buy buttons
    and active execution triggers.
  - Status Colors inside the Course Portal: Green (Done), Amber (Warning), Red (Error)

  Main Interactive Story Object:
  An interactive Bitcoin Liquidity Blueprint that transforms across 6 stages as
  you scroll down the homepage:
  Stage 1: Messy, noisy market candles
  Stage 2: Key liquidity pools and equal highs/lows highlighted
  Stage 3: Close-up zoom onto an Order Block and Fair Value Gap
  Stage 4: Live 1% risk-sizing dial calibrated to stop-loss distance
  Stage 5: Amber execution trigger locked in
  Stage 6: Completed trade recorded cleanly in the profit ledger

  Visitor Interactive Tool on the Homepage:
  A live Position Size and Risk-to-Reward Calculator right on the home screen.
  Visitors type their account size, risk percentage, entry, and stop-loss to see
  exact trade sizing and liquidation safety immediately.

  Fonts:
  - Headlines: Archivo (clean, condensed industrial style)
  - Reading Text: Instrument Sans (clear 16px to 17px body text)
  - Prices and Numbers: JetBrains Mono (aligned digits)


SECTION 3. COMPLETE LIST OF WEBSITE PAGES

PUBLIC PAGES:
  1. Home Page (/)
     - Blueprint calibration opening animation
     - Hero section with clear promise and immediate $1 Starter Key button
     - Market Chaos vs Blueprint comparison
     - 6-stage interactive Liquidity Blueprint showcase
     - Live Position Size and Risk Calculator
     - Beginner-to-Advanced Course Roadmap preview
     - All 4 Packages ($1, $25, $100, and $500) side-by-side
     - Verified Proof section, clear FAQ, and clean footer

  2. Curriculum Page (/curriculum)
     - Complete course breakdown searchable and filterable by Beginner,
       Intermediate, Advanced, and Institutional levels
     - Free preview lessons open to anyone before paying

  3. Pricing and Upgrade Page (/pricing)
     - Detailed comparison of the $1, $25, $100, and $500 packages
     - Automatic Upgrade Credit Calculator (for example, $1 buyer upgrading
       to $25 only pays the $24 difference)
     - Overview of all supported card, Apple Pay, and crypto payment options

  4. Multi-Option Checkout Page (/checkout and /checkout/package-name)
     - Package selector and promo code validator
     - Student email and quick account setup right inside checkout
     - Payment Tabs:
       Tab A: US Card, Apple Pay, Google Pay, Cash App (Whop - connected in Phase 6)
       Tab B: Crypto (USDT TRC20/BEP20/Solana, USDC, Bitcoin)
       Tab C: Local Pakistan Transfer (Bank IBAN, SadaPay, JazzCash - optional)
       Tab D: Developer Test Checkout (Active during build for instant testing)

  5. Payment Success Page (/checkout/success)
     - Payment receipt, Order Reference number, automatic login, and a direct
       button to open the Course Portal immediately

  6. Payment Pending Page (/checkout/pending)
     - Crypto wallet QR code, exact payment amount, countdown timer, Transaction
       ID submission box, and live status auto-refresh

  7. Certificate Verification Page (/verify/certificate-code)
     - Public verification lookup confirming a student completed the course

  8. Legal and Compliance Pages
     - Terms of Service (/legal/terms)
     - Privacy Policy (/legal/privacy)
     - Refund Policy (/legal/refund)
     - Crypto Trading Risk Disclosure (/legal/risk-disclosure)
     (Important: Payment processors like Whop and Stripe require these 4 pages.)

ACCOUNT AND AUTHENTICATION PAGES:
  9. Login, Register, Forgot Password, and Reset Password (/login, /register)
     - Clean login and signup forms with instant validation and auto-redirect
       into the course portal

STUDENT AND ADMIN PORTALS (APP MODE):
  10. Main Shareable Crypto Course Link (/course)
      Inside this portal, students get 6 clean views:
      - Overview: Progress bar, active package badge, and Resume Lesson button
      - Curriculum Tree: All 13 modules showing unlocked vs locked lessons
      - Lesson Player: Video player, interactive canvas chart walkthroughs,
        personal note-taking box saved to database, module quiz, and PDF downloads
      - Position Calculator: Crypto Spot and Futures sizing and liquidation tool
      - Trade Journal: Personal trade log tracking win rate and R-multiples
      - Community Access: Private Discord and Telegram verification for $100/$500

  11. Student Billing and Profile Dashboard (/dashboard)
      - Active package details, downloadable receipts, 1-click Tier Upgrade
        buttons, Discord/Telegram username linking, and Certificate download

  12. Owner Admin Console (/admin)
      - Revenue Overview: Total earnings in USD and PKR plus $1-to-$500 conversion stats
      - Orders Ledger: Search every purchase, filter by status, issue refunds
      - Approval Queue: Approve or reject manual crypto TxIDs or local bank slips
      - Student Manager: View student progress or manually unlock/upgrade tiers
      - Course Editor (CMS): Add, edit, or reorder modules, lessons, and video links
      - Promo Codes: Create percentage or fixed-dollar discount codes (like TEST100)
      - Webhook Monitor: Inspect every incoming Whop or Crypto payment signal


SECTION 4. THE 4 PACKAGES ($1, $25, $100, $500) AND FULL CRYPTO CURRICULUM

Upgrade Rule:
Buying a higher package automatically unlocks all lower packages.
Logged-in students who upgrade get credit for what they already paid
(for example, pay $1 first, later pay $24 to unlock the $25 package).

PACKAGE 1: $1.00 - STARTER PASS (Tier 1 - Beginner Foundation)
  Best for: Complete beginners testing the waters, plus your $1 live Whop test.
  Unlocks: Level 1 (Modules 1 and 2, 6 Lessons) plus the Risk Calculator.
  Lessons:
    1.1 Exchanges (Binance, Bybit, Coinbase) vs Self-Custody Wallets (Free Preview)
    1.2 Seed Phrase Safety, Avoiding Wallet Drainers, and Revoking Approvals
    1.3 Stablecoin Networks (TRC20, ERC20, Solana, Base) Without Losing Funds
    2.1 Market, Limit, Post-Only, Stop-Limit, and Reduce-Only Orders (Free Preview)
    2.2 Reading Candlesticks Cleanly Without Messy Indicators
    2.3 Basic Market Structure and the 1% Risk Preservation Rule

PACKAGE 2: $25.00 - STRUCTURAL PRICE ACTION (Tier 2 - Intermediate Core)
  Best for: Beginners building a real, repeatable Spot and Futures strategy.
  Unlocks: Everything in $1 plus Modules 3, 4, and 5 (10 Lessons) plus Trade Journal.
  Lessons:
    3.1 Liquidity Traps: Equal Highs/Lows and How Stop Hunts Work
    3.2 Asia Range, London Open, and New York Volatility Sessions
    3.3 Multi-Timeframe Analysis (Weekly Bias down to 4H and 15m Entries)
    4.1 Valid Order Blocks vs Fake Zones (Displacement and Break Rules)
    4.2 Fair Value Gaps (FVG): Exact Entry, Midpoint, and Invalidation
    4.3 Market Structure Shifts (MSS) vs Change of Character (CHoCH)
    4.4 Multi-Target Take Profits, Scaling Out, and Trailing Stops
    5.1 Setting Up a Clean, Clutter-Free TradingView Workspace
    5.2 Spot vs Perpetual Futures Leverage Math (Avoiding Liquidation Wicks)
    5.3 Pre-Trade Blueprint Checklist and Logging Your First 20 Trades

PACKAGE 3: $100.00 - PRO ORDERFLOW AND CYCLES (Tier 3 - Advanced Trader)
  Best for: Serious traders mastering derivatives data and crypto market cycles.
  Unlocks: Everything in $25 plus Modules 6 to 9 (14 Lessons) plus Community Access.
  Lessons:
    6.1 Open Interest + Price Matrix (Spotting Real Breakouts vs Short Squeezes)
    6.2 Funding Rate Extremes and Contrarian Crowd Traps
    6.3 Reading Liquidation Heatmaps and Magnetic Stop Clusters
    6.4 Exchange Netflows and Perpetual Premium Index
    7.1 Fixed-Range Volume Profile (POC, Value Area High/Low, Low-Volume Nodes)
    7.2 Spot CVD vs Perp CVD Divergence (Detecting Real Whale Absorption)
    7.3 Footprint and Delta Traps at High-Timeframe Liquidity Sweeps
    8.1 Total Market Cap (TOTAL, TOTAL2, TOTAL3) and Tether Dominance (USDT.D)
    8.2 Bitcoin Dominance (BTC.D) and ETH/BTC Altcoin Rotation Timing
    8.3 Trading CPI, FOMC, and ETF News Events Without Gambling
    8.4 Spotting Distribution Tops and Protecting Capital Before Bear Markets
    9.1 Running a 100-Trade Statistical Backtest and Calculating Expectancy
    9.2 Drawdown Psychology, Daily Loss Limits, and Stopping Revenge Trades
    9.3 Private Discord and Telegram Community Rules and Daily Briefings

PACKAGE 4: $500.00 - INSTITUTIONAL VAULT AND MENTORSHIP (Tier 4 - Mastery)
  Best for: High-conviction traders scaling capital, hedging, and automating.
  Unlocks: Everything in $100 plus Modules 10 to 13 (9 Lessons + Live Mentorship),
           1-on-1 Audit, and Verified Graduation Certificate.
  Lessons:
    10.1 Cash-and-Carry Basis Arbitrage and Delta-Neutral Funding Yield
    10.2 Hedging Long-Term Spot Holdings With Short Perpetual Overlays
    10.3 On-Chain Perp DEX Execution (Hyperliquid and dYdX) and Slippage Control
    11.1 Crypto-Friendly Prop Firm Rules and Trailing Drawdown Survival Math
    11.2 Portfolio Risk Budgeting Across Correlated Crypto Pairs
    11.3 Scaling Accounts from $1K to $10K to $100K+ Without Moving the Book
    12.1 Turning Discretionary Setups Into Exact TradingView Alert Rules
    12.2 Webhook Automation (Sending Alerts to Discord, Telegram, or Bots)
    13.1 Weekly Live New York Session Chart Breakdowns (Live and Recordings),
         1-on-1 Trade Journal Audit, and Final Mastery Assessment


SECTION 5. PROJECT FOLDER LAYOUT AND DATABASE TABLES

5.1 Project Folders
  Website building trading/
    PLAN.md                    (This master plan)
    treatment.md               (cinematic-ui script, cast, grade, shot list)
    package.json               (Node dependencies)
    .env.example               (Environment keys template)
    server.js                  (Main Node + Express server)
    db/
      connection.js            (SQLite connection)
      migrate.js               (Creates tables automatically)
      migrations/001_init.sql  (Database schema)
      seed.js                  (Loads 4 packages and all lessons)
    src/
      middleware/              (Auth checks, rate limiters, error handling)
      services/
        authService.js
        entitlementService.js  (Controls who owns which course tier)
        certificateService.js
        payments/              (PaymentAdapter, Sandbox, CryptoManual, CryptoAuto,
                                LocalPk, and WhopAdapter connected in Phase 6)
      routes/                  (auth, catalog, course, tools, checkout, webhooks, admin)
    public/
      kit/                     (Copied from cinematic-ui/kit)
      assets/                  (Images, downloadable PDFs, sample charts)
      styles/                  (tokens.css, site.css, app.css)
      js/                      (site-main.js, checkout.js, course-app.js, admin-app.js)
      HTML pages               (index, curriculum, pricing, checkout, checkout-success,
                                checkout-pending, login, course, dashboard, admin,
                                verify, and legal folder)
    tests/                     (Automated API, payment, and screening checks)

5.2 Database Tables (13 Tables in SQLite)
  1. users
     Stores student/admin ID, email, encrypted password, full name, role,
     country, Discord username, Telegram username, and signup date.

  2. sessions
     Stores active login session tokens, expiry dates, and user IDs.

  3. password_resets
     Stores secure one-time password recovery tokens and expiration times.

  4. packages
     Stores the 4 packages ($1, $25, $100, $500), tier levels (1 to 4),
     feature lists, and Whop Plan IDs.

  5. modules
     Stores the 13 course modules, difficulty level label, display order,
     and minimum tier required to unlock.

  6. lessons
     Stores each lesson's title, URL slug, free-preview flag, video URL,
     duration, lesson guide text, interactive chart config, and PDF attachments.

  7. coupons
     Stores promo codes (e.g., TEST100), percentage or dollar discount,
     expiration date, and max usage counts.

  8. orders
     Stores every order reference number, student ID, chosen package,
     payment provider used, upgrade credits, discounts, final price paid,
     status (pending, awaiting_review, paid, failed, refunded), and proof text.

  9. enrollments
     Stores active course ownership per student, which tier they unlocked,
     and links back to the paid order.

  10. lesson_progress
      Tracks whether each lesson is completed, video watch time in seconds,
      and the student's personal written notes.

  11. trade_journal_entries
      Stores each student's logged trades (coin pair, Long/Short, entry,
      stop-loss, target, risk percentage, profit/loss in R, and notes).

  12. webhook_events
      Logs every payment webhook received (Whop or Crypto) with unique event
      IDs so duplicate notifications never grant double access or crash.

  13. certificates
      Stores unique serial numbers for graduates who finish course milestones.


SECTION 6. BACKEND API ROUTES

  Authentication (/api/v1/auth)
  - POST /register             Create a new student account
  - POST /login                Sign in and set secure cookie
  - POST /logout               Sign out
  - GET  /me                   Get current user, active tier, and enrollments
  - POST /forgot-password      Request password reset link
  - POST /reset-password       Save new password
  - PATCH /profile             Update profile and Discord/Telegram handles

  Public Catalog (/api/v1/catalog)
  - GET /packages              Return $1, $25, $100, $500 tiers and upgrade quotes
  - GET /curriculum            Return syllabus (hides paid video links for guests)
  - GET /certificates/:code    Check if a graduate certificate is genuine

  Student Course Portal (/api/v1/course - Login Required)
  - GET /overview              Get completion percentage, unlocked tier, next lesson
  - GET /lessons/:slug         Check tier permission and return lesson content
  - PUT /lessons/:slug/progress  Save watched seconds, completion, and notes
  - GET /journal               Load student trade journal and win-rate stats
  - POST /journal              Save a new trade journal entry
  - DELETE /journal/:id        Remove a trade journal entry
  - POST /certificates/claim   Generate certificate when eligible

  Checkout and Payments (/api/v1/checkout)
  - POST /quote                Calculate exact price minus upgrade credit and coupon
  - POST /session              Create order and start chosen payment method
  - POST /orders/:ref/proof    Submit Crypto TxID or local bank reference number
  - GET /orders/:ref/status    Check live order status for pending payments
  - POST /sandbox/confirm      Test-mode instant approval, decline, or refund

  Payment Webhooks (/api/v1/webhooks)
  - POST /whop                 Verify Whop signature and unlock course (Phase 6)
  - POST /crypto               Verify NOWPayments / Cryptomus crypto IPN

  Owner Admin Console (/api/v1/admin - Admin Login Required)
  - GET /overview              View USD and PKR revenue and conversion stats
  - GET /orders                Search and filter all orders
  - POST /orders/:id/approve   Approve manual crypto/bank order and unlock course
  - POST /orders/:id/reject    Reject invalid payment proof
  - POST /orders/:id/refund    Refund order and lock course access cleanly
  - GET /students              Search students and view lesson progress
  - POST /students/:id/grant   Manually give or upgrade a student's tier
  - POST /cms/modules          Add or update course modules
  - POST /cms/lessons          Add or update course lessons and videos
  - GET /coupons               Create or deactivate promo codes
  - GET /webhooks              View raw webhook logs and replay failed events


SECTION 7. ALL PAYMENT OPTIONS AND FINAL WHOP INTEGRATION

How Payments Connect Cleanly:
Every payment method talks to one shared backend system (EntitlementService).
When any payment succeeds, it automatically unlocks the student's tier.
When a refund happens, it automatically revokes access. Because of this clean
design, we can build and test 100% of the website locally before connecting
your live Whop account at the very end.

All 5 Payment Options Supported:

  1. Developer Sandbox Test Checkout (Used in Phases 1 to 5)
     - Simulates US Visa, Apple Pay, Google Pay, card declines, refunds,
       and 100% off promo codes (TEST100).
     - Lets us verify the whole website without spending real money first.

  2. Direct Crypto Payments (USDT TRC20/BEP20/Solana, USDC, BTC)
     - Option A (Zero-Fee Manual Wallet): Displays your wallet address and QR
       code. The student pays and enters their Transaction ID (TxID), and you
       verify it in 1 click inside /admin.
     - Option B (Automated Crypto IPN): Optional NOWPayments or Cryptomus keys
       for automatic instant unlocking.

  3. Optional Local Pakistan Transfer (Toggle On/Off in Settings)
     - Supports SadaPay, Meezan Bank IBAN, JazzCash, and EasyPaisa with PKR
       conversion for Pakistani students who lack international USD cards.

  4. Optional Backup Global Merchant Slot
     - Clean plug-in slot ready for Lemon Squeezy if you ever want a backup.

  5. Primary US-Domestic Gateway: WHOP CHECKOUT (Integrated LAST in Phase 6)
     - Supports Apple Pay, Google Pay, Cash App Pay, Visa, Mastercard, Amex,
       Discover, Klarna/Afterpay (for $100 and $500), and Whop Crypto.
     - Processed in the USA so US student cards do not get blocked for foreign
       transfers to Pakistan.
     - You withdraw earnings in Pakistan via USDT (fastest), Direct Pakistani
       Bank IBAN (1 to 3 business days), or Payoneer (1 to 2 business days).


SECTION 8. STEP-BY-STEP BUILD ROADMAP (START TO FINISH)

  Phase 0: Pre-Production and Asset Decisions
    - Confirm the 5 quick questions in Section 9 below.
    - Write the cinematic-ui treatment, director notes, and 10-scene shot list.

  Phase 1: Backend Server, SQLite Database, and Login System
    - Set up package.json and Express server with video range support.
    - Create all 13 database tables and seed the $1, $25, $100, and $500
      packages plus all 13 beginner-to-advanced modules.
    - Build user registration, login, password reset, and tier access checks.

  Phase 2: Public Cinematic Website (Site Mode)
    - Copy fresh files from cinematic-ui/kit into public/kit.
    - Build Home (/), Curriculum (/curriculum), Pricing (/pricing),
      Certificate Check (/verify), and Legal pages.
    - Screen desktop, short laptop, mobile portrait, and reduced-motion views
      using cinematic-ui's screening scripts and fix any visual issues.

  Phase 3: Student Crypto Course Portal (/course and /dashboard - App Mode)
    - Build the logged-in learning portal using cinematic-ui app.js.
    - Build the video player, interactive canvas chart walkthroughs, lesson
      notes, Position Size Calculator, Trade Journal, and upgrade prompts.
    - Screen across all 8 UI states and dark/light themes.

  Phase 4: Owner Admin Operations Console (/admin - App Mode)
    - Build sales stats (USD and PKR), Order Ledger, Crypto TxID Approval Queue,
      Course CMS Editor, Student Manager, Coupon Builder, and Webhook Viewer.

  Phase 5: Checkout Hub and Full End-to-End Testing
    - Build /checkout, /checkout/success, and /checkout/pending.
    - Test $1, $25, $100, and $500 purchases, upgrade credits ($1 to $25),
      promo codes, crypto TxID approvals, refunds, and locked-lesson security.

  Phase 6 (FINAL STEP): Live Whop Integration and Launch
    Step 1: Create your 4 plans ($1, $25, $100, $500) inside whop.com/sell.
    Step 2: Paste your WHOP_API_KEY, WHOP_WEBHOOK_SECRET, and 4 Plan IDs into .env.
    Step 3: Turn off Sandbox test mode and enable live Whop Embedded Checkout.
    Step 4: Connect the Whop webhook to your site's /api/v1/webhooks/whop URL.
    Step 5: Run a real $1.00 live test payment, verify instant course unlocking,
            test a $1 to $25 upgrade, and confirm payout visibility in Whop.
    Step 6: Record the completed project in the cinematic-ui filmography log.


SECTION 9. QUICK QUESTIONS BEFORE WE START CODING (ASSET CALL)

Please tell me your choice on these 5 items (or just say "use your recommendations"
and I will start building Phase 1 right away):

  1. Academy Name:
     Do you have a brand name already, or should I suggest 3 strong names?

  2. Brand Logo:
     Will you send a logo file, or should I design a clean geometric SVG logo?

  3. Course Videos:
     Do you have recorded videos ready to link, or should I build complete
     written lessons plus animated canvas chart walkthroughs with clean video
     upload slots ready for you to plug MP4s into later?

  4. Instructor Info (for the $500 Mentorship Package):
     Should we show your name and bio, or keep it focused on the academy brand?

  5. Color Look and Student Proof:
     Should we use our Thief (1981) dark slate-and-amber color palette and keep
     testimonial slots clearly marked as sample structure until you add real
     student screenshots?
