import { initializeApp, cert, getApps, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from '../src/config.js';

let cachedApp = null;
let cachedFirestore = null;

export function isFirebaseConfigured() {
  return {
    hasProjectId: Boolean(config.firebase.projectId),
    hasCredentials: Boolean(
      (config.firebase.clientEmail && config.firebase.privateKey) || config.firebase.emulatorHost
    ),
    hasEmulator: Boolean(config.firebase.emulatorHost),
    databaseId: config.firebase.databaseId || '(default)',
    activeBackend: config.firebase.configured ? 'firebase-firestore' : 'sqlite-local',
  };
}

export function getFirestoreClient(overrides = {}) {
  if (cachedFirestore && !overrides.projectId && !overrides.databaseId) {
    return cachedFirestore;
  }

  const projectId = overrides.projectId || config.firebase.projectId;
  const clientEmail = overrides.clientEmail || config.firebase.clientEmail;
  const privateKey = overrides.privateKey || config.firebase.privateKey;
  const databaseId = overrides.databaseId ?? config.firebase.databaseId;
  const emulatorHost = overrides.emulatorHost || config.firebase.emulatorHost;

  if (!projectId) return null;
  if (!emulatorHost && (!clientEmail || !privateKey)) return null;

  const appName = overrides.appName || 'vernier-firebase';
  let app = getApps().find((a) => a.name === appName) || null;
  if (!app) {
    const options = emulatorHost
      ? { projectId }
      : {
          projectId,
          credential: cert({
            projectId,
            clientEmail,
            privateKey,
          }),
        };
    app = initializeApp(options, appName);
  }

  const firestore =
    databaseId && databaseId !== '(default)' ? getFirestore(app, databaseId) : getFirestore(app);
  try {
    firestore.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() may throw if already called in hot reload; safe to ignore
  }

  if (!overrides.projectId && !overrides.databaseId) {
    cachedApp = app;
    cachedFirestore = firestore;
  }
  return firestore;
}

export async function closeFirebaseClient() {
  if (cachedApp) {
    const toDelete = cachedApp;
    cachedApp = null;
    cachedFirestore = null;
    await deleteApp(toDelete).catch(() => {});
  }
}

