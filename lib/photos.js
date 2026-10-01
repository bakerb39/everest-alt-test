'use strict';
const catalog = require('./catalog');
const allowed = new Set(catalog.map(p => p.image_url));
// Supply actual MCP image blocks as well as URLs so clients can show the photos.
// Missing assets never block a gift action. No arbitrary URLs or account uploads.
async function attachPhotos(response, fetchImage = fetch) {
  const result = response.json && response.json.result;
  if (!result || result.isError || !result.structuredContent) return response;
  const data = result.structuredContent;
  const products = (data.options || data.orders || [data]).filter(p => allowed.has(p.image_url)).slice(0, 5);
  const photos = await Promise.all(products.map(async p => {
    try {
      const r = await fetchImage(p.image_url, { signal: AbortSignal.timeout(4000), redirect: 'error' });
      if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/jpeg')) return null;
      if (Number(r.headers.get('content-length')) > 500000) return null;
      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length > 500000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
      return [{ type: 'text', text: p.image_alt || p.product || p.name }, { type: 'image', data: bytes.toString('base64'), mimeType: 'image/jpeg' }];
    } catch { return null; }
  }));
  result.content.push(...photos.filter(Boolean).flat());
  return response;
}
module.exports = { attachPhotos };
