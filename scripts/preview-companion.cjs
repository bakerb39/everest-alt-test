'use strict';
// Local-only development host. Uses a disposable in-memory fixture, never a hosted account.
process.env.SERVER_SECRET='companion-development-fixture';
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');const store=require('../lib/store');store.useMemoryDriver();
const {handleMcp}=require('../lib/mcp');const companion=require('../lib/companion');
const userId='preview-user';
function dateIn(days){const d=new Date();d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function reset(){store.hydrate({});const now=new Date().toISOString();store.putUser({id:userId,email:'preview@example.invalid',budget:{monthlyCap:250,spent:65,cycleStart:Date.now()},
 companionItems:[{id:'note-reminder',kind:'reminder',title:'Choose a birthday gift for Alex',due_date:dateIn(5),status:'active',recipient_id:'recipient-alex',created_at:now},
 {id:'note-idea',kind:'idea',title:'A tea sampler and a handwritten note',status:'active',recipient_id:'recipient-mom',product:'Specialty loose-leaf tea sampler',created_at:now},
 {id:'note-complete',kind:'reminder',title:'Send a thank-you note',status:'completed',created_at:now},
 {id:'note-dismissed',kind:'idea',title:'Compare travel mugs',status:'dismissed',created_at:now}],
 assistantOrders:[{id:'scheduled-fixture',product:'Scented candle trio',recipient:'Mom',total:50,scheduled_date:dateIn(12),approved_at:Date.now(),status:'simulated — scheduled'}]});
 store.addRecipient({id:'recipient-alex',userId,name:'Alex',relationship:'Friend',occasions:[{type:'Birthday',month_day:dateIn(9).slice(5)}]});
 store.addRecipient({id:'recipient-mom',userId,name:'Mom',relationship:'Mother',occasions:[{type:'Anniversary',month_day:dateIn(21).slice(5)}]});}
reset();
function host(view){return `<!doctype html><html><head><meta charset="utf-8"><title>Everest Companion development preview</title><style>body{margin:0;background:#edf0f2;color:#17161b;font:13px system-ui}header{padding:15px 22px;background:white;border-bottom:1px solid #dfe3e5;display:flex;justify-content:space-between;align-items:center;gap:14px}h1{font-size:15px;margin:0 0 4px}p{margin:0;color:#6b6870;font-size:11px}button,select{font:inherit;padding:7px 10px;border:1px solid #ccd3d8;border-radius:7px;background:white}main{padding:25px 12px;display:grid;justify-items:center}iframe{border:1px solid #d9dfe3;border-radius:18px;background:white;box-shadow:0 12px 50px #18272f12;width:420px;max-width:100%;height:1100px}#last-action{padding:10px 22px;font-size:11px;color:#6b6870}@media(max-width:500px){header{align-items:flex-start;flex-direction:column}main{padding:12px 5px}}</style></head><body><header><div><h1>Everest Companion · development preview</h1><p>Sample account · in-memory test data · no purchases or notifications</p></div><div><select id="preview-size" aria-label="Preview width"><option value="420">Side panel · 420px</option><option value="320">Mobile · 320px</option><option value="820">Wide · 820px</option></select> <button id="reset-preview">Reset test account</button> <button id="replay-preview">Replay old response</button></div></header><p id="last-action" role="status">Connecting the app bridge…</p><main><iframe title="Everest Companion" id="companion" src="/${view==='gallery'?'gallery-frame':'companion'}?v=${Date.now()}" sandbox="allow-scripts allow-same-origin allow-popups"></iframe></main><script>
const frame=document.getElementById('companion');const note=document.getElementById('last-action');let initialResult=null;
function reply(source,id,result){source.postMessage({jsonrpc:'2.0',id,result},'*');}
async function rpc(name,args={}){const response=await fetch('/__preview/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});return (await response.json()).result;}
window.addEventListener('message',async e=>{if(e.source!==frame.contentWindow)return;const m=e.data;if(!m||typeof m!=='object')return;
 try{
 if(m.method==='ui/initialize'){reply(e.source,m.id,{protocolVersion:m.params.protocolVersion,hostInfo:{name:'Local verification host',version:'1.0.0'},hostCapabilities:{serverTools:{},openLinks:{}},hostContext:{theme:'light',displayMode:'inline',availableDisplayModes:['inline','fullscreen','pip']}});}
 else if(m.method==='ui/notifications/initialized'){const result=await rpc(${JSON.stringify(view==='gallery'?'show_gift_gallery':'show_everest_panel')});initialResult=result;e.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:result},'*');note.textContent='Connected to the local test account.';}
 else if(m.method==='tools/call'){const result=await rpc(m.params.name,m.params.arguments);note.textContent='Tool '+m.params.name+': '+(result.isError?'error':result.structuredContent?.items?.length ?? result.structuredContent?.total_matches ?? 'ok');reply(e.source,m.id,result);}
 else if(m.method==='ui/open-link'){note.textContent='Dashboard link requested: '+m.params.url;reply(e.source,m.id,{});}
 else if(m.method==='ui/request-display-mode'){note.textContent='Panel mode requested: '+m.params.mode;reply(e.source,m.id,{mode:m.params.mode});}
 else if(m.method==='ui/notifications/size-changed'){frame.style.height=Math.min(1500,Math.max(550,m.params.height))+'px';}
 else if(m.id!==undefined)reply(e.source,m.id,{});
 }catch(error){if(m.id!==undefined)e.source.postMessage({jsonrpc:'2.0',id:m.id,error:{code:-32000,message:error.message}},'*');note.textContent=error.message;}});
document.getElementById('replay-preview').onclick=()=>{if(initialResult)frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:initialResult},'*');note.textContent='Replayed an older account response.';};
document.getElementById('preview-size').onchange=e=>frame.style.width=e.target.value+'px';
document.getElementById('reset-preview').onclick=async()=>{await fetch('/__preview/reset',{method:'POST'});frame.src='/${view==='gallery'?'gallery-frame':'companion'}?v='+Date.now();note.textContent='Resetting the test account…';};
</script></body></html>`;}
http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');
 try{
  if(url.pathname==='/'){res.setHeader('content-type','text/html');res.setHeader('cache-control','no-store');return res.end(host(url.searchParams.get('view')));}
  if(url.pathname==='/companion'||url.pathname==='/gallery-frame'){
   const resource=url.pathname==='/companion'?companion.resource():require('../lib/gift-gallery').resource();res.setHeader('content-type','text/html');res.setHeader('cache-control','no-store');
   const domains=resource._meta.ui.csp.resourceDomains.join(' ');res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' ${domains}; img-src data: ${domains}; font-src ${domains}; connect-src 'none'; base-uri 'none'; form-action 'none'`);return res.end(resource.text);
  }
  if(url.pathname==='/__preview/reset'&&req.method==='POST'){reset();res.setHeader('content-type','application/json');return res.end('{"ok":true}');}
  if(url.pathname==='/__preview/rpc'&&req.method==='POST'){
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>50000)throw Error('Request too large');}
   const response=handleMcp(store.getUserById(userId),{method:'POST',body:JSON.parse(raw)});res.statusCode=response.status;res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');return res.end(JSON.stringify(response.json));
  }
  if(url.pathname.startsWith('/assets/')){const file=path.resolve(root,'public','.'+url.pathname);if(!file.startsWith(path.join(root,'public')+path.sep))throw Error('Invalid path');res.setHeader('content-type',file.endsWith('.jpg')?'image/jpeg':'image/png');return fs.createReadStream(file).on('error',()=>{res.statusCode=404;res.end();}).pipe(res);}
  res.statusCode=404;res.end('Not found');
 }catch(error){res.statusCode=400;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:error.message}));}
}).listen(Number(process.env.PORT)||4173,'0.0.0.0',()=>console.log('Everest Companion preview running on port '+(process.env.PORT||4173)));
