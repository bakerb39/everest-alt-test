'use strict';
/**
 * Netlify Function adapter for the Everest ALT API.
 *
 * Netlify runs this on demand (serverless) instead of a long-lived server, and
 * its filesystem isn't persistent — so the datastore lives in Netlify Blobs
 * (built in, no extra account). Each request: hydrate the DB from Blobs → run
 * the shared router (all business logic, fully synchronous) → persist back to
 * Blobs if anything changed. The static UI is served by Netlify from public/.
 *
 * netlify.toml rewrites /api/* to this function.
 */
const crypto = require('crypto');
const config = require('../../config');
const store = require('../../lib/store');
const { handleApi } = require('../../lib/api');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

store.useMemoryDriver(); // module-level: this process serves via Blobs, not a file

function getBlobs(event) {
  // Lazy require so local `node server.js` never needs this package installed.
  const { connectLambda, getStore } = require('@netlify/blobs');
  // Lambda-compatible handlers do not receive the automatic Blobs context.
  // Netlify passes it on the event; connect before opening a store.
  connectLambda(event);
  return getStore('everest-alt');
}

// Resolve the signing/encryption secret. An env var wins (set SERVER_SECRET in
// the Netlify UI for the most robust setup). Otherwise we persist a generated
// one in Blobs so it stays stable across cold starts and instances.
async function ensureSecret(blobs) {
  const env = process.env.SERVER_SECRET;
  if (env && env !== 'dev-only-secret-change-me-in-production') { config.SERVER_SECRET = env; return; }
  let s = await blobs.get('secret', { type: 'text' });
  if (!s) { s = crypto.randomBytes(48).toString('hex'); await blobs.set('secret', s); }
  config.SERVER_SECRET = s;
}

function lower(headers) {
  const out = {};
  for (const k in (headers || {})) out[k.toLowerCase()] = headers[k];
  return out;
}

function pathnameOf(event) {
  let raw = event.rawUrl || event.path || '/';
  let pathname;
  try { pathname = new URL(raw, 'http://x').pathname; } catch { pathname = event.path || '/'; }
  // If the rewrite exposed the function path, map it back to /api/*.
  const marker = '/.netlify/functions/api';
  if (pathname.startsWith(marker)) pathname = '/api' + pathname.slice(marker.length);
  return pathname;
}

exports.handler = async (event) => {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  let blobs;
  try {
    blobs = getBlobs(event);
    await ensureSecret(blobs);
    const dbObj = await blobs.get('db', { type: 'json' });
    store.hydrate(dbObj || {});
  } catch (e) {
    return { statusCode: 500, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS),
      body: JSON.stringify({ error: 'storage unavailable', detail: String(e && e.message) }) };
  }

  // Parse body.
  let body = null;
  if (method === 'POST' || method === 'PUT') {
    let raw = event.body || '';
    if (event.isBase64Encoded && raw) raw = Buffer.from(raw, 'base64').toString('utf8');
    if (!raw) body = {};
    else { try { body = JSON.parse(raw); } catch { body = null; } }
  }

  let result;
  try {
    result = await handleApi({ method, pathname: pathnameOf(event), headers: lower(event.headers), body });
  } catch (e) {
    result = { status: 500, json: { error: 'server error', detail: String(e && e.message) } };
  }

  // Persist any mutation back to durable storage.
  try { if (store.isDirty()) await blobs.setJSON('db', store.snapshot()); }
  catch (e) { return { statusCode: 500, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS),
    body: JSON.stringify({ error: 'could not save', detail: String(e && e.message) }) }; }

  return {
    statusCode: result.status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS),
    body: JSON.stringify(result.json),
  };
};
