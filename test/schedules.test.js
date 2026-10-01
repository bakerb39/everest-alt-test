'use strict';
const assert = require('node:assert/strict');
const store = require('../lib/store');
const { execute, handleMcp } = require('../lib/mcp');
const { validateSchedule, processDue, runScheduled } = require('../lib/schedules');
const { listAccountGifts } = require('../lib/gifts');
const { attachPhotos } = require('../lib/photos');
async function main() {
  const now = Date.parse('2026-10-01T16:00:00Z');
  assert.throws(() => validateSchedule('2026-02-30', 'UTC', now));
  assert.throws(() => validateSchedule('2026-10-01', 'UTC', now));
  assert.throws(() => validateSchedule('2026-10-02', 'Invalid/Zone', now));
  assert.throws(() => validateSchedule(undefined, 'UTC', now));
  assert.equal(validateSchedule('2026-10-02', undefined, now).schedule_timezone, 'America/New_York');
  store.useMemoryDriver(); store.hydrate({});
  const user = { id: 'schedule', email: 'schedule@example.test', budget: { monthlyCap: 200, spent: 0, cycleStart: Date.now() } };
  store.putUser(user);
  const tomorrow = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const product = execute(user, 'find_gifts', { category: 'food', max_amount: 100 }).options[0];
  assert.match(product.image_url, /\/assets\/products\/p\d+\.jpg$/);
  const order = execute(user, 'prepare_gift_order', { product: product.name, recipient: 'Maya', card_message: 'Birthday wishes', scheduled_date: tomorrow, schedule_timezone: 'America/New_York' });
  assert.equal(user.budget.spent, 0);
  const approval = { order_id: order.id, approved_total: order.total, user_approved: true };
  execute(user, 'approve_gift_order', approval);
  execute(user, 'approve_gift_order', approval);
  assert.equal(order.status, 'simulated — scheduled');
  assert.equal(user.budget.spent, order.total);
  assert.equal(listAccountGifts(user)[0].scheduled_date, tomorrow);
  assert.equal(execute({ id: 'other' }, 'list_scheduled_gifts', {}).orders.length, 0);
  // Explicit dates exercise daylight-saving offsets and hourly completion.
  const db = store.snapshot();
  order.scheduled_date = db.gifts[order.id].scheduledDate = '2026-11-01';
  assert.equal(processDue(db, Date.parse('2026-11-01T13:59:00Z')), 0);
  assert.equal(processDue(db, Date.parse('2026-11-01T14:00:00Z')), 1);
  assert.equal(processDue(db, Date.parse('2026-11-02T14:00:00Z')), 0);
  assert.equal(user.budget.spent, order.total);
  assert.equal(db.gifts[order.id].status, 'simulated — completed');
  execute(user, 'approve_gift_order', approval);
  assert.equal(user.budget.spent, order.total);
  // Optimistic concurrency: a conflicting request is reread, never overwritten.
  order.status = db.gifts[order.id].status = 'simulated — scheduled';
  let reads = 0, writes = 0;
  const blobs = {
    async getWithMetadata() { reads++; return { data: JSON.parse(JSON.stringify(db)), etag: 'v' + reads }; },
    async setJSON(key, value, options) { writes++; assert.equal(options.onlyIfMatch, 'v' + reads); assert.equal(value.gifts[order.id].status, 'simulated — completed'); return { modified: writes > 1 }; }
  };
  assert.equal(await runScheduled(blobs, Date.parse('2026-11-01T14:00:00Z')), 1);
  assert.equal(reads, 2);
  const response = handleMcp(user, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'find_gifts', arguments: { max_amount: 100 } } } });
  assert.match(response.json.result.content[0].text, /!\[/);
  const fakeFetch = async () => ({ ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => Uint8Array.from([255, 216, 255, 217]).buffer });
  await attachPhotos(response, fakeFetch);
  assert(response.json.result.content.some(c => c.type === 'image' && c.mimeType === 'image/jpeg'));
  const failed = handleMcp(user, { method: 'POST', body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'find_gifts', arguments: {} } } });
  await attachPhotos(failed, async () => { throw Error('missing photo'); });
  assert.equal(failed.json.result.isError, undefined);
  assert.equal(failed.json.result.content.length, 1);
  console.log('Scheduling, timezone, budget reservation, completion, concurrency and photo checks passed');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
