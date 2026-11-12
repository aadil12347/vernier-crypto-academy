import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../src/config.js';

let sharedDb = null;

function createSqliteRunner(rawDb) {
  return {
    dialect: 'sqlite',
    async queryOne(sql, params = []) {
      const row = rawDb.prepare(sql).get(...params);
      return row === undefined ? null : row;
    },
    async queryAll(sql, params = []) {
      return rawDb.prepare(sql).all(...params);
    },
    async execute(sql, params = []) {
      const info = rawDb.prepare(sql).run(...params);
      return {
        changes: Number(info.changes || 0),
        lastInsertId: info.lastInsertRowid !== undefined ? Number(info.lastInsertRowid) : null,
      };
    },
    async insertReturningId(sql, params = []) {
      const cleaned = sql.replace(/\s+RETURNING\s+id\s*;?\s*$/i, '');
      const info = rawDb.prepare(cleaned).run(...params);
      return Number(info.lastInsertRowid);
    },
    async exec(sql) {
      rawDb.exec(sql);
    },
  };
}

export function createSqliteDb(filePath = config.dbPath) {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const rawDb = new DatabaseSync(filePath);
  try {
    rawDb.exec('PRAGMA journal_mode = WAL;');
  } catch {
    // Fallback cleanly if host filesystem disallows WAL sidecar files
  }
  rawDb.exec('PRAGMA foreign_keys = ON;');
  rawDb.exec('PRAGMA busy_timeout = 5000;');

  const runner = createSqliteRunner(rawDb);
  let txQueue = Promise.resolve();

  return {
    ...runner,
    rawDb,
    transaction(fn) {
      // Serialize async transactions on single-file SQLite so nested requests never collide on BEGIN
      const run = txQueue.then(async () => {
        rawDb.exec('BEGIN;');
        try {
          const result = await fn(runner);
          rawDb.exec('COMMIT;');
          return result;
        } catch (err) {
          try {
            rawDb.exec('ROLLBACK;');
          } catch {
            // Ignore rollback error
          }
          throw err;
        }
      });
      txQueue = run.catch(() => {});
      return run;
    },
    async close() {
      rawDb.close();
    },
  };
}

export function getDb(options = {}) {
  const customPath = typeof options === 'string' ? options : options?.dbPath;
  if (customPath) {
    return createSqliteDb(customPath);
  }
  if (!sharedDb) {
    sharedDb = createSqliteDb(config.dbPath);
  }
  return sharedDb;
}

export async function closeDb() {
  if (sharedDb) {
    const dbToClose = sharedDb;
    sharedDb = null;
    await dbToClose.close();
  }
}
