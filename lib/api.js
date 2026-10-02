'use strict';
const config = require('../config');
const store = require('./store');
const budget = require('./budget');
const gifts = require('./gifts');
const grok = require('./grok');
const sec = require('./security');

/**
 * Transport-neutral API router. Both the Node server (server.js) and the
 * Netlify Function (netlify/functions/api.js) call handleApi() with a plain
 * context and turn the result into their own response type.
 *
 *   ctx = { method, pathname, headers (lowercased keys), body (parsed obj|null) }
 *   -> { status, json }
 *
 * `body` is already parsed by the adapter; a malformed JSON body arrives as
 * null so routes can return 400.
 */
function publicUser(u) {
  return { id: u.id, email: u.email, budget: budget.summary(u), grok: { connected: !!(u.grok && u.grok.connected), mode: u.grok && u.grok.mode, model: u.grok && u.grok.model } };
}
function isEmail(s) { return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); }
function authUser(headers) {
  const h = headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const uid = sec.verifyToken(token);
  return uid ? store.getUserById(uid) : null;
}
const ok = (status, json) => ({ status, json });

async function handleApi(ctx) {
  const p = ctx.pathname;
  const method = ctx.method;
  const headers = ctx.headers || {};
  const body = ctx.body;

  if (method === 'OPTIONS') return ok(204, {});
  if (p === '/api/simulation-categories' && method === 'GET') return ok(200, { categories: gifts.CATEGORIES });
  if (p === '/api/health') return ok(200, { ok: true, time: new Date().toISOString(), model: config.XAI_MODEL, xaiGlobalKey: !!config.XAI_API_KEY });

  if (p.startsWith('/api/oauth/')) {
    const out = await require('./oauth').route(ctx, authUser(headers));
    if (out) return out;
  }

  // ---- auth (public) ----
  if (p === '/api/signup' && method === 'POST') {
    if (!body) return ok(400, { error: 'invalid JSON' });
    if (!isEmail(body.email)) return ok(400, { error: 'valid email required' });
    if (typeof body.password !== 'string' || body.password.length < 6) return ok(400, { error: 'password must be 6+ chars' });
    if (store.getUserByEmail(body.email)) return ok(409, { error: 'account already exists' });
    const user = { id: sec.newId('usr'), email: String(body.email).toLowerCase(), password: sec.hashPassword(body.password),
      budget: { monthlyCap: 0, spent: 0, cycleStart: Date.now() }, grok: { connected: false }, createdAt: Date.now() };
    store.putUser(user);
    return ok(201, { token: sec.signToken(user.id), user: publicUser(user) });
  }
  if (p === '/api/login' && method === 'POST') {
    if (!body) return ok(400, { error: 'invalid JSON' });
    const user = store.getUserByEmail(body.email || '');
    if (!user || !sec.verifyPassword(body.password || '', user.password)) return ok(401, { error: 'invalid email or password' });
    return ok(200, { token: sec.signToken(user.id), user: publicUser(user) });
  }

  // ---- everything below requires auth ----
  let user = authUser(headers);
  let mcpAuthStatus = null;
  if (p === '/api/mcp' && !user) {
    const token = (headers.authorization || '').replace(/^Bearer /, '');
    mcpAuthStatus = await require('./oauth').inspectToken(token);
    user = mcpAuthStatus.ok ? mcpAuthStatus.user : null;
  }
  if (p === '/api/mcp' && !user) {
    const challenge = 'Bearer resource_metadata="https://papaya-cassata-7e507b.netlify.app/.well-known/oauth-protected-resource", scope="gifts:simulate", error="invalid_token", error_description="Authentication required for Everest ALT"';
    return {
      status: 401,
      headers: { 'WWW-Authenticate': challenge, 'Cache-Control': 'no-store', 'X-Everest-Auth-Diagnostic': mcpAuthStatus ? mcpAuthStatus.reason : 'NO_BEARER_TOKEN' },
      json: {
        error: 'invalid_token',
        error_description: 'Everest ALT OAuth authentication failed.',
        auth_diagnostic: mcpAuthStatus ? mcpAuthStatus.reason : 'NO_BEARER_TOKEN'
      }
    };
  }
  if (p.startsWith('/api/') && !user) return ok(401, { error: 'authentication required' });

  if (p === '/api/mcp') return require('./photos').attachPhotos(require('./mcp').handleMcp(user, ctx));

  if (p === '/api/me' && method === 'GET') return ok(200, { user: publicUser(user) });

  if (p === '/api/budget' && method === 'POST') {
    if (!body) return ok(400, { error: 'invalid JSON' });
    try { return ok(200, { budget: budget.setCap(user, body.monthlyCap) }); }
    catch (e) { return ok(e.status || 400, { error: e.message }); }
  }

  if (p === '/api/connect/grok' && method === 'POST') {
    if (!body) return ok(400, { error: 'invalid JSON' });
    if (body.apiKey) {
      const key = String(body.apiKey).trim();
      if (!key.startsWith('xai-') || key.length > 512) return ok(400, { error: 'Enter a valid xAI API key.' });
      try { user.grok = user.grok || {}; user.grok.model = await grok.validateApiKey(key); }
      catch (e) { return ok(e.status || 502, { error: e.message }); }
      user.grok = user.grok || {};
      user.grok.apiKeyEnc = sec.encryptSecret(key);
      user.grok.mode = 'xai';
    } else {
      user.grok = user.grok || {};
      delete user.grok.apiKeyEnc;
      delete user.grok.model;
      user.grok.mode = 'mock'; // demo without a real key
    }
    user.grok.connected = true;
    user.grok.connectedAt = Date.now();
    store.putUser(user);
    return ok(200, { grok: { connected: true, mode: user.grok.mode, model: user.grok.model } });
  }

  if (p === '/api/recipients' && method === 'POST') {
    if (!body) return ok(400, { error: 'invalid JSON' });
    if (!body.name) return ok(400, { error: 'name required' });
    const r = store.addRecipient({ id: sec.newId('rcp'), userId: user.id, name: String(body.name).slice(0, 80),
      relationship: body.relationship ? String(body.relationship).slice(0, 80) : null,
      occasions: Array.isArray(body.occasions) ? body.occasions.slice(0, 20) : [], createdAt: Date.now() });
    return ok(201, { recipient: r });
  }
  if (p === '/api/recipients' && method === 'GET') return ok(200, { recipients: store.listRecipients(user.id) });

  if (p === '/api/gifts' && method === 'GET') return ok(200, { gifts: gifts.listAccountGifts(user) });
  if (p === '/api/gifts' && method === 'POST') {
    if (!body) return ok(400, { error: 'invalid JSON' });
    const key = headers['idempotency-key'] || null;
    try { return ok(201, { gift: gifts.sendGift(user, body, key) }); }
    catch (e) { return ok(e.status || 400, { error: e.message }); }
  }

  if (p === '/api/chat' && method === 'POST') {
    if (!body) return ok(400, { error: 'invalid JSON' });
    if (!body.message) return ok(400, { error: 'message required' });
    if (!(user.grok && user.grok.connected)) return ok(409, { error: 'connect Grok first' });
    const apiKey = user.grok.mode === 'xai' && user.grok.apiKeyEnc ? sec.decryptSecret(user.grok.apiKeyEnc) : '';
    try {
      const out = await grok.runAgent({ user, message: String(body.message).slice(0, 2000), apiKey, model: user.grok.model });
      return ok(200, out);
    } catch (e) { return ok(e.status || 500, { error: e.message }); }
  }

  return ok(404, { error: 'not found' });
}

module.exports = { handleApi, publicUser };

