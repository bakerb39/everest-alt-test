'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * Datastore with a pluggable driver.
 *
 *  • 'file' (default): a durable, atomic JSON file. Writes are synchronous, so
 *    they're serialized within the process (no data races); the payload is
 *    fsync'd to a temp file then renamed over the live file, so a crash can't
 *    corrupt it. This is what `node server.js` uses. Safe through launch scale
 *    on a single node.
 *
 *  • 'memory': the whole DB lives in memory for the life of the request. The
 *    serverless adapter (Netlify Function) hydrates it from durable storage
 *    (Netlify Blobs) before handling, and persists a snapshot afterwards. This
 *    keeps ALL business logic below fully synchronous — the async I/O happens
 *    only at the request boundary.
 *
 * All persistence is confined to this module; swap the driver (or this file for
 * Postgres) without touching the call sites.
 */
const EMPTY = { users: {}, recipients: {}, gifts: {}, idempotency: {} };
let db = null;
let mode = 'file';
let dirty = false;

/* ------- driver control (used by the serverless adapter) ------- */
function useMemoryDriver() { mode = 'memory'; db = null; dirty = false; }
function hydrate(obj) { db = Object.assign({}, JSON.parse(JSON.stringify(EMPTY)), obj || {}); dirty = false; }
function snapshot() { return load(); }
function isDirty() { return dirty; }

function load() {
  if (db) return db;
  if (mode === 'memory') { db = JSON.parse(JSON.stringify(EMPTY)); return db; }
  try {
    const raw = fs.readFileSync(config.DATA_FILE, 'utf8');
    db = Object.assign({}, JSON.parse(JSON.stringify(EMPTY)), JSON.parse(raw));
  } catch {
    db = JSON.parse(JSON.stringify(EMPTY));
  }
  return db;
}

function save() {
  dirty = true;
  if (mode !== 'file') return; // memory driver persists once, at request end
  const dir = path.dirname(config.DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Durable atomic write: flush to a temp file, fsync, then rename over the live
  // file so a crash mid-write can never leave a corrupt database.
  const tmp = config.DATA_FILE + '.tmp';
  const data = JSON.stringify(load(), null, 2);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, config.DATA_FILE);
}

/* ------- users (keyed by lowercased email) ------- */
function getUserByEmail(email) {
  const d = load();
  return d.users[String(email).toLowerCase()] || null;
}
function getUserById(id) {
  const d = load();
  return Object.values(d.users).find((u) => u.id === id) || null;
}
function putUser(user) {
  const d = load();
  d.users[user.email.toLowerCase()] = user;
  save();
  return user;
}

/* ------- recipients (keyed by id, scoped to userId) ------- */
function addRecipient(r) {
  const d = load();
  d.recipients[r.id] = r;
  save();
  return r;
}
function listRecipients(userId) {
  const d = load();
  return Object.values(d.recipients).filter((r) => r.userId === userId);
}
function getRecipient(id) {
  return load().recipients[id] || null;
}

/* ------- gifts (ledger) ------- */
function addGift(g) {
  const d = load();
  d.gifts[g.id] = g;
  save();
  return g;
}
function listGifts(userId) {
  const d = load();
  return Object.values(d.gifts)
    .filter((g) => g.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/* ------- idempotency (key -> giftId) ------- */
function getIdempotent(key) {
  const d = load();
  return d.idempotency[key] || null;
}
function putIdempotent(key, giftId) {
  const d = load();
  d.idempotency[key] = giftId;
  save();
}

module.exports = {
  load, save,
  useMemoryDriver, hydrate, snapshot, isDirty,
  getUserByEmail, getUserById, putUser,
  addRecipient, listRecipients, getRecipient,
  addGift, listGifts,
  getIdempotent, putIdempotent,
};
