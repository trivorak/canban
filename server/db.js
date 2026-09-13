'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// DB file location — overridable so the container can point it at a mounted volume.
const DB_PATH = process.env.CANBAN_DB_PATH || path.join(__dirname, 'data', 'canban.db');

// Make sure the directory exists.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE,
    pass_hash  TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- Per-user state stored as a single JSON blob (same shape as the old localStorage).
  CREATE TABLE IF NOT EXISTS user_state (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

module.exports = db;
module.exports.DB_PATH = DB_PATH;
