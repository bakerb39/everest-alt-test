'use strict';
const assert = require('node:assert/strict');
const config = require('../config');
config.SERVER_SECRET = 'storage-test-secret';
const { signToken } = require('../lib/security');
const adapter = require('../lib/netlify-adapter');
async function main() {
  const initial = { users: {
    'one@example.test': { id: 'one', email: 'one@example.test', budget: { monthlyCap: 100, spent: 0, cycleStart: Date.now() } },
    'two@example.test': { id: 'two', email: 'two@example.test', budget: { monthlyCap: 100, spent: 0, cycleStart: Date.now() } },
  }, gifts: {}, recipients: {}, idempotency: {} };
  let db = structuredClone(initial), version = 1, conflict = true;
  const blobs = {
    async get() { return 'storage-test-secret'; },
    async getWithMetadata() { return { data: structuredClone(db), etag: String(version) }; },
    async setJSON(key, value, options) {
      assert.equal(options.onlyIfMatch, String(version));
      if (conflict) return { modified: false };
      db = structuredClone(value); version++;
      return { modified: true };
    },
  };
  const event = (id, cap) => ({ blobStore: blobs, modernRuntime: true, httpMethod: 'POST', rawUrl: 'https://example.test/api/budget', headers: { authorization: 'Bearer ' + signToken(id), 'content-type': 'application/json' }, body: JSON.stringify({ monthlyCap: cap }) });
  const rejected = await adapter.handler(event('one', 200));
  assert.equal(rejected.statusCode, 409);
  assert.equal(db.users['one@example.test'].budget.monthlyCap, 100);
  conflict = false;
  const responses = await Promise.all([adapter.handler(event('one', 200)), adapter.handler(event('two', 300))]);
  assert(responses.every(r => r.statusCode === 200));
  assert.equal(db.users['one@example.test'].budget.monthlyCap, 200);
  assert.equal(db.users['two@example.test'].budget.monthlyCap, 300);
  console.log('Storage conflicts and concurrent account requests preserve updates');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
