'use strict';
const crypto = require('crypto');
const config = require('../config');

/* ----------------------------- passwords ----------------------------- */
// scrypt with a per-user random salt. Stored as "salt:hash" (hex).
function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plain), salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

function verifyPassword(plain, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(plain), salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/* --------------------------- session tokens --------------------------- */
// Compact HMAC-signed token: base64url(payload).base64url(hmac).
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function signToken(userId) {
  const payload = JSON.stringify({ uid: userId, exp: Date.now() + config.TOKEN_TTL_MS });
  const p = b64url(payload);
  const sig = crypto.createHmac('sha256', config.SERVER_SECRET).update(p).digest();
  return p + '.' + b64url(sig);
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [p, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', config.SERVER_SECRET).update(p).digest();
  const got = b64urlDecode(sig);
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return null;
  let data;
  try { data = JSON.parse(b64urlDecode(p).toString('utf8')); } catch { return null; }
  if (!data || typeof data.exp !== 'number' || Date.now() > data.exp) return null;
  return data.uid;
}

/* ------------------- secret-at-rest (xAI API keys) ------------------- */
// AES-256-GCM. Key derived from SERVER_SECRET. Output: iv:tag:ciphertext (hex).
// Derived lazily and memoized by the current secret, so a secret resolved at
// request time (e.g. from Netlify Blobs) is honored rather than a stale import.
let _encKeyFor = null, _encKey = null;
function encKey() {
  if (_encKeyFor !== config.SERVER_SECRET) {
    _encKey = crypto.scryptSync(config.SERVER_SECRET, 'ealt-key-encryption', 32);
    _encKeyFor = config.SERVER_SECRET;
  }
  return _encKey;
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

function decryptSecret(stored) {
  if (typeof stored !== 'string' || stored.split(':').length !== 3) return null;
  const [ivHex, tagHex, dataHex] = stored.split(':');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch { return null; }
}

function newId(prefix) {
  return (prefix ? prefix + '_' : '') + crypto.randomBytes(9).toString('hex');
}

module.exports = {
  hashPassword, verifyPassword,
  signToken, verifyToken,
  encryptSecret, decryptSecret,
  newId,
};
