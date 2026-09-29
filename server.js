'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { handleApi } = require('./lib/api');

/**
 * Node HTTP adapter. Runs the standalone server (`node server.js`) — accounts,
 * budget, Grok, gifts — plus serves the static UI from public/. The API logic
 * itself lives in lib/api.js and is shared with the Netlify Function.
 */

/* ------------------------------- helpers ------------------------------- */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
function sendJson(res, status, obj) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, CORS));
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { if (!data) return resolve({}); try { resolve(JSON.parse(data)); } catch { resolve(null); } });
  });
}

/* --------------------------- static (UI) --------------------------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(res, p) {
  let rel = p;
  if (p === '/') rel = '/everestalt.html';        // the vision homepage
  else if (p === '/app' || p === '/app/') rel = '/app.html'; // the account / setup app
  else if (p === '/demo') rel = '/grok-chat.html';
  const file = path.join(__dirname, 'public', path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  if (p === '/api' || p.startsWith('/api/')) {
    (async () => {
      const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : null;
      const result = await handleApi({ method: req.method, pathname: p, headers: req.headers, body });
      sendJson(res, result.status, result.json);
    })().catch((e) => { if (!res.headersSent) sendJson(res, 500, { error: 'server error', detail: String(e && e.message) }); });
  } else {
    serveStatic(res, p);
  }
});

if (require.main === module) {
  server.listen(config.PORT, config.HOST, () => {
    console.log(`Everest ALT backend on http://${config.HOST}:${config.PORT}`);
    console.log(`  app:      http://${config.HOST}:${config.PORT}/       (real accounts)`);
    console.log(`  demo:     http://${config.HOST}:${config.PORT}/demo   (instant auto-login)`);
    console.log(`  xAI mode: ${config.XAI_API_KEY ? 'global key set' : 'per-user key or demo'}  ·  model: ${config.XAI_MODEL}`);
  });
}
module.exports = { server };
