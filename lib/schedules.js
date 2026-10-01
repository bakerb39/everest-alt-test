'use strict';
const DEFAULT_ZONE = 'America/New_York';
function localTime(now, zone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
function validateSchedule(date, zone, now = Date.now()) {
  if (date === undefined) {
    if (zone !== undefined) throw Error('scheduled_date is required with schedule_timezone');
    return {};
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T12:00:00Z')) || new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date) throw Error('scheduled_date must be a valid YYYY-MM-DD date');
  zone = zone || DEFAULT_ZONE;
  let today;
  try { today = localTime(now, zone).date; } catch { throw Error('schedule_timezone must be a valid IANA timezone'); }
  if (date <= today) throw Error('scheduled_date must be a future date in the selected timezone');
  return { scheduled_date: date, schedule_timezone: zone, scheduled_hour: 9, budget_timing: 'Reserved from the current budget on approval; no second deduction on completion.' };
}
// Pure database mutation: safe to repeat after a conditional-write conflict.
function processDue(db, now = Date.now()) {
  let completed = 0;
  for (const user of Object.values(db.users || {})) {
    for (const order of user.assistantOrders || []) {
      if (order.status !== 'simulated — scheduled' || !order.approved_at || !order.scheduled_date) continue;
      const local = localTime(now, order.schedule_timezone || DEFAULT_ZONE);
      if (local.date < order.scheduled_date || (local.date === order.scheduled_date && local.hour < 9)) continue;
      const gift = (db.gifts || {})[order.gift_id || order.id];
      if (!gift || gift.userId !== user.id) throw Error('Scheduled gift ledger is missing');
      order.status = gift.status = 'simulated — completed';
      order.completed_at = gift.completedAt = now;
      completed++;
    }
  }
  return completed;
}
async function runScheduled(blobs, now = Date.now()) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await blobs.getWithMetadata('db', { type: 'json', consistency: 'strong' });
    if (!current) return 0;
    const completed = processDue(current.data, now);
    if (!completed) return 0;
    const write = await blobs.setJSON('db', current.data, { onlyIfMatch: current.etag });
    if (write.modified) return completed;
  }
  throw Error('Concurrent account updates prevented schedule processing; retry next hour');
}
module.exports = { validateSchedule, processDue, runScheduled };
