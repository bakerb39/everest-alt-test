'use strict';
const catalog = require('./catalog');
const store = require('./store');
const budget = require('./budget');
const { newId } = require('./security');

const CATEGORIES = [...new Set(catalog.map((p) => p.category))];

// Placeholder for the local-maker fulfillment network (real partners get wired
// in at fulfillment time). Chosen deterministically per gift so results are
// reproducible rather than random.
const MAKERS = ['Marigold & Fern', 'The Local Press', 'Cedar & Co.', 'Rosewood Makers', 'Harbor Goods'];
function pickMaker(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return MAKERS[h % MAKERS.length];
}

// Amazon pilot: an unpriced checkout draft. The shopper confirms the actual
// item, price, address and delivery option on Amazon; no budget is charged here.
function draftKindle(user, input) {
  const recipientName = String(input.recipient_name || '').trim().slice(0, 80);
  if (!recipientName) throw budget.httpError(400, 'recipient name required for Kindle draft');
  const requestedDate = String(input.requested_date || '').trim();
  if (requestedDate && (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ||
    !Number.isFinite(Date.parse(requestedDate + 'T12:00:00Z')) ||
    new Date(requestedDate + 'T12:00:00Z').toISOString().slice(0, 10) !== requestedDate))
    throw budget.httpError(400, 'requested_date must be YYYY-MM-DD');
  const gift = {
    id: newId('gft'), userId: user.id, recipientName,
    occasion: String(input.occasion || 'just because').slice(0, 80),
    product: 'Kindle e-reader (model to choose on Amazon)', category: 'tech',
    amount: null, maker: 'Amazon checkout', provider: 'amazon',
    status: 'draft — checkout required', requestedDate: requestedDate || null,
    checkoutUrl: 'https://www.amazon.com/s?k=Amazon+Kindle+e-reader',
    cardMessage: null, cancelableUntil: null, createdAt: Date.now(),
  };
  store.addGift(gift);
  return publicGift(gift);
}

/**
 * Execute a gift. This is what Grok's `send_gift` tool call runs, and also the
 * raw POST /api/gifts endpoint. The agent supplies intent (who / why / how much);
 * we resolve it to a real product, enforce the budget, "charge", and log.
 *
 * The agent NEVER sees payment data — the result contains only public confirmation.
 */
function sendGift(user, input, idempotencyKey) {
  // Idempotency: a retried/duplicated call returns the original gift.
  if (idempotencyKey) {
    const existingId = store.getIdempotent(idempotencyKey);
    if (existingId) {
      const g = store.listGifts(user.id).find((x) => x.id === existingId);
      if (g) return { ...publicGift(g), idempotent: true };
    }
  }

  const occasion = String(input.occasion || 'just because').slice(0, 80);
  const cardMessage = input.card_message ? String(input.card_message).slice(0, 300) : null;

  // Resolve the recipient (by id, or by free-text name the agent provided).
  let recipientName = 'someone you love';
  if (input.recipient_id) {
    const r = store.getRecipient(input.recipient_id);
    if (!r || r.userId !== user.id) throw budget.httpError(404, 'recipient not found');
    recipientName = r.name;
  } else if (input.recipient_name) {
    recipientName = String(input.recipient_name).slice(0, 80);
  }

  // Determine the cap for THIS gift: min(requested, remaining budget).
  const remaining = budget.remaining(user);
  const requested = Number(input.max_amount);
  const cap = Math.min(
    Number.isFinite(requested) && requested > 0 ? requested : remaining,
    remaining
  );
  if (cap <= 0) throw budget.httpError(402, 'no remaining budget this cycle');

  // Pick the best real product: matching category (if valid) and within the cap.
  const category = CATEGORIES.includes(input.category) ? input.category : null;
  const product = pickProduct(category, cap);
  if (!product) {
    throw budget.httpError(422, `nothing available under $${cap}${category ? ' in ' + category : ''}`);
  }

  // Enforce + charge the budget (throws 402 if it would exceed the cap).
  budget.charge(user, product.price);

  const gift = {
    id: newId('gft'),
    userId: user.id,
    recipientName,
    occasion,
    category: product.category,
    product: product.name,
    amount: product.price,
    cardMessage,
    maker: pickMaker(recipientName + '|' + product.name),
    status: 'scheduled',
    cancelableUntil: Date.now() + 60 * 60 * 1000, // 1-hour cancel window
    createdAt: Date.now(),
  };
  store.addGift(gift);
  store.putUser(user); // persist the budget charge
  if (idempotencyKey) store.putIdempotent(idempotencyKey, gift.id);

  return publicGift(gift);
}

// Highest-priced item that fits the cap (best gift within budget); fallback to cheapest.
function pickProduct(category, cap) {
  const pool = catalog.filter((p) => (!category || p.category === category) && p.price <= cap);
  if (pool.length) return pool.sort((a, b) => b.price - a.price)[0];
  const any = catalog.filter((p) => p.price <= cap).sort((a, b) => a.price - b.price);
  return any[0] || null;
}

// Only public, card-free fields ever leave the server / reach the agent.
function publicGift(g) {
  return {
    image_url: (catalog.find(p => p.name === g.product) || {}).image_url || null,
    image_alt: (catalog.find(p => p.name === g.product) || {}).image_alt || null,
    scheduled_date: g.scheduledDate || null,
    schedule_timezone: g.scheduleTimezone || null,
    completed_at: g.completedAt ? new Date(g.completedAt).toISOString() : null,
    gift_id: g.id,
    status: g.status,
    recipient: g.recipientName,
    occasion: g.occasion,
    product: g.product,
    category: g.category,
    amount: g.amount,
    maker: g.maker,
    card_message: g.cardMessage,
    cancel_before: g.cancelableUntil ? new Date(g.cancelableUntil).toISOString() : null,
    provider: g.provider || null,
    requested_date: g.requestedDate || null,
    checkout_url: g.checkoutUrl || null,
    created_at: new Date(g.createdAt).toISOString(),
  };
}

// Older connector approvals already charged the budget but had no ledger row.
// Include them in history without charging again or exposing pending drafts.
function listAccountGifts(user) {
  const ledger = store.listGifts(user.id);
  const ids = new Set(ledger.map(g => g.id));
  const legacy = (user.assistantOrders || []).filter(o =>
    o.status === 'simulated — approved' && !ids.has(o.gift_id || o.id)
  ).map(o => ({
    id: o.gift_id || o.id, userId: user.id, recipientName: o.recipient,
    product: o.product, occasion: 'assistant gift', amount: o.total,
    cardMessage: o.card_message, maker: 'Everest ALT', provider: 'assistant',
    status: o.status, createdAt: o.approved_at || o.created_at || (o.expires_at - 30 * 60 * 1000),
    cancelableUntil: null,
  }));
  return ledger.concat(legacy).sort((a, b) => b.createdAt - a.createdAt).map(publicGift);
}

module.exports = { sendGift, draftKindle, publicGift, listAccountGifts, CATEGORIES };

