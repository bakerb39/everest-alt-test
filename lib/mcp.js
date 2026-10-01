'use strict';
// Stateless JSON transport; every call is scoped to the authenticated account.
const catalog = require('./catalog');
const store = require('./store');
const budget = require('./budget');
const schedules = require('./schedules');
const gallery = require('./gift-gallery');
const { newId } = require('./security');
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const categories = [...new Set(catalog.map(p => p.category))];
const str = { type: 'string', minLength: 1, maxLength: 300 };
const tools = [
  { name: 'get_budget', description: 'Read the simulated gift budget.', inputSchema: schema({}), annotations: { readOnlyHint: true } },
  { name: 'find_gifts', description: 'Browse simulated catalog gifts by optional product name, category, occasion, and maximum amount, even when over the remaining budget. Explain within_budget and budget_shortfall; approval still enforces the cap. Categories: flowers, jewelry, tech, grooming, handmade, home, wellness, experiences, fashion, food. Birthday and anniversary are occasions, not categories; pass occasion and omit category unless a valid category was requested. When the user names a specific gift, pass product so only matching item(s) are returned. Always tell the user valid_categories for an unknown category. For photos, call show_gift_gallery with the same filters. Do not embed external photo URLs as Markdown images; ChatGPT may show broken placeholders. Use the gallery UI or ordinary photo links.', inputSchema: schema({ product: { ...str, description: 'Optional gift product name or partial product name. Use this to isolate a specific gift.' }, category: { ...str, description: 'Optional product category. Use list_gift_categories for supported values; do not invent categories.' }, occasion: { ...str, description: 'Optional occasion, such as birthday or anniversary. Catalog has no occasion-specific tags; results are general gift suggestions.' }, max_amount: { type: 'number', exclusiveMinimum: 0 } }), annotations: { readOnlyHint: true } },
  { name: 'list_gift_categories', description: 'List all supported product categories. Birthday and anniversary are occasions, not categories. Use these category names when browsing gifts.', inputSchema: schema({}), annotations: { readOnlyHint: true } },
  { name: 'prepare_gift_order', description: 'Prepare a simulated order for review without spending. The user must approve the exact returned order before approval is called. Optional scheduling reserves the simulated cost on approval and completes on the chosen date. Never promise physical delivery.', inputSchema: schema({ product: str, recipient: str, card_message: str, scheduled_date: { type: 'string', description: 'Optional future YYYY-MM-DD date; completes at or after 9 AM in schedule_timezone.' }, schedule_timezone: { type: 'string', description: 'IANA timezone, defaults to America/New_York.' } }, ['product', 'recipient', 'card_message']) },
  { name: 'approve_gift_order', description: 'ONLY after the user explicitly approves this exact simulated order and total. Records a simulation and deducts the demo budget once, immediately, including scheduled gifts. Never buys or ships a product.', inputSchema: schema({ order_id: str, approved_total: { type: 'number' }, user_approved: { type: 'boolean', const: true } }, ['order_id', 'approved_total', 'user_approved']), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: 'list_scheduled_gifts', description: 'List this account’s approved future gifts and completed scheduled simulations, including dates and photos.', inputSchema: schema({}), annotations: { readOnlyHint: true } },
  { name: 'get_order_status', description: 'Read a simulated order belonging to this account.', inputSchema: schema({ order_id: str }, ['order_id']), annotations: { readOnlyHint: true } },
];
const searchTool = tools.find(t => t.name === 'find_gifts');
tools.push({ name: 'show_gift_gallery', description: 'Display a supported inline photo gallery of simulated gifts, prices, categories and affordability labels. If the user asks to see a specific gift or its photo, pass product with the product name so only matching gift(s) are displayed. Otherwise pass the same category, occasion, and max_amount filters as find_gifts. The UI shows photos directly. Do not duplicate the gallery with Markdown images. No spending occurs.', inputSchema: searchTool.inputSchema, annotations: { readOnlyHint: true }, _meta: { ui: { resourceUri: gallery.URI }, 'openai/outputTemplate': gallery.URI, 'openai/toolInvocation/invoking': 'Loading gift gallery…', 'openai/toolInvocation/invoked': 'Gift gallery ready' } });
for (const tool of tools) {
  tool.securitySchemes = [{ type: 'oauth2', scopes: ['gifts:simulate'] }];
  tool._meta = { ...tool._meta, securitySchemes: tool.securitySchemes };
}
function orderFor(user, id) {
  const order = (user.assistantOrders || []).find(o => o.id === id);
  if (!order) throw Error('order not found');
  return order;
}
function execute(user, name, args) {
  const tool = tools.find(t => t.name === name);
  if (!tool) throw Error('unknown tool');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('arguments must be an object');
  for (const key of Object.keys(args)) {
    const rule = tool.inputSchema.properties[key];
    if (!rule || typeof args[key] !== rule.type) throw Error('invalid argument: ' + key);
    if (rule.type === 'string' && (!args[key].trim() || args[key].length > 300)) throw Error('invalid argument: ' + key);
    if (rule.type === 'number' && (!Number.isFinite(args[key]) || (rule.exclusiveMinimum === 0 && args[key] <= 0))) throw Error('invalid argument: ' + key);
  }
  for (const key of tool.inputSchema.required) if (!(key in args)) throw Error('missing argument: ' + key);
  if (name === 'show_gift_gallery') return { ...execute(user, 'find_gifts', args), display_gallery: true, gallery_url: 'https://papaya-cassata-7e507b.netlify.app/gift-gallery.html' };
  if (name === 'get_budget') return budget.summary(user);
  if (name === 'list_gift_categories') return { valid_categories: categories, guidance: 'Birthday and anniversary are occasions, not product categories. Browse any category or omit category for all gifts.' };
  if (name === 'find_gifts') {
    let category = args.category ? args.category.trim().toLowerCase() : null;
    let occasion = args.occasion ? args.occasion.trim() : null;
    // Accept older clients that mistakenly send a common occasion as category.
    if (category && /^(birthdays?|anniversar(y|ies))( gifts)?$/.test(category)) {
      occasion = occasion || category.replace(/ gifts$/, '');
      category = null;
    }
    const remaining = budget.remaining(user);
    const productQuery = args.product ? args.product.trim().toLowerCase() : null;
    const base = { simulated: true, valid_categories: categories, remaining_budget: remaining, requested_max_amount: args.max_amount || null, product: args.product ? args.product.trim() : null, category, occasion,
      budget_policy: 'Browsing does not spend or hide over-budget gifts. Exact approval is required and cannot exceed the remaining budget.',
      occasion_note: occasion ? 'The catalog has no occasion-specific tags. These are general gift suggestions for your occasion.' : null };
    if (category && !categories.includes(category)) return { ...base, options: [], total_matches: 0, invalid_category: category,
      message: `Unknown product category "${category}". Valid categories: ${categories.join(', ')}. Choose one or omit category to browse all gifts. Birthday and anniversary are occasions.` };
    const options = catalog.filter(p => (!productQuery || p.name.toLowerCase().includes(productQuery)) && (!category || p.category === category) && p.price <= (args.max_amount || Infinity)).map(p => ({ ...p,
      within_budget: p.price <= remaining, budget_shortfall: Math.round(Math.max(0, p.price - remaining) * 100) / 100 }));
    return { ...base, options, total_matches: options.length,
      message: options.length ? `Found ${options.length} gifts. Remaining budget: $${remaining.toFixed(2)}. Items marked over budget can be browsed but cannot be approved.` : `No catalog gifts match this category and maximum amount. Valid categories: ${categories.join(', ')}. Try a different category or raise the search maximum.` };
  }
  if (name === 'list_scheduled_gifts') return { simulated: true, orders: (user.assistantOrders || []).filter(o => o.scheduled_date && o.approved_at) };
  if (name === 'prepare_gift_order') {
    const product = catalog.find(p => p.name === args.product);
    if (!product) throw Error('choose an exact catalog product');
    const schedule = schedules.validateSchedule(args.scheduled_date, args.schedule_timezone);
    const order = { ...schedule, image_url: product.image_url, image_alt: product.image_alt, id: newId('ord'), simulated: true, product: product.name, recipient: args.recipient, card_message: args.card_message, subtotal: product.price, shipping: 0, tax: 0, total: product.price, currency: 'USD', status: 'awaiting approval', created_at: Date.now(), expires_at: Date.now() + 30 * 60 * 1000 };
    user.assistantOrders = user.assistantOrders || [];
    user.assistantOrders.push(order);
    store.putUser(user);
    return order;
  }
  const order = orderFor(user, args.order_id);
  if (name === 'get_order_status') return order;
  if (args.user_approved !== true || args.approved_total !== order.total) throw Error('explicit approval of the exact total required');
  if (order.approved_at) return order;
  if (Date.now() >= order.expires_at) throw Error('order expired; prepare a new order');
  if (order.scheduled_date) schedules.validateSchedule(order.scheduled_date, order.schedule_timezone);
  budget.charge(user, order.total);
  order.status = order.scheduled_date ? 'simulated — scheduled' : 'simulated — approved';
  order.approved_at = Date.now();
  order.gift_id = order.id;
  store.addGift({
    id: order.id, userId: user.id, recipientName: order.recipient,
    product: order.product, category: catalog.find(p => p.name === order.product).category,
    occasion: 'assistant gift', amount: order.total, cardMessage: order.card_message,
    maker: 'Everest ALT', provider: 'assistant', status: order.status,
    createdAt: order.approved_at, cancelableUntil: null,
    scheduledDate: order.scheduled_date || null, scheduleTimezone: order.schedule_timezone || null,
  });
  store.putUser(user);
  return order;
}
function handleMcp(user, ctx) {
  if (ctx.method !== 'POST') return { status: 405, json: { error: 'use POST' } };
  const req = ctx.body;
  const error = (code, message) => ({ status: 200, json: { jsonrpc: '2.0', id: req && req.id != null ? req.id : null, error: { code, message } } });
  if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') return error(-32600, 'invalid request');
  if (req.id === undefined) return { status: 202, json: {} };
  let result;
  if (req.method === 'initialize') {
    const versions = ['2025-03-26', '2025-06-18', '2025-11-25'];
    result = { protocolVersion: versions.includes(req.params && req.params.protocolVersion) ? req.params.protocolVersion : '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'everest-alt', version: '0.4.0' }, instructions: 'All orders are simulations. Never claim a purchase or shipment occurred. Require explicit user approval before calling approve_gift_order.' };
  } else if (req.method === 'ping') result = {};
  else if (req.method === 'resources/list') result = { resources: [{ uri: gallery.URI, name: 'everest-gift-gallery', title: 'Everest ALT gift gallery', mimeType: 'text/html;profile=mcp-app' }] };
  else if (req.method === 'resources/templates/list') result = { resourceTemplates: [] };
  else if (req.method === 'resources/read') {
    if (!req.params || req.params.uri !== gallery.URI) return error(-32002, 'resource not found');
    result = { contents: [gallery.resource()] };
  }
  else if (req.method === 'tools/list') result = { tools };
  else if (req.method === 'tools/call') {
    try {
      const data = execute(user, req.params && req.params.name, req.params && req.params.arguments || {});
      result = { content: [{ type: 'text', text: data.display_gallery ? `Displayed ${data.total_matches} simulated gifts in the photo gallery. Remaining budget: $${data.remaining_budget}. Photos are illustrative. If UI is unavailable, open ${data.gallery_url}. Do not reproduce photos as Markdown images.` : JSON.stringify(data) }], structuredContent: data };
    } catch (e) { result = { isError: true, content: [{ type: 'text', text: e.message }] }; }
  } else return error(-32601, 'method not found');
  return { status: 200, json: { jsonrpc: '2.0', id: req.id, result } };
}
module.exports = { handleMcp, execute };

