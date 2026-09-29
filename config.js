'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/**
 * Configuration. Everything has a safe local-dev default so the server runs
 * out of the box; override via environment variables (see .env.example) in
 * production. NEVER ship the default SERVER_SECRET.
 */

// Minimal .env loader (zero-dependency). Values already in the real
// environment win; .env only fills what's missing.
(function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch { /* ignore — defaults apply */ }
})();

// Resolve the server secret. If none is provided (or the old dev placeholder is
// present), generate a cryptographically strong one and persist it to a
// gitignored `.secret` file so it stays stable across restarts. This guarantees
// the insecure default is NEVER used — no manual step required before deploy.
function resolveSecret() {
  const provided = process.env.SERVER_SECRET;
  if (provided && provided !== 'dev-only-secret-change-me-in-production') return provided;
  const secretFile = process.env.SECRET_FILE || path.join(__dirname, '.secret');
  try {
    if (fs.existsSync(secretFile)) {
      const saved = fs.readFileSync(secretFile, 'utf8').trim();
      if (saved) return saved;
    }
    const fresh = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretFile, fresh, { mode: 0o600 });
    return fresh;
  } catch {
    // If the file can't be written (read-only FS, etc.), fall back to a
    // per-process random secret — still never the shared insecure default.
    return crypto.randomBytes(48).toString('hex');
  }
}

module.exports = {
  PORT: parseInt(process.env.PORT || '8787', 10),
  HOST: process.env.HOST || '127.0.0.1',

  // Secret used to sign session tokens and derive the encryption key.
  // Auto-generated + persisted if not supplied (see resolveSecret above).
  SERVER_SECRET: resolveSecret(),

  // Where the JSON datastore lives. The file store does durable, atomic,
  // in-process-serialized writes (see lib/store.js) — fine through launch scale;
  // swap the store module for Postgres when you outgrow a single node.
  DATA_FILE: process.env.DATA_FILE || path.join(__dirname, 'data.json'),

  // Session token lifetime (7 days).
  TOKEN_TTL_MS: 7 * 24 * 60 * 60 * 1000,

  // xAI / Grok — OpenAI-compatible API.
  XAI_BASE_URL: process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
  XAI_MODEL: process.env.XAI_MODEL || 'grok-4',
  // Optional global key (used when a user hasn't connected their own).
  XAI_API_KEY: process.env.XAI_API_KEY || '',

  // Everest ALT's margin on each fulfilled gift.
  GIFT_MARGIN: 0.15,

  // Budget cycle length (days) before the monthly cap refreshes.
  BUDGET_CYCLE_DAYS: 30,
};
