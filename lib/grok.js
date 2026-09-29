'use strict';
const config = require('../config');
const gifts = require('./gifts');
const budget = require('./budget');
const { newId } = require('./security');

async function validateApiKey(apiKey) {
  try {
    const res = await fetch(`${config.XAI_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw budget.httpError(res.status === 401 || res.status === 403 ? 400 : 502,
      res.status === 401 || res.status === 403 ? 'xAI rejected this API key. Check the key and its permissions.' : `xAI could not validate the key (HTTP ${res.status}).`);
    const data = await res.json();
    if (!Array.isArray(data.data)) throw budget.httpError(502, 'xAI returned an unexpected model list.');
    if (!data.data.some((m) => m.id === config.XAI_MODEL))
      throw budget.httpError(400, `This key cannot access ${config.XAI_MODEL}. Check model access in xAI Console.`);
  } catch (e) {
    if (e.status) throw e;
    throw budget.httpError(502, 'Could not reach xAI to check the key. Please try again.');
  }
}

/**
 * The Grok connection. Grok's API is OpenAI-compatible, so Everest ALT runs a
 * normal chat-completions loop with ONE tool exposed: send_gift. The system
 * prompt tells Grok the budget number and the rules — it never receives the card.
 *
 * If a real xAI key is available the loop calls api.x.ai. If not, a deterministic
 * MOCK stands in for Grok so the end-to-end flow (intent -> tool call -> real
 * budget charge -> confirmation) is fully demonstrable and testable.
 */

const TOOL = {
  type: 'function',
  function: {
    name: 'send_gift',
    description:
      'Send a real physical gift to someone the user loves, fulfilled by a local maker near the recipient. ' +
      'Only ever spends within the user\'s remaining monthly budget. Call this when the user asks to send a gift, ' +
      'or when a meaningful occasion for a known recipient arrives.',
    parameters: {
      type: 'object',
      properties: {
        recipient_name: { type: 'string', description: 'Who the gift is for (a name).' },
        occasion: { type: 'string', description: 'e.g. birthday, anniversary, promotion, hard week, just because.' },
        category: {
          type: 'string',
          enum: gifts.CATEGORIES,
          description: 'The kind of gift that fits.',
        },
        max_amount: { type: 'number', description: 'Cap for this gift in USD; must be <= remaining budget.' },
        card_message: { type: 'string', description: 'A short handwritten-style note to include.' },
      },
      required: ['occasion'],
    },
  },
};

function systemPrompt(remaining, monthlyCap) {
  return (
    'You are the user\'s AI companion, connected to Everest ALT — a rail that lets you send a real physical gift ' +
    'to the people they love. Rules you must follow:\n' +
    `- The user has a monthly gifting budget of $${monthlyCap}. Remaining this cycle: $${remaining}.\n` +
    '- You may call send_gift to send a real gift, but max_amount must never exceed the remaining budget.\n' +
    '- You only ever see the budget number. You never see or handle payment details.\n' +
    '- When a moment clearly calls for a gift (a birthday, a hard week, good news), offer to send one, and if the ' +
    'user agrees (or has told you to act on your own), call send_gift with a fitting category and amount.\n' +
    '- Keep replies warm and brief. After sending, tell the user what was sent and to whom.'
  );
}

async function runAgent({ user, message, apiKey }) {
  const remaining = budget.remaining(user);
  const cap = user.budget ? user.budget.monthlyCap : 0;
  const turnKeyBase = newId('turn');
  const executed = [];

  // Execute a tool call against the real budget/fulfillment.
  function execute(name, args, i) {
    if (name !== 'send_gift') return { error: `unknown tool: ${name}` };
    try {
      const result = gifts.sendGift(user, args || {}, `${turnKeyBase}:${i}`);
      executed.push({ name, args, result });
      return result;
    } catch (e) {
      const err = { error: e.message, status: e.status || 400 };
      executed.push({ name, args, result: err });
      return err;
    }
  }

  const useReal = !!(apiKey || config.XAI_API_KEY);
  const reply = useReal
    ? await realGrok({ user, message, remaining, cap, apiKey: apiKey || config.XAI_API_KEY, execute })
    : mockGrok({ message, remaining, cap, execute });

  return {
    mode: useReal ? 'xai' : 'mock',
    reply,
    tool_calls: executed,
    gifts: executed.filter((e) => e.result && e.result.gift_id).map((e) => e.result),
    budget: budget.summary(user),
  };
}

/* ----------------------------- real Grok (xAI) ----------------------------- */
async function realGrok({ message, remaining, cap, apiKey, execute }) {
  const messages = [
    { role: 'system', content: systemPrompt(remaining, cap) },
    { role: 'user', content: String(message) },
  ];
  let final = '';
  for (let round = 0; round < 4; round++) {
    const res = await fetch(`${config.XAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: config.XAI_MODEL, messages, tools: [TOOL], tool_choice: 'auto' }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw budget.httpError(502, `xAI error ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw budget.httpError(502, 'xAI returned no message');
    messages.push(msg);

    if (msg.tool_calls && msg.tool_calls.length) {
      msg.tool_calls.forEach((tc, i) => {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* keep {} */ }
        const result = execute(tc.function.name, args, `${round}_${i}`);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
      });
      continue; // let Grok respond to the tool results
    }
    final = msg.content || '';
    break;
  }
  return final;
}

/* --------------------- mock Grok (deterministic, no key) --------------------- */
// Parses the message for gift intent, calls send_gift, and narrates like Grok would.
function mockGrok({ message, remaining, execute }) {
  const text = String(message);
  const intent = parseIntent(text);
  const wantsGift = intent.action || /\b(send|get|surprise|gift|order|buy)\b/i.test(text);
  if (!wantsGift) {
    return "I'm here whenever a moment comes up — a birthday, a rough week, good news. Just say the word and I'll send something real, within your budget.";
  }
  if (remaining <= 0) {
    return "I'd love to, but this month's budget is already used up. Bump the cap and I'll take care of it.";
  }
  const args = {
    recipient_name: intent.recipient || 'them',
    occasion: intent.occasion || 'just because',
    category: intent.category || undefined,
    max_amount: intent.amount || remaining,
    card_message: intent.recipientIsName ? `Thinking of you, ${intent.recipient}.` : 'Thinking of you.',
  };
  const result = execute('send_gift', args, '0_0');
  if (result.error) {
    return `I tried, but couldn't complete it: ${result.error}.`;
  }
  return `Done — I sent a ${result.product} to ${result.recipient} for ${result.occasion} ($${result.amount}), ` +
    `from ${result.maker}. You've got $${budgetRemainingAfter(remaining, result.amount)} left this month.`;
}

function budgetRemainingAfter(before, amount) { return Math.round((before - amount) * 100) / 100; }

function parseIntent(text) {
  const lower = text.toLowerCase();
  const catMap = {
    flowers: ['flower', 'bouquet', 'roses', 'orchid'],
    jewelry: ['jewel', 'necklace', 'bracelet', 'earring', 'pendant', 'watch'],
    tech: ['tech', 'gadget', 'earbuds', 'headphones', 'tracker'],
    grooming: ['cologne', 'perfume', 'fragrance', 'grooming', 'shave', 'skincare'],
    handmade: ['handmade', 'leather', 'knife', 'journal', 'mug', 'ceramic'],
    home: ['blanket', 'candle', 'pillow', 'home', 'cozy', 'lamp'],
    wellness: ['spa', 'wellness', 'yoga', 'diffuser', 'self-care', 'relax'],
    experiences: ['dinner', 'hike', 'golf', 'bike', 'camping', 'experience'],
    fashion: ['scarf', 'bag', 'sunglasses', 'cap', 'fashion'],
    food: ['chocolate', 'wine', 'coffee', 'whiskey', 'cheese', 'tea', 'food', 'snack'],
  };
  let category = null;
  for (const [cat, kws] of Object.entries(catMap)) {
    if (kws.some((k) => lower.includes(k))) { category = cat; break; }
  }
  // Occasion — match on word stems so "promoted" -> promotion, "graduating" -> graduation, etc.
  const occasionStems = [
    ['anniversary', /anniversary/], ['promotion', /promot/], ['graduation', /graduat/],
    ['wedding', /wedding|married|engaged|engagement/], ['birthday', /birthday|b-?day/],
    ['new job', /new job|new gig|first day/], ['hard week', /hard week|rough week|tough week|hard time|rough patch|stressed/],
    ['thank you', /thank/], ['just because', /just because|no reason/],
  ];
  let occasion = null;
  for (const [name, re] of occasionStems) { if (re.test(lower)) { occasion = name; break; } }

  // Recipient: a proper name ("for Maya", "send Sam", "Maya's birthday"), else a
  // relationship ("my brother" -> "your brother"). Only a real name personalizes the card.
  const STOP = new Set(['It', 'The', 'This', 'That', 'Here', 'There', 'He', 'She', 'They', 'We', 'My', 'Your', 'His', 'Her', 'Their', 'A', 'An', 'I']);
  let recipient = null, recipientIsName = false;
  const direct = text.match(/\b(?:for|to)\s+([A-Z][a-z]+)/) || text.match(/\bsend\s+([A-Z][a-z]+)/);
  if (direct && !STOP.has(direct[1])) { recipient = direct[1]; recipientIsName = true; }
  if (!recipient) {
    const poss = [...text.matchAll(/\b([A-Z][a-z]+)['’]s\b/g)].map((x) => x[1]).filter((n) => !STOP.has(n));
    if (poss.length) { recipient = poss[0]; recipientIsName = true; }
  }
  if (!recipient) {
    const rel = lower.match(/\b(?:my|his|her|their|our)\s+(brother|sister|mom|mother|dad|father|wife|husband|partner|girlfriend|boyfriend|fianc[ée]+|friend|son|daughter|colleague|boss|mentor|grandma|grandmother|grandpa|grandfather)\b/);
    if (rel) recipient = 'your ' + rel[1];
  }

  const am = text.match(/\$\s?(\d+(?:\.\d{1,2})?)/) || text.match(/under\s+\$?(\d+)/i);
  const amount = am ? Number(am[1]) : null;

  const action = /\b(send|order|buy|get|surprise)\b/i.test(text);
  return { category, occasion, recipient, recipientIsName, amount, action };
}

module.exports = { runAgent, validateApiKey, TOOL, systemPrompt };
