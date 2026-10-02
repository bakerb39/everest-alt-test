'use strict';
const crypto = require('crypto');
const config = require('../config');
const sec = require('./security');
const store = require('./store');
const ORIGIN = 'https://papaya-cassata-7e507b.netlify.app';
const RESOURCE = ORIGIN + '/api/mcp';
const SCOPE = 'gifts:simulate';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');
const memory = new Map();
let driver = null;
// Separate OAuth records avoid rewriting the account database. Redemption claims
// use onlyIfNew so two function instances cannot redeem the same grant.
function setDriver(value) { driver = value; }
async function get(key) { return driver ? driver.get(key, { type: 'json' }) : memory.get(key); }
async function put(key, value) { if (driver) await driver.setJSON(key, value); else memory.set(key, value); }
async function claim(key) {
  if (driver) return (await driver.setJSON('claim/' + key, { used: true }, { onlyIfNew: true })).modified;
  if (memory.has('claim/' + key)) return false;
  memory.set('claim/' + key, true); return true;
}
function fail(message, status = 400) { const e = Error(message); e.status = status; throw e; }
function metadata() {
  return { issuer: ORIGIN, authorization_endpoint: ORIGIN + '/assistant-connect.html',
    authorization_response_iss_parameter_supported: true,
    token_endpoint: ORIGIN + '/api/oauth/token', registration_endpoint: ORIGIN + '/api/oauth/register',
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [SCOPE], protected_resources: [RESOURCE], revocation_endpoint: ORIGIN + '/api/oauth/revoke' };
}
async function client(id) { const c = typeof id === 'string' && await get('client/' + hash(id)); if (!c) fail('unknown client'); return c; }
async function validateRequest(args) {
  const c = await client(args.client_id);
  if (!c.redirect_uris.includes(args.redirect_uri)) fail('unregistered redirect URI');
  if (args.response_type !== 'code') fail('response_type must be code');
  if (args.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(args.code_challenge || '')) fail('S256 PKCE required');
  if (args.resource && args.resource !== RESOURCE) fail('resource must match Everest MCP endpoint');
  if (args.scope && args.scope !== SCOPE) fail('unsupported scope');
  if (typeof args.state !== 'string' || args.state.length > 2048) fail('state required');
  return c;
}
async function register(args) {
  if (!args || !Array.isArray(args.redirect_uris) || !args.redirect_uris.length || args.redirect_uris.length > 5) fail('redirect_uris required');
  for (const uri of args.redirect_uris) {
    if (typeof uri !== 'string' || uri.length > 2048) fail('invalid redirect URI');
    let u; try { u = new URL(uri); } catch { fail('invalid redirect URI'); }
    if (u.protocol !== 'https:' || u.hash || u.username || u.password) fail('HTTPS redirect URI without fragment required');
  }
  const method = args.token_endpoint_auth_method || 'none';
  if (!metadata().token_endpoint_auth_methods_supported.includes(method)) fail('unsupported client authentication');
  const id = random(), secret = method === 'none' ? null : random();
  const c = { client_id: id, client_name: String(args.client_name || 'Assistant').slice(0, 100), redirect_uris: args.redirect_uris,
    token_endpoint_auth_method: method, secretHash: secret ? hash(secret) : null, created_at: Date.now() };
  await put('client/' + hash(id), c);
  return { client_id: id, ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}), client_id_issued_at: Math.floor(Date.now()/1000), redirect_uris: c.redirect_uris, token_endpoint_auth_method: method, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] };
}
async function authorize(user, args) {
  await validateRequest(args);
  if (args.approve !== true) fail('explicit connection approval required');
  const code = random();
  await put('code/' + hash(code), { uid: user.id, client_id: args.client_id, redirect_uri: args.redirect_uri,
    challenge: args.code_challenge, resource: RESOURCE, expires: Date.now() + 5*60*1000 });
  const redirect = new URL(args.redirect_uri); redirect.searchParams.set('code', code); redirect.searchParams.set('state', args.state); redirect.searchParams.set('iss', ORIGIN);
  return { redirect: redirect.toString() };
}
async function authenticateClient(args, headers) {
  let id=args.client_id, secret=args.client_secret;
  if ((headers.authorization || '').startsWith('Basic ')) {
    const raw=Buffer.from(headers.authorization.slice(6), 'base64').toString(); const i=raw.indexOf(':');
    if(i<0)fail('invalid client authentication',401);
    id=decodeURIComponent(raw.slice(0,i)); secret=decodeURIComponent(raw.slice(i+1));
  }
  const c=await client(id);
  const basic=(headers.authorization || '').startsWith('Basic ');
  if(c.token_endpoint_auth_method==='client_secret_basic'&&!basic)fail('Basic client authentication required',401);
  if(c.token_endpoint_auth_method==='client_secret_post'&&basic)fail('POST client authentication required',401);
  if(c.secretHash && (typeof secret!=='string'||hash(secret)!==c.secretHash))fail('invalid client authentication',401);
  return c;
}
async function issue(uid, clientId) {
  const access=random(), refresh=random(); const expires=Date.now()+60*60*1000;
  await put('access/'+hash(access),{uid,client_id:clientId,resource:RESOURCE,scope:SCOPE,expires});
  await put('refresh/'+hash(refresh),{uid,client_id:clientId,resource:RESOURCE,expires:Date.now()+30*86400000});
  return {access_token:access,token_type:'Bearer',expires_in:3600,refresh_token:refresh,scope:SCOPE};
}
async function exchange(args, headers) {
  const c=await authenticateClient(args,headers);
  if(args.resource && args.resource!==RESOURCE)fail('invalid target resource');
  if(args.grant_type==='authorization_code') {
    if(typeof args.code!=='string')fail('invalid grant');
    const g=await get('code/'+hash(args.code));
    if(!g||g.client_id!==c.client_id||g.redirect_uri!==args.redirect_uri||g.expires<Date.now())fail('invalid or expired grant');
    if(!/^[A-Za-z0-9._~-]{43,128}$/.test(args.code_verifier||'')||crypto.createHash('sha256').update(args.code_verifier).digest('base64url')!==g.challenge)fail('PKCE verification failed');
    if(!await claim('code/'+hash(args.code)))fail('grant already redeemed');
    return issue(g.uid,c.client_id);
  }
  if(args.grant_type==='refresh_token') {
    if(typeof args.refresh_token!=='string')fail('invalid refresh token');
    const g=await get('refresh/'+hash(args.refresh_token));
    if(!g||g.client_id!==c.client_id||g.expires<Date.now()||await get('revoked/'+hash(args.refresh_token)))fail('invalid refresh token');
    if(!await claim('refresh/'+hash(args.refresh_token)))fail('refresh token already redeemed');
    return issue(g.uid,c.client_id);
  }
  fail('unsupported grant type');
}
async function tokenUser(token) {
  if(typeof token!=='string'||token.length>512)return null;
  const a=await get('access/'+hash(token));
  if(!a||a.expires<Date.now()||a.resource!==RESOURCE||a.scope!==SCOPE||await get('revoked/'+hash(token)))return null;
  return store.getUserById(a.uid);
}
async function route(ctx, user) {
  const p=ctx.pathname, args=ctx.body || {};
  const response=(status,json)=>({status,json,headers:{'Cache-Control':'no-store'}});
  try {
    if(p==='/api/oauth/metadata'&&ctx.method==='GET')return response(200,metadata());
    if(p==='/api/oauth/resource'&&ctx.method==='GET')return response(200,{resource:RESOURCE,authorization_servers:[ORIGIN],scopes_supported:[SCOPE],bearer_methods_supported:['header']});
    if(p==='/api/oauth/register'&&ctx.method==='POST')return response(201,await register(args));
    if(p==='/api/oauth/token'&&ctx.method==='POST')return response(200,await exchange(args,ctx.headers||{}));
    if(p==='/api/oauth/revoke'&&ctx.method==='POST') {
      const c=await authenticateClient(args,ctx.headers||{});
      if(typeof args.token==='string'){
        const value=await get('access/'+hash(args.token))||await get('refresh/'+hash(args.token));
        if(value&&value.client_id===c.client_id)await put('revoked/'+hash(args.token),{revoked:true});
      }
      return response(200,{});
    }
    if(p==='/api/oauth/request'&&ctx.method==='POST') {const c=await validateRequest(args);return response(200,{client_name:c.client_name,redirect_origin:new URL(args.redirect_uri).origin,scope:SCOPE});}
    if(p==='/api/oauth/authorize'&&ctx.method==='POST') {if(!user)return response(401,{error:'authentication required'});return response(200,await authorize(user,args));}
  } catch(e){return response(e.status||400,{error:p.endsWith('/token')?'invalid_grant':'invalid_request',error_description:e.message});}
  return null;
}
module.exports={route,tokenUser,setDriver,RESOURCE,metadata,register,authorize,exchange,validateRequest};
