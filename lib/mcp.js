'use strict';
// Stateless JSON transport; every call is scoped to the authenticated account.
const catalog = require('./catalog');
const store = require('./store');
const budget = require('./budget');
const { newId } = require('./security');
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string', minLength: 1, maxLength: 300 };
const tools = [
  { name: 'get_budget', description: 'Read the simulated gift budget.', inputSchema: schema({}), annotations: { readOnlyHint: true } },
  { name: 'find_gifts', description: 'Return prototype catalog options. Prices are simulated, not vendor quotes.', inputSchema: schema({ category: str, max_amount: { type: 'number', exclusiveMinimum: 0 } }), annotations: { readOnlyHint: true } },
  { name: 'prepare_gift_order', description: 'Prepare a simulated order for review without spending. The user must approve the exact returned order before approval is called.', inputSchema: schema({ product: str, recipient: str, card_message: str }, ['product', 'recipient', 'card_message']) },
  { name: 'approve_gift_order', description: 'ONLY after the user explicitly approves this exact simulated order and total. Records a simulation and deducts the demo budget. Never buys or ships a product.', inputSchema: schema({ order_id: str, approved_total: { type: 'number' }, user_approved: { type: 'boolean', const: true } }, ['order_id', 'approved_total', 'user_approved']), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: 'get_order_status', description: 'Read a simulated order belonging to this account.', inputSchema: schema({ order_id: str }, ['order_id']), annotations: { readOnlyHint: true } },
];
for (const tool of tools) {
  tool.securitySchemes = [{ type: 'oauth2', scopes: ['gifts:simulate'] }];
  tool._meta = { securitySchemes: tool.securitySchemes };
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
  if (name === 'get_budget') return budget.summary(user);
  if (name === 'find_gifts') return { simulated: true, options: catalog.filter(p => (!args.category || p.category === args.category) && p.price <= Math.min(args.max_amount || Infinity, budget.remaining(user))).slice(0, 5) };
  if (name === 'prepare_gift_order') {
    const product = catalog.find(p => p.name === args.product);
    if (!product) throw Error('choose an exact catalog product');
    const order = { id: newId('ord'), simulated: true, product: product.name, recipient: args.recipient, card_message: args.card_message, subtotal: product.price, shipping: 0, tax: 0, total: product.price, currency: 'USD', status: 'awaiting approval', created_at: Date.now(), expires_at: Date.now() + 30 * 60 * 1000 };
    user.assistantOrders = user.assistantOrders || [];
    user.assistantOrders.push(order);
    store.putUser(user);
    return order;
  }
  const order = orderFor(user, args.order_id);
  if (name === 'get_order_status') return order;
  if (args.user_approved !== true || args.approved_total !== order.total) throw Error('explicit approval of the exact total required');
  if (order.status === 'simulated — approved') return order;
  if (Date.now() >= order.expires_at) throw Error('order expired; prepare a new order');
  budget.charge(user, order.total);
  order.status = 'simulated — approved';
  order.approved_at = Date.now();
  order.gift_id = order.id;
  store.addGift({
    id: order.id, userId: user.id, recipientName: order.recipient,
    product: order.product, category: catalog.find(p => p.name === order.product).category,
    occasion: 'assistant gift', amount: order.total, cardMessage: order.card_message,
    maker: 'Everest ALT', provider: 'assistant', status: order.status,
    createdAt: order.approved_at, cancelableUntil: null,
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
    result = { protocolVersion: versions.includes(req.params && req.params.protocolVersion) ? req.params.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'everest-alt', version: '0.2.0' }, instructions: 'All orders are simulations. Never claim a purchase or shipment occurred. Require explicit user approval before calling approve_gift_order.' };
  } else if (req.method === 'ping') result = {};
  else if (req.method === 'tools/list') result = { tools };
  else if (req.method === 'tools/call') {
    try {
      const data = execute(user, req.params && req.params.name, req.params && req.params.arguments || {});
      result = { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    } catch (e) { result = { isError: true, content: [{ type: 'text', text: e.message }] }; }
  } else return error(-32601, 'method not found');
  return { status: 200, json: { jsonrpc: '2.0', id: req.id, result } };
}
module.exports = { handleMcp, execute };

