'use strict';
const store = require('./store');
const budget = require('./budget');
const catalog = require('./catalog');
const { newId } = require('./security');
const URI = 'ui://everest/companion/v2.html';
const DEFAULT_HOST = 'https://papaya-cassata-7e507b.netlify.app';
const statuses = ['active', 'completed', 'dismissed'];
const kinds = ['reminder', 'idea'];
function origin() { return new URL(process.env.PUBLIC_URL || DEFAULT_HOST).origin; }
function descriptor() { return { uri: URI, name: 'everest-companion', title: 'Everest Companion', mimeType: 'text/html;profile=mcp-app' }; }
function toolMeta() { return { ui: { resourceUri: URI, visibility: ['model', 'app'] }, 'openai/outputTemplate': URI,
  'openai/ui': { entrypoints: [{ type: 'thread' }] }, 'openai/widgetAccessible': true,
  'openai/toolInvocation/invoking': 'Opening Everest Companion…', 'openai/toolInvocation/invoked': 'Everest Companion ready' }; }
function resource() {
  const domains = [...new Set([origin(), DEFAULT_HOST, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'])];
  return { ...descriptor(), text: require('./companion-template').replaceAll('__EVEREST_ORIGIN__', origin()), _meta: {
    ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: domains } },
    'openai/ui': { availableDisplayModes: ['inline', 'fullscreen', 'pip'] },
    'openai/widgetDescription': 'Everest Companion with account dashboard, all saved reminders and ideas, and the existing interactive gift gallery inside this panel. Photos load automatically.',
    'openai/widgetPrefersBorder': true, 'openai/widgetCSP': { connect_domains: [], resource_domains: domains } } };
}
function current(user) {
  if (!user || !user.id) throw budget.httpError(401, 'Sign in to Everest ALT first.');
  return store.getUserById(user.id) || user;
}
function validDate(date) { return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date+'T12:00:00Z')) && new Date(date+'T12:00:00Z').toISOString().slice(0,10) === date; }
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function upcoming(recipients, date) {
  const result = [], year = Number(date.slice(0,4));
  for (const recipient of recipients) for (const o of recipient.occasions || []) {
    if (!o || typeof o !== 'object') continue;
    const title = String(o.type || o.occasion || o.name || 'Occasion').slice(0,80);
    const raw = o.month_day || o.date;
    if (typeof raw !== 'string') continue;
    let next = raw;
    if (/^\d{2}-\d{2}$/.test(raw) || /birthday|anniversary/i.test(title)) {
      const monthDay = raw.slice(-5);
      next = null;
      for (let offset = 0; offset <= 4; offset++) {
        const candidate = String(year+offset)+'-'+monthDay;
        if (validDate(candidate) && candidate >= date) { next = candidate; break; }
      }
    }
    if (!validDate(next) || next < date) continue;
    const days = Math.round((Date.parse(next+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000);
    if (days <= 60) result.push({ recipient_id: recipient.id, recipient: recipient.name, occasion: title, date: next, days_away: days });
  }
  return result.sort((a,b)=>a.date.localeCompare(b.date));
}
function snapshot(user, args = {}) {
  const u = current(user), date = today();
  if (args.tab && !['dashboard','reminders','gallery'].includes(args.tab)) throw budget.httpError(400, 'Choose dashboard, reminders or gallery.');
  const recipients = store.listRecipients(u.id);
  const items = (u.companionItems || []).filter(i=>i && kinds.includes(i.kind)).map(i=>({ id:i.id, kind:i.kind, title:String(i.title || ''), due_date:validDate(i.due_date)?i.due_date:null,
    status:statuses.includes(i.status)?i.status:'active', created_at:i.created_at || null, updated_at:i.updated_at || i.created_at || null,
    recipient_id:recipients.some(r=>r.id===i.recipient_id)?i.recipient_id:null, product:catalog.some(p=>p.name===i.product)?i.product:null }));
  const scheduled = (u.assistantOrders || []).filter(o=>o.approved_at && validDate(o.scheduled_date) && o.scheduled_date >= date && o.status === 'simulated — scheduled')
    .map(o=>({id:o.id,recipient:o.recipient,product:o.product,date:o.scheduled_date,total:o.total,status:o.status})).sort((a,b)=>a.date.localeCompare(b.date));
  return { panel:true, title:'Everest Companion', simulated:true, budget:budget.summary(u), dashboard_url:origin()+'/app', today:date,
    companion_revision:Number.isSafeInteger(u.companionRevision)?u.companionRevision:0, time_zone:'America/New_York', requested_tab:args.tab || null, recipients:recipients.map(r=>({id:r.id,name:r.name,relationship:r.relationship || null})), occasions:upcoming(recipients,date),
    scheduled_gifts:scheduled, items, can_save:true,
    counts:{ reminders:items.filter(i=>i.kind==='reminder'&&i.status==='active').length, ideas:items.filter(i=>i.kind==='idea'&&i.status==='active').length, completed:items.filter(i=>i.status==='completed').length, dismissed:items.filter(i=>i.status==='dismissed').length },
    generated_at:new Date().toISOString(), notice:'Reminders are saved to your account and shown here. No background notifications are sent. Browsing and saving ideas never place an order.' };
}
function save(user, a) {
  const u=current(user), title=String(a.title || '').trim();
  if (!kinds.includes(a.kind)) throw budget.httpError(400,'Choose reminder or idea.');
  if (!title || title.length>180) throw budget.httpError(400,'Use a title of 1 to 180 characters.');
  if (a.due_date && !validDate(a.due_date)) throw budget.httpError(400,'Use a valid date: YYYY-MM-DD.');
  if (a.recipient_id && !store.listRecipients(u.id).some(r=>r.id===a.recipient_id)) throw budget.httpError(404,'Recipient not found in this account.');
  if (a.product && !catalog.some(p=>p.name===a.product)) throw budget.httpError(404,'Choose a catalog gift.');
  const items=u.companionItems || [];
  if (items.filter(i=>i.status==='active').length>=50) throw budget.httpError(400,'Complete or dismiss an item first (50 active items maximum).');
  const now=new Date().toISOString();
  u.companionItems=[...items,{id:newId('note'),kind:a.kind,title,due_date:a.due_date || null,status:'active',created_at:now,updated_at:now,recipient_id:a.recipient_id || null,product:a.product || null}];
  u.companionRevision=(Number.isSafeInteger(u.companionRevision)?u.companionRevision:0)+1;
  store.putUser(u);return snapshot(u);
}
function update(user,a) {
  const u=current(user);
  if (!statuses.includes(a.status)) throw budget.httpError(400,'Choose active, completed or dismissed.');
  const item=(u.companionItems || []).find(i=>i.id===a.item_id);
  if (!item) throw budget.httpError(404,'Item not found in this account.');
  if (a.status==='active' && item.status!=='active' && u.companionItems.filter(i=>i.status==='active').length>=50) throw budget.httpError(400,'Complete or dismiss an item before restoring another.');
  item.status=a.status;item.updated_at=new Date().toISOString();u.companionRevision=(Number.isSafeInteger(u.companionRevision)?u.companionRevision:0)+1;store.putUser(u);return snapshot(u);
}
module.exports={URI,descriptor,toolMeta,resource,snapshot,save,update};
