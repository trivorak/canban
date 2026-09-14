'use strict';

const path = require('path');
const crypto = require('crypto');

const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');

const db = require('./db');
const { DB_PATH } = db;

const app = express();
const PORT = process.env.PORT || 8080;
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, '..'); // serve the project root (index.html etc.)
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days
const MIN_USERNAME = 3;
const MIN_PASSWORD = 6;

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// ---------------- Auth helpers ----------------
function issueSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(token, userId, now, now + SESSION_TTL);
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!process.env.COOKIE_SECURE, // set true behind HTTPS
    maxAge: SESSION_TTL,
  });
}

function authenticate(req) {
  const token = req.cookies && req.cookies.session;
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.user_id, s.expires_at, u.username
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { id: row.user_id, username: row.username };
}

function requireAuth(req, res, next) {
  const user = authenticate(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

// ---------------- Auth routes ----------------
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (String(username).trim().length < MIN_USERNAME) {
    return res.status(400).json({ error: `Username must be at least ${MIN_USERNAME} characters` });
  }
  if (String(password).length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
  }

  const normalized = String(username).trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(normalized);
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  const id = 'u_' + crypto.randomBytes(8).toString('hex');
  const passHash = bcrypt.hashSync(String(password), 12);
  db.prepare('INSERT INTO users (id, username, pass_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(id, normalized, passHash, Date.now());

  issueSession(res, id);
  return res.status(201).json({ user: { id, username: normalized } });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const normalized = String(username).trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(normalized);
  if (!row || !bcrypt.compareSync(String(password), row.pass_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  issueSession(res, row.id);
  return res.json({ user: { id: row.id, username: row.username } });
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies && req.cookies.session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie('session');
  return res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = authenticate(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  // node:sqlite returns rows with a null prototype, which JSON.stringify skips.
  // Copy into a plain object so the response serializes correctly.
  return res.json({ user: { id: user.id, username: user.username } });
});

// ---------------- Per-user state routes ----------------
app.get('/api/state', requireAuth, (req, res) => {
  const row = db.prepare('SELECT data FROM user_state WHERE user_id = ?').get(req.user.id);
  return res.json(row ? JSON.parse(row.data) : null);
});

app.post('/api/state', requireAuth, (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Invalid state payload' });
  }
  const json = JSON.stringify(data);
  const now = Date.now();
  const existing = db.prepare('SELECT 1 FROM user_state WHERE user_id = ?').get(req.user.id);
  if (existing) {
    db.prepare('UPDATE user_state SET data = ?, updated_at = ? WHERE user_id = ?')
      .run(json, now, req.user.id);
  } else {
    db.prepare('INSERT INTO user_state (user_id, data, updated_at) VALUES (?, ?, ?)')
      .run(req.user.id, json, now);
  }
  return res.json({ ok: true, updatedAt: now });
});

// ---------------- Static frontend ----------------
app.use(express.static(STATIC_DIR));

// Serve index.html at the root and for unknown routes (SPA-style fallback).
app.get('/', (req, res) => res.sendFile(path.join(STATIC_DIR, 'index.html')));

app.listen(PORT, () => {
  const host = process.env.HOST || '0.0.0.0';
  console.log(`[canban] listening on ${host}:${PORT}`);
  console.log(`[canban] sqlite db: ${DB_PATH}`);
});
