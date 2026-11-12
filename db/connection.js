import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../src/config.js';

let dbInstance = null;

export function getDb(customPath) {
  if (dbInstance && !customPath) return dbInstance;
  const target = customPath || config.dbPath;
  if (target !== ':memory:') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  const db = new DatabaseSync(target);
  try {
    db.exec('PRAGMA journal_mode = WAL;');
  } catch {
    // Fallback cleanly if the host filesystem disallows WAL sidecar files
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (!customPath) dbInstance = db;
  return db;
}

export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

