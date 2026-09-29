'use strict';
/* End-to-end self-test. Run: node test/smoke.js
 * Boots the server on a temp datastore and exercises the whole flow:
 * signup -> budget -> connect Grok (mock) -> chat that triggers send_gift ->
 * ledger check -> raw gift endpoint -> idempotency -> hard-cap enforcement. */
const os = require('os');
const path = require('path');
const fs = require('fs');

const PORT = 8799;
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
process.env.DATA_FILE = path.join(os.tmpdir(), `ealt-smoke-${Date.now()}.json`);
process.env.SERVER_SECRET = 'smoke-test-secret';

const { server } = require('../server');
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; console.log('  ✓ ' + label); } else { fail++; console.log('  ✗ ' + label); } }

async function api(method, p, { token, body, idem } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (idem) headers['Idempotency-Key'] = idem;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function run() {
  console.log('\nEverest ALT backend — smoke test\n');

  // health
  let r = await api('GET', '/api/health');
  ok(r.status === 200 && r.json.ok, 'health endpoint responds');

  // signup
  r = await api('POST', '/api/signup', { body: { email: 'alex@everestalt.com', password: 'grok-rocks' } });
  ok(r.status === 201 && r.json.token, 'signup creates account + token');
  const token = r.json.token;
  ok(r.json.user.budget.monthlyCap === 0, 'new account starts with $0 budget');

  // duplicate signup rejected
  r = await api('POST', '/api/signup', { body: { email: 'alex@everestalt.com', password: 'x123456' } });
  ok(r.status === 409, 'duplicate signup rejected');

  // login
  r = await api('POST', '/api/login', { body: { email: 'alex@everestalt.com', password: 'grok-rocks' } });
  ok(r.status === 200 && r.json.token, 'login returns a token');
  r = await api('POST', '/api/login', { body: { email: 'alex@everestalt.com', password: 'wrong' } });
  ok(r.status === 401, 'wrong password rejected');

  // auth required
  r = await api('GET', '/api/me');
  ok(r.status === 401, 'protected route requires auth');

  // set budget
  r = await api('POST', '/api/budget', { token, body: { monthlyCap: 150 } });
  ok(r.status === 200 && r.json.budget.remaining === 150, 'budget set to $150 (remaining $150)');

  // connect grok (mock)
  r = await api('POST', '/api/connect/grok', { token, body: {} });
  ok(r.status === 200 && r.json.grok.connected && r.json.grok.mode === 'mock', 'Grok connected (mock mode)');

  // chat must be gated on connection — already connected, so proceed
  r = await api('POST', '/api/chat', { token, body: { message: "It's Maya's birthday — please send her some flowers." } });
  ok(r.status === 200, 'chat responds');
  ok(r.json.mode === 'mock', 'chat ran in mock mode (no xAI key)');
  ok(Array.isArray(r.json.gifts) && r.json.gifts.length === 1, 'Grok called send_gift exactly once');
  const g = r.json.gifts[0] || {};
  ok(g.category === 'flowers', 'gift is in the flowers category');
  ok(g.recipient === 'Maya', 'gift recipient parsed as Maya');
  ok(g.amount > 0 && g.amount <= 150, 'gift amount within budget');
  ok(g.card_message == null || typeof g.card_message === 'string', 'card message present');
  ok(!('card' in g) && !('payment' in g), 'no payment data leaks to the agent result');
  const remainingAfterChat = r.json.budget.remaining;
  ok(remainingAfterChat === 150 - g.amount, 'budget decremented by the gift amount');

  // gift history
  r = await api('GET', '/api/gifts', { token });
  ok(r.status === 200 && r.json.gifts.length === 1, 'gift appears in history');

  // raw tool endpoint + idempotency
  r = await api('POST', '/api/gifts', { token, idem: 'key-abc', body: { recipient_name: 'Sam', occasion: 'thank you', category: 'food', max_amount: 50 } });
  ok(r.status === 201 && r.json.gift.gift_id, 'direct send_gift endpoint works');
  const firstId = r.json.gift.gift_id;
  const remAfterDirect = (await api('GET', '/api/me', { token })).json.user.budget.remaining;

  r = await api('POST', '/api/gifts', { token, idem: 'key-abc', body: { recipient_name: 'Sam', occasion: 'thank you', category: 'food', max_amount: 50 } });
  ok(r.json.gift && r.json.gift.gift_id === firstId && r.json.gift.idempotent, 'idempotency: repeat call returns same gift');
  const remAfterRepeat = (await api('GET', '/api/me', { token })).json.user.budget.remaining;
  ok(remAfterDirect === remAfterRepeat, 'idempotency: budget NOT double-charged');

  // hard-cap enforcement (fresh user, tiny budget)
  const u2 = (await api('POST', '/api/signup', { body: { email: 'broke@everestalt.com', password: 'test123' } })).json.token;
  await api('POST', '/api/budget', { token: u2, body: { monthlyCap: 30 } });
  await api('POST', '/api/connect/grok', { token: u2, body: {} });
  r = await api('POST', '/api/gifts', { token: u2, body: { occasion: 'birthday', category: 'jewelry', max_amount: 999 } });
  ok(r.status >= 400, 'over-budget gift is rejected (hard cap enforced)');
  const b2 = (await api('GET', '/api/me', { token: u2 })).json.user.budget;
  ok(b2.spent === 0 && b2.remaining === 30, 'rejected gift did not touch the budget');

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed\n`);
  try { fs.unlinkSync(process.env.DATA_FILE); } catch {}
  server.close();
  process.exit(fail === 0 ? 0 : 1);
}

server.listen(PORT, '127.0.0.1', () => { run().catch((e) => { console.error(e); process.exit(1); }); });
