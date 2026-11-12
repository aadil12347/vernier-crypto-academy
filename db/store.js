import { config } from '../src/config.js';
import { getFirestoreClient, closeFirebaseClient } from './firebaseClient.js';
import { createSqliteStore } from './stores/sqliteStore.js';
import { createFirestoreStore } from './stores/firestoreStore.js';

let sharedStore = null;

export { createSqliteStore, createFirestoreStore };

/**
 * Returns the active persistence store:
 * - Explicit `firestore` instance -> Firestore Store (useful in tests or custom wiring)
 * - Explicit `dbPath` string -> isolated SQLite Store (useful in isolated tests)
 * - Otherwise uses shared Cloud Firestore when configured, falling back to `node:sqlite`.
 */
export function getStore(options = {}) {
  if (typeof options === 'string') {
    return createSqliteStore(options);
  }
  if (options?.firestore) {
    return createFirestoreStore(options.firestore);
  }
  if (options?.dbPath) {
    return createSqliteStore(options.dbPath);
  }

  if (sharedStore) return sharedStore;

  if (config.firebase.configured) {
    const firestore = getFirestoreClient();
    sharedStore = createFirestoreStore(firestore);
  } else {
    sharedStore = createSqliteStore(config.dbPath);
  }
  return sharedStore;
}

export async function closeStore() {
  if (sharedStore) {
    const storeToClose = sharedStore;
    sharedStore = null;
    await storeToClose.close();
  }
  await closeFirebaseClient();
}

