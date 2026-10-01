import { App } from '@modelcontextprotocol/ext-apps';
import catalog from '../lib/catalog.js';
const root = document.getElementById('gifts');
const summary = document.getElementById('summary');
const category = document.getElementById('category');
const search = document.getElementById('search');
const HOST = 'https://papaya-cassata-7e507b.netlify.app';
let latest;
function render(data) {
  if (!data || !Array.isArray(data.options)) return;
  latest = data;
  const options = data.options.filter(p => (!category.value || p.category === category.value) && p.name.toLowerCase().includes(search.value.trim().toLowerCase()));
  summary.textContent = `${options.length} gifts · ${typeof data.remaining_budget === 'number' ? '$' + data.remaining_budget.toFixed(2) + ' remaining. Over-budget gifts can be browsed; approval requires sufficient budget.' : 'Illustrative simulated catalog. Sign in to review your budget and schedule gifts.'}`;
  root.replaceChildren();
  if (!options.length) {
    const empty = document.createElement('p'); empty.textContent = data.message || 'No gifts match these filters.'; root.append(empty);
  }
  for (const p of options) {
    const card = document.createElement('article');
    const img = document.createElement('img');
    if (p.image_url && p.image_url.startsWith(HOST + '/assets/products/')) img.src = p.image_url;
    img.alt = p.image_alt || p.name; img.loading = 'lazy';
    img.addEventListener('error', () => { img.hidden = true; const note = document.createElement('p'); note.textContent = 'Photo unavailable'; card.prepend(note); });
    const title = document.createElement('h2'); title.textContent = p.name;
    const meta = document.createElement('p'); meta.className = 'meta'; meta.textContent = `$${p.price.toFixed(2)} · ${p.category}`;
    const label = document.createElement('p'); label.className = p.within_budget === false ? 'over' : 'affordable';
    label.textContent = typeof p.within_budget !== 'boolean' ? 'Simulated gift' : p.within_budget ? 'Within remaining budget' : `Over remaining budget by $${p.budget_shortfall.toFixed(2)}`;
    card.append(img, title, meta, label); root.append(card);
  }
}
for (const c of [...new Set(catalog.map(p => p.category))]) { const option = document.createElement('option'); option.value = option.textContent = c; category.append(option); }
category.addEventListener('change', () => render(latest));
search.addEventListener('input', () => render(latest));
if (window.parent === window) render({ options: catalog });
else {
  const app = new App({ name: 'Everest ALT Gift Gallery', version: '1.0.0' }, {});
  app.ontoolresult = result => render(result.structuredContent);
  app.connect().catch(() => { summary.textContent = 'Gallery connection unavailable. Open the hosted gallery below to view the photos.'; });
  // Compatibility for hosts providing the older ChatGPT UI globals.
  if (window.openai?.toolOutput) render(window.openai.toolOutput);
  window.addEventListener('openai:set_globals', event => { if (event.detail?.globals?.toolOutput) render(event.detail.globals.toolOutput); });
}
