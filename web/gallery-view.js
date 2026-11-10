// Shared by the existing standalone gallery and the Companion's Gallery tab.
export function createGalleryView({ root, summary, category, search, maximum, allowedOrigins, onSave, isSaved, onChange }) {
  let latest = null, categorySignature = '';
  const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
  function text(tag, value, parent, className) { const e = document.createElement(tag); e.textContent = value; if (className) e.className = className; parent.append(e); return e; }
  function render() {
    if (!latest) return;
    const products = latest.options || latest.products || [];
    const remaining = latest.remaining_budget ?? latest.budget_remaining;
    const categories = [...new Set(products.map(p => p.category))];
    const signature = categories.join('|');
    if (signature !== categorySignature) {
      const selected = category.value;
      category.replaceChildren(new Option('All categories', ''));
      for (const name of categories) category.add(new Option(name, name));
      category.value = categories.includes(selected) ? selected : '';
      categorySignature = signature;
    }
    const query = search.value.trim().toLowerCase();
    const ceiling = maximum?.value === '' || !maximum ? Infinity : Number(maximum.value);
    root.replaceChildren();
    if (!Number.isFinite(ceiling) && ceiling !== Infinity || ceiling < 0) { summary.textContent = 'Enter zero or a positive maximum price.'; return; }
    const options = products.filter(p => (!category.value || p.category === category.value) && p.name.toLowerCase().includes(query) && p.price <= ceiling);
    summary.textContent = `${options.length} ${options.length === 1 ? 'gift' : 'gifts'}${typeof remaining === 'number' ? ' · ' + money(remaining) + ' remaining' : ''}`;
    if (!options.length) text('p', 'No gifts match these filters. Try another category or search.', root, 'empty');
    for (const p of options) {
      const card = document.createElement('article'); card.className = 'gift-card';
      const image = document.createElement('img');
      let url; try { url = new URL(p.image_url); } catch {}
      if (url && allowedOrigins.includes(url.origin) && /^\/assets\/products\/p\d+\.jpg$/.test(url.pathname)) image.src = url.href;
      image.alt = p.image_alt || p.name; image.loading = 'eager';
      image.addEventListener('error', () => { image.hidden = true; text('p', 'Photo unavailable', card, 'missing-photo'); });
      card.append(image);
      const details = text('div', '', card, 'gift-details');
      text('span', p.category, details, 'gift-category');
      text('h2', p.name, details);
      text('p', money(p.price), details, 'gift-price meta');
      const total = p.estimated_total ?? p.price;
      const within = typeof remaining === 'number' ? total <= remaining : p.within_budget;
      const shortfall = typeof remaining === 'number' ? Math.max(0, total - remaining) : p.budget_shortfall;
      text('p', typeof within !== 'boolean' ? 'Simulated catalog gift' : within ? 'Within remaining budget' : `${money(shortfall)} above remaining budget`, details, within === false ? 'over' : 'affordable');
      if (onSave) {
        const saved = !!isSaved?.(p);
        const button = text('button', saved ? 'Idea saved' : 'Save idea', details, 'btn ghost sm save-idea');
        button.type = 'button'; button.disabled = saved; button.dataset.mutating = 'true'; button.setAttribute('aria-label', (saved ? 'Idea saved: ' : 'Save idea: ') + p.name);
        button.onclick = () => onSave(p);
      }
      root.append(card);
    }
  }
  for (const [control,event] of [[category,'change'],[search,'input'],[maximum,'input']]) if (control) control.addEventListener(event, () => { render(); onChange?.(); });
  return { setData(data) { latest = data; render(); }, render,
    getState() { return { category: category.value, search: search.value, maximum: maximum?.value || '' }; },
    setState(state = {}) { if (state.category !== undefined) category.value = state.category; if (state.search !== undefined) search.value = state.search; if (maximum && state.maximum !== undefined) maximum.value = state.maximum; render(); } };
}
