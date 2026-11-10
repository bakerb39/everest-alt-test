import { App } from '@modelcontextprotocol/ext-apps';
import catalog from '../lib/catalog.js';
import { createGalleryView } from './gallery-view.js';
const HOST = 'https://papaya-cassata-7e507b.netlify.app';
const view = createGalleryView({ root: document.getElementById('gifts'), summary: document.getElementById('summary'), category: document.getElementById('category'), search: document.getElementById('search'), allowedOrigins: [HOST] });
if (window.parent === window) view.setData({ options: catalog });
else {
  const app = new App({ name: 'Everest ALT Gift Gallery', version: '1.0.0' }, {});
  app.ontoolresult = result => view.setData(result.structuredContent || {});
  app.connect().catch(() => { document.getElementById('summary').textContent = 'Gallery connection unavailable. Open the hosted gallery below to view the photos.'; });
  if (window.openai?.toolOutput) view.setData(window.openai.toolOutput);
  window.addEventListener('openai:set_globals', event => { if (event.detail?.globals?.toolOutput) view.setData(event.detail.globals.toolOutput); });
}
