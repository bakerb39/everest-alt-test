import adapter from '../../lib/netlify-adapter.js';
import { getStore } from '@netlify/blobs';
export default async function (request) {
  const result = await adapter.handler({ modernRuntime: true,
    blobStore: getStore({ name: 'everest-alt', consistency: 'strong' }),
    httpMethod: request.method, rawUrl: request.url,
    headers: Object.fromEntries(request.headers.entries()),
    body: ['POST', 'PUT'].includes(request.method) ? await request.text() : '' });
  return new Response(result.statusCode === 204 ? null : result.body,
    { status: result.statusCode, headers: result.headers });
}
