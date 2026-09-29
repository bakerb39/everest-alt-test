'use strict';
/* Verifies the Netlify Function path end to end against a fake in-memory
 * @netlify/blobs. Each call is a fresh "request": the handler re-hydrates from
 * Blobs and persists back, so this proves durability across invocations and
 * that the signing secret stays stable (no env var set). Run: node test/netlify-fn.test.js */
delete process.env.SERVER_SECRET; // force the Blobs-persisted secret path

// Replace the Netlify SDK at the module boundary with durable in-memory Blobs.
const blobs = new Map();
const sdkPath = require.resolve('@netlify/blobs');
let connected = false;
require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: {
  connectLambda: (event) => { connected = !!event; },
  getStore: () => { if (!connected) throw Error('Lambda Blobs context missing'); return ({
    get: async (key, { type } = {}) => {
      const value = blobs.get(key);
      return type === 'json' && value != null ? JSON.parse(value) : value || null;
    },
    set: async (key, value) => { blobs.set(key, value); },
    setJSON: async (key, value) => { blobs.set(key, JSON.stringify(value)); },
  }); },
} };
const { handler } = require('../netlify/functions/api');

let pass = 0, fail = 0;
function ok(c, label) { if (c) { pass++; console.log('  ✓ ' + label); } else { fail++; console.log('  ✗ ' + label); } }

function ev(method, apiPath, { token, body, idem } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  if (idem) headers['idempotency-key'] = idem;
  return { httpMethod: method, rawUrl: 'https://site.netlify.app' + apiPath, path: apiPath, headers, body: body ? JSON.stringify(body) : '' };
}
async function call(method, apiPath, opts) {
  const res = await handler(ev(method, apiPath, opts));
  let json = {}; try { json = JSON.parse(res.body || '{}'); } catch {}
  return { status: res.statusCode, json };
}

async function run() {
  console.log('\nEverest ALT — Netlify Function path (fake Blobs)\n');

  let r = await call('GET', '/api/health');
  ok(r.status === 200 && r.json.ok, 'health via function');
  ok(connected, 'Lambda Blobs context connected before store access');

  r = await handler(ev('GET', '/.netlify/functions/api/health'));
  ok(r.statusCode === 200, 'rewritten health route reaches function');

  r = await call('POST', '/api/signup', { body: { email: 'net@everestalt.com', password: 'grok-rocks' } });
  ok(r.status === 201 && r.json.token, 'signup persists to Blobs');
  const token = r.json.token;
  r = await handler(ev('POST', '/.netlify/functions/api/signup', {
    body: { email: 'rewritten@everestalt.com', password: 'grok-rocks' },
  }));
  ok(r.statusCode === 201, 'rewritten signup route reaches function');

  // A SEPARATE invocation must see the account + accept the token (secret stable).
  r = await call('GET', '/api/me', { token });
  ok(r.status === 200 && r.json.user.email === 'net@everestalt.com', 'token verified on a later invocation (stable secret + hydrate)');

  r = await call('POST', '/api/budget', { token, body: { monthlyCap: 300 } });
  ok(r.status === 200 && r.json.budget.remaining === 300, 'budget persisted');

  r = await call('POST', '/api/connect/grok', { token, body: {} });
  ok(r.status === 200 && r.json.grok.mode === 'mock', 'grok connected (mock)');

  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401 });
  r = await call('POST', '/api/connect/grok', { token, body: { apiKey: 'xai-invalid' } });
  ok(r.status === 400, 'rejected xAI key is not saved');
  global.fetch = async () => ({ ok: true, json: async () => ({ models: [{ id: 'other-model' }] }) });
  r = await call('POST', '/api/connect/grok', { token, body: { apiKey: 'xai-wrong-model' } });
  ok(r.status === 400, 'key without configured model is not saved');
  global.fetch = async () => ({ ok: true, json: async () => ({ models: [{ id: 'grok-4.7', aliases: [] }] }) });
  r = await call('POST', '/api/connect/grok', { token, body: { apiKey: 'xai-test-key' } });
  ok(r.status === 200 && r.json.grok.mode === 'xai' && r.json.grok.model === 'grok-4.7', 'available model selected and saved');
  r = await call('POST', '/api/connect/grok', { token, body: {} });
  ok(r.status === 200 && r.json.grok.mode === 'mock', 'switching to demo clears the key');
  global.fetch = originalFetch;

  const beforeKindle = (await call('GET', '/api/me', { token })).json.user.budget.remaining;
  r = await call('POST', '/api/chat', { token, body: { message: 'Prepare a Kindle for Maya birthday, delivery 2026-10-20' } });
  const kindle = (r.json.gifts || [])[0];
  ok(r.status === 200 && kindle && kindle.provider === 'amazon' && kindle.requested_date === '2026-10-20', 'Kindle draft records requested date');
  ok(kindle && kindle.status.includes('draft') && kindle.checkout_url.startsWith('https://www.amazon.com/'), 'Kindle points to Amazon checkout review');
  ok(r.json.budget.remaining === beforeKindle, 'Kindle draft does not charge budget');

  r = await call('POST', '/api/chat', { token, body: { message: "It's Maya's birthday — send her flowers" } });
  ok(r.status === 200 && r.json.gifts && r.json.gifts.length === 1, 'chat triggered send_gift');
  const g = r.json.gifts[0] || {};
  ok(g.recipient === 'Maya' && g.category === 'flowers', 'gift correct (Maya / flowers)');
  ok(r.json.budget.remaining === 300 - g.amount, 'budget decremented and persisted');

  // Fresh invocation reads the ledger back from Blobs.
  r = await call('GET', '/api/gifts', { token });
  ok(r.status === 200 && r.json.gifts.length === 2, 'gift history survives across invocations');

  // Idempotency across invocations.
  r = await call('POST', '/api/gifts', { token, idem: 'k1', body: { recipient_name: 'Sam', occasion: 'thanks', category: 'food', max_amount: 40 } });
  const id1 = r.json.gift && r.json.gift.gift_id;
  const rem1 = (await call('GET', '/api/me', { token })).json.user.budget.remaining;
  r = await call('POST', '/api/gifts', { token, idem: 'k1', body: { recipient_name: 'Sam', occasion: 'thanks', category: 'food', max_amount: 40 } });
  const rem2 = (await call('GET', '/api/me', { token })).json.user.budget.remaining;
  ok(r.json.gift && r.json.gift.gift_id === id1 && rem1 === rem2, 'idempotency holds across invocations (no double charge)');

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
