import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

loadEnvFile(path.join(ROOT_DIR, '.env'));

const bool = (v, fallback = false) => {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const cleanPlanId = (v) => {
  const val = String(v || '').trim();
  if (!val || val.toLowerCase().includes('placeholder')) return '';
  return val;
};

function parseServiceAccountJson(rawValue) {
  const str = String(rawValue || '').trim();
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    try {
      const decoded = Buffer.from(str, 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }
}

const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
const defaultAppUrl = vercelHost ? `https://${vercelHost}` : `http://localhost:${process.env.PORT || 3000}`;
const defaultDbPath = isVercel ? path.join(os.tmpdir(), 'vernier.sqlite') : './db/vernier.sqlite';
const defaultWhopPlanId = cleanPlanId(process.env.WHOP_DEFAULT_PLAN_ID) || 'plan_CTX7xd3gUPsgD';

const parsedServiceAccount = parseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
const firebaseProjectId = String(
  parsedServiceAccount?.project_id ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    ''
).trim();
const firebaseClientEmail = String(parsedServiceAccount?.client_email || process.env.FIREBASE_CLIENT_EMAIL || '').trim();
const firebasePrivateKey = String(parsedServiceAccount?.private_key || process.env.FIREBASE_PRIVATE_KEY || '')
  .replace(/\\n/g, '\n')
  .trim();
const firebaseDatabaseId = String(process.env.FIREBASE_DATABASE_ID || '').trim();
const firestoreEmulatorHost = String(process.env.FIRESTORE_EMULATOR_HOST || '').trim();

export const config = {
  rootDir: ROOT_DIR,
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  appUrl: process.env.APP_URL || defaultAppUrl,
  sessionSecret: process.env.SESSION_SECRET || 'vernier-dev-secret-change-in-prod',
  dbPath: path.resolve(ROOT_DIR, process.env.DB_PATH || defaultDbPath),
  firebase: {
    projectId: firebaseProjectId,
    clientEmail: firebaseClientEmail,
    privateKey: firebasePrivateKey,
    serviceAccount: parsedServiceAccount,
    databaseId: firebaseDatabaseId,
    emulatorHost: firestoreEmulatorHost,
    configured: Boolean(
      firebaseProjectId &&
        ((firebaseClientEmail && firebasePrivateKey) || firestoreEmulatorHost)
    ),
  },
  payments: {
    allowSandbox: bool(process.env.ALLOW_SANDBOX_PAYMENTS, false),
    enableCryptoManual: bool(process.env.ENABLE_CRYPTO_MANUAL, false),
    enableCryptoAuto: bool(process.env.ENABLE_CRYPTO_AUTO, false),
    enableLocalPk: bool(process.env.ENABLE_LOCAL_PK_RAILS, false),
    whopEnabled: bool(process.env.WHOP_ENABLED, true),
    pkrUsdRate: Number(process.env.PKR_USD_RATE || 278.5),
    cryptoWallets: {
      USDT_TRC20: process.env.CRYPTO_USDT_TRC20 || 'TYourTronWalletAddressHereForLiveUse',
      USDT_BEP20: process.env.CRYPTO_USDT_BEP20 || '0xYourBep20WalletAddressHereForLiveUse',
      USDC_SOL: process.env.CRYPTO_USDC_SOL || 'YourSolanaWalletAddressHereForLiveUse',
    },
    nowpayments: {
      apiKey: process.env.NOWPAYMENTS_API_KEY || '',
      ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET || '',
    },
    localPk: {
      bankTitle: process.env.PK_BANK_TITLE || 'VERNIER ACADEMY PK',
      bankName: process.env.PK_BANK_NAME || 'Meezan Bank / SadaPay',
      iban: process.env.PK_BANK_IBAN || 'PK00MEZN0000000000000000',
      jazzcash: process.env.PK_JAZZCASH_NUMBER || '0300-0000000',
    },
    whop: {
      apiKey: process.env.WHOP_API_KEY || '',
      webhookSecret: process.env.WHOP_WEBHOOK_SECRET || '',
      defaultPlanId: defaultWhopPlanId,
      plans: {
        'starter-pass': cleanPlanId(process.env.WHOP_PLAN_STARTER_1 || process.env.WHOP_PLAN_TIER_1) || defaultWhopPlanId,
        'price-action': cleanPlanId(process.env.WHOP_PLAN_ACTION_25 || process.env.WHOP_PLAN_TIER_2) || defaultWhopPlanId,
        'pro-orderflow': cleanPlanId(process.env.WHOP_PLAN_ORDERFLOW_100 || process.env.WHOP_PLAN_TIER_3) || defaultWhopPlanId,
        'institutional-vault': cleanPlanId(process.env.WHOP_PLAN_VAULT_500 || process.env.WHOP_PLAN_TIER_4) || defaultWhopPlanId,
      },
    },
  },
};
