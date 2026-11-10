import { App } from '@modelcontextprotocol/ext-apps';
import catalog from '../lib/catalog.js';
import { createGalleryView } from './gallery-view.js';
const $ = id => document.getElementById(id);
const HOST = '__EVEREST_ORIGIN__';
const PHOTO_HOST = 'https://papaya-cassata-7e507b.netlify.app';
const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0);
const fmtDate = d => d ? new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z')) : '';
const safeState = window.openai?.widgetState || {};
let data = null, galleryData = null, loadingGallery = false, demo = false, busy = false;
let activeTab = ['dashboard','reminders','gallery'].includes(safeState.activeTab) ? safeState.activeTab : 'dashboard';
let recipientsSignature = '', restoredGalleryState = false;
let resolveReady;
const ready = new Promise(resolve => { resolveReady = resolve; });
const app = new App({name:'Everest Companion',version:'2.0.0'},{availableDisplayModes:['inline','fullscreen','pip']},{autoResize:true});
function text(tag,value,parent,className) { const el=document.createElement(tag);el.textContent=value;if(className)el.className=className;parent.append(el);return el; }
function button(label,parent,handler,className='btn ghost sm') { const b=text('button',label,parent,className);b.type='button';b.onclick=handler;return b; }
function status(message,error=false) { $('status').textContent=message;$('status').dataset.error=String(error); }
function snapshot() { return demo ? sampleData() : data; }
function sampleData() {
  const today=data?.today || new Date().toISOString().slice(0,10);
  const later=new Date(today+'T12:00:00Z');later.setUTCDate(later.getUTCDate()+12);
  return {panel:true,simulated:true,budget:{remaining:110,spent:40,monthlyCap:150,resetsOn:later.toISOString()},today,dashboard_url:HOST+'/app',recipients:[{id:'sample-alex',name:'Alex',relationship:'Friend'}],
    occasions:[{recipient_id:'sample-alex',recipient:'Alex (sample)',occasion:'Birthday',date:later.toISOString().slice(0,10),days_away:12}],scheduled_gifts:[],can_save:false,
    counts:{reminders:1,ideas:1,completed:0,dismissed:0},items:[{id:'sample-reminder',kind:'reminder',title:'Choose something thoughtful for Alex (sample)',due_date:later.toISOString().slice(0,10),status:'active',recipient_id:'sample-alex'},
      {id:'sample-idea',kind:'idea',title:'A tea sampler and a handwritten note (sample)',status:'active',recipient_id:'sample-alex'}]};
}
function persist() { try { window.openai?.setWidgetState?.({activeTab,itemKind:$('item-kind').value,itemStatus:$('item-status').value,itemSearch:$('item-search').value,gallery:galleryView.getState(),recipient:$('gallery-recipient').value}); } catch {} }
function unpack(raw) { const out=raw?.structuredContent || raw?.result?.structuredContent || raw;return out; }
function accept(raw) {
  const d=unpack(raw);
  if (d?.panel) {
    if (data && Number.isFinite(data.companion_revision) && Number.isFinite(d.companion_revision) && d.companion_revision < data.companion_revision) return;
    data=d;
    if (d.requested_tab && ['dashboard','reminders','gallery'].includes(d.requested_tab)) activeTab=d.requested_tab;
    render();applyTab();
  } else if (Array.isArray(d?.options) || Array.isArray(d?.products)) { galleryData=d;renderGallery(); }
}
async function call(name,args={}) {
  if (!window.openai?.callTool && !await ready) throw Error('Open this panel from your Everest chat connection.');
  const out=window.openai?.callTool ? await window.openai.callTool(name,args) : await app.callServerTool({name,arguments:args});
  if (out?.isError) throw Error(out.content?.find(c=>c.type==='text')?.text || 'That change could not be saved.');
  accept(out);return out;
}
async function action(fn) {
  if (busy) return;
  busy=true;$('refresh').disabled=true;for(const b of document.querySelectorAll('[data-mutating]'))b.disabled=true;
  try { await fn(); } catch(error) { status(error.message || 'Please try again.',true); }
  finally { busy=false;$('refresh').disabled=false;render(); }
}
async function refresh() {
  if (demo) { render();status('Showing sample content. Your account is unchanged.');return; }
  await call('show_everest_panel');
  if(activeTab==='gallery') { galleryData=null;await loadGallery(); }
  status('Updated '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}));
}
async function loadGallery() {
  if (demo) { renderGallery();return; }
  if (galleryData || loadingGallery) { renderGallery();return; }
  loadingGallery=true;$('gallery-summary').textContent='Loading gift photos…';
  try { await call('get_panel_gifts'); } catch(error) { $('gallery-summary').textContent=error.message;status(error.message,true); }
  finally { loadingGallery=false; }
}
function applyTab(focus=false) {
  for (const b of document.querySelectorAll('[data-view]')) { const selected=b.dataset.view===activeTab;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;$('view-'+b.dataset.view).hidden=!selected;if(selected&&focus)b.focus(); }
  if(activeTab==='gallery')void loadGallery();
  persist();
}
function showTab(tab) { activeTab=tab;applyTab(); }
function findGift(item) {
  if(item.recipient_id)$('gallery-recipient').value=item.recipient_id;
  if(item.product)$('gallery-search').value=item.product;
  activeTab='gallery';applyTab();galleryView.render();
}
function populateRecipients(d) {
  const signature=d.recipients.map(r=>r.id+':'+r.name).join('|');
  if(signature===recipientsSignature)return;
  for(const [id,label] of [['note-recipient','No person selected'],['gallery-recipient','Someone special']]) {
    const control=$(id),selected=control.value || (id==='gallery-recipient'?safeState.recipient:'');
    control.replaceChildren(new Option(label,''));for(const r of d.recipients)control.add(new Option(r.name,r.id));
    control.value=d.recipients.some(r=>r.id===selected)?selected:'';
  }
  recipientsSignature=signature;
}
function dueLabel(item,d) { return item.due_date ? (item.due_date<d.today && item.status==='active'?'Overdue · ':'')+fmtDate(item.due_date) : 'No date set'; }
function renderDashboard(d) {
  $('remaining').textContent=money(d.budget.remaining);$('spent').textContent=money(d.budget.spent);$('cap').textContent=money(d.budget.monthlyCap ?? d.budget.cap);
  const cap=d.budget.monthlyCap ?? d.budget.cap ?? 0,pct=cap>0?Math.min(100,Math.max(0,d.budget.spent/cap*100)):0;
  $('budget-fill').style.width=pct+'%';$('budget-progress').setAttribute('aria-valuenow',String(Math.round(pct)));
  $('reset-date').textContent=d.budget.resetsOn?'Resets '+new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:d.time_zone || 'America/New_York'}).format(new Date(d.budget.resetsOn)):'';
  $('stat-reminders').textContent=d.counts.reminders;$('stat-ideas').textContent=d.counts.ideas;$('stat-scheduled').textContent=d.scheduled_gifts.length;
  const occasions=$('occasions');occasions.replaceChildren();
  if(!d.occasions.length)text('p','No upcoming occasions yet. Add birthdays or anniversaries in your full dashboard.',occasions,'empty');
  for(const o of d.occasions.slice(0,4)) {
    const row=text('div','',occasions,'list-item'),tile=text('div','',row,'date-tile');text('span',fmtDate(o.date).split(' ')[0],tile);text('b',String(Number(o.date.slice(-2))),tile);
    const body=text('div','',row,'body');text('p',o.recipient,body,'item-title');text('p',o.occasion+' · '+(o.days_away===0?'Today':'In '+o.days_away+' days'),body,'meta');
    button('Find a gift →',body,()=>findGift(o),'btn quiet sm');
  }
  const list=$('dashboard-reminders');list.replaceChildren();const active=d.items.filter(i=>i.kind==='reminder'&&i.status==='active').sort((a,b)=>(a.due_date || '9999').localeCompare(b.due_date || '9999')).slice(0,3);
  if(!active.length)text('p','A small reminder can make a big difference. Add your first one in Reminders & ideas.',list,'empty');
  for(const item of active) { const row=text('div','',list,'list-item'),body=text('div','',row,'body');text('p',item.title,body,'item-title');text('p',dueLabel(item,d),body,'meta'); }
  const scheduled=$('scheduled');scheduled.replaceChildren();
  if(!d.scheduled_gifts.length)text('p','No scheduled gifts. When you approve a dated simulation, it will appear here.',scheduled,'empty');
  for(const gift of d.scheduled_gifts.slice(0,4)) { const row=text('div','',scheduled,'list-item'),body=text('div','',row,'body');text('p',gift.product,body,'item-title');text('p',gift.recipient+' · '+fmtDate(gift.date)+' · '+money(gift.total),body,'meta'); }
}
function renderItems(d) {
  const kind=$('item-kind').value,filter=$('item-status').value,query=$('item-search').value.trim().toLowerCase();
  const rows=d.items.filter(i=>(kind==='all'||i.kind===kind)&&(filter==='all'||(filter==='upcoming'?i.status==='active'&&i.due_date&&i.due_date>=d.today:i.status===filter))&&i.title.toLowerCase().includes(query))
    .sort((a,b)=>(a.due_date || '9999').localeCompare(b.due_date || '9999') || String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const container=$('items');container.replaceChildren();$('item-count').textContent=rows.length+' '+(rows.length===1?'item':'items');
  if(!rows.length)text('p',filter==='active'?'Nothing here yet. Add a reminder or save an idea from the gallery.':'No saved items match these filters.',container,'empty');
  for(const item of rows) {
    const card=text('article','',container,'note-card');card.dataset.itemId=item.id;
    text('span',(demo?'Sample · ':'')+(item.kind==='idea'?'Gift idea':'Reminder')+(item.status==='active'?'':' · '+item.status),card,'badge'+(item.due_date<d.today&&item.status==='active'?' overdue':''));
    text('p',item.title,card);const recipient=d.recipients.find(r=>r.id===item.recipient_id);text('p',(recipient?recipient.name+' · ':'')+dueLabel(item,d),card,'meta');
    const actions=text('div','',card,'actions');button(item.product?'View gift':'Find a gift',actions,()=>findGift(item),'btn quiet sm');
    if(d.can_save&&!demo)for(const [label,state] of item.status==='active'?[['Done','completed'],['Dismiss','dismissed']]:[['Restore','active']]) {
      const b=button(label,actions,()=>action(async()=>{await call('update_everest_item',{item_id:item.id,status:state});status(state==='active'?'Restored to your active items.':'Saved to '+state+' items.');}));b.dataset.mutating='true';b.disabled=busy;
    }
  }
  $('add-note').hidden=!d.can_save||demo;$('save-note').disabled=busy||demo;$('save-note').textContent=$('note-kind').value==='idea'?'Save idea':'Save reminder';
}
const galleryView=createGalleryView({root:$('gifts'),summary:$('gallery-summary'),category:$('gallery-category'),search:$('gallery-search'),maximum:$('gallery-maximum'),allowedOrigins:[HOST,PHOTO_HOST],onChange:persist,
  isSaved:p=>!!snapshot()?.items.some(i=>i.status==='active'&&i.kind==='idea'&&i.product===p.name&&(i.recipient_id || '')===$('gallery-recipient').value),
  onSave:p=>{if(demo)return;void action(async()=>{const recipient=snapshot().recipients.find(r=>r.id===$('gallery-recipient').value);await call('save_everest_item',{kind:'idea',title:p.name+(recipient?' for '+recipient.name:''),product:p.name,...(recipient?{recipient_id:recipient.id}:{})});status('Gift idea saved to Reminders & ideas.');});}});
function renderGallery() {
  const d=snapshot();if(!d)return;
  const gifts=demo?{options:catalog}:galleryData;
  if(gifts) {
    galleryView.setData({...gifts,remaining_budget:d.budget.remaining});
    if(!restoredGalleryState&&safeState.gallery) { galleryView.setState(safeState.gallery);restoredGalleryState=true; }
    if(demo)for(const b of $('gifts').querySelectorAll('button'))b.hidden=true;
    else if(busy)for(const b of $('gifts').querySelectorAll('button'))b.disabled=true;
  }
}
function render() { const d=snapshot();if(!d)return;populateRecipients(d);renderDashboard(d);renderItems(d);renderGallery();$('sample-banner').hidden=!demo;$('sample-toggle').textContent=demo?'Back to my account':'Sample view'; }
for(const b of document.querySelectorAll('[data-view]')) {
  b.onclick=()=>showTab(b.dataset.view);
  b.onkeydown=e=>{const names=['dashboard','reminders','gallery'];let next=names.indexOf(activeTab);if(e.key==='ArrowRight')next=(next+1)%3;else if(e.key==='ArrowLeft')next=(next+2)%3;else if(e.key==='Home')next=0;else if(e.key==='End')next=2;else return;e.preventDefault();activeTab=names[next];applyTab(true);};
}
for(const [id,event]of [['item-kind','change'],['item-status','change'],['item-search','input']])$(id).addEventListener(event,()=>{if(snapshot())renderItems(snapshot());persist();});
for(const [id,key]of [['item-kind','itemKind'],['item-status','itemStatus'],['item-search','itemSearch']])if(typeof safeState[key]==='string')$(id).value=safeState[key];
$('gallery-recipient').onchange=()=>{galleryView.render();persist();};
$('note-kind').onchange=()=>{if(snapshot())renderItems(snapshot());};
$('view-all-reminders').onclick=()=>showTab('reminders');
// Tool actions must work even when the host iframe does not allow native forms.
function submitNote() {
  if(demo || !snapshot()?.can_save || !$('note-form').reportValidity())return;
  void action(async()=>{
    await call('save_everest_item',{kind:$('note-kind').value,title:$('note-title').value.trim(),...($('note-date').value?{due_date:$('note-date').value}:{}),...($('note-recipient').value?{recipient_id:$('note-recipient').value}:{})});
    $('note-title').value='';$('note-date').value='';$('item-status').value='active';$('item-kind').value='all';$('item-search').value='';renderItems(snapshot());status('Saved to your account. No notification or order was scheduled.');
  });
}
$('save-note').onclick=submitNote;
$('note-form').onsubmit=e=>{e.preventDefault();submitNote();};
$('note-title').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();submitNote();}};
$('refresh').onclick=()=>action(refresh);
$('sample-toggle').onclick=()=>{demo=!demo;recipientsSignature='';render();applyTab();status(demo?'Showing sample content. Nothing is saved to your account.':'Showing your account.');};
$('pin').onclick=()=>action(async()=>{const result=window.openai?.requestDisplayMode?await window.openai.requestDisplayMode({mode:'pip'}):await app.requestDisplayMode({mode:'pip'});status(result?.mode==='pip'?'Companion is beside your chat.':'Your chat app chose '+(result?.mode || 'its supported view')+'.');});
$('open-dashboard').onclick=()=>action(async()=>{const url=new URL(snapshot()?.dashboard_url || HOST+'/app');if(url.origin!==HOST)throw Error('Dashboard link unavailable.');if(window.openai?.openExternal)await window.openai.openExternal({href:url.href});else await app.openLink({url:url.href});status('Opened your full Everest dashboard.');});
app.ontoolresult=accept;
window.addEventListener('openai:set_globals',e=>{if(e.detail?.globals?.toolOutput)accept(e.detail.globals.toolOutput);});
if(window.openai?.toolOutput)accept(window.openai.toolOutput);
applyTab();
if(window.parent===window) { resolveReady(false);status('Open Companion from your Everest chat connection, or choose Sample view.'); }
else app.connect().then(()=>{resolveReady(true);if(!data)void action(refresh);}).catch(()=>{resolveReady(false);if(!data)status('The panel connection is unavailable. Reopen it from Everest or choose Sample view.',true);});
setInterval(()=>{if(data&&!demo&&!busy&&!document.hidden)void action(refresh);},60000);
