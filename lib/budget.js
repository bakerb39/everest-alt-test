'use strict';
const config = require('../config');
const store = require('./store');

const CYCLE_MS = config.BUDGET_CYCLE_DAYS * 24 * 60 * 60 * 1000;

/**
 * The budget is the single source of truth the agent is measured against.
 * The AI can read `remaining` but can never change the cap or spend past it.
 */
function ensureCycle(user) {
  const now = Date.now();
  if (!user.budget) {
    user.budget = { monthlyCap: 0, spent: 0, cycleStart: now };
  }
  // Roll the cycle forward if it has elapsed.
  while (now - user.budget.cycleStart >= CYCLE_MS) {
    user.budget.cycleStart += CYCLE_MS;
    user.budget.spent = 0;
  }
  return user.budget;
}

function summary(user) {
  const b = ensureCycle(user);
  return {
    monthlyCap: b.monthlyCap,
    spent: round(b.spent),
    remaining: round(Math.max(0, b.monthlyCap - b.spent)),
    resetsOn: new Date(b.cycleStart + CYCLE_MS).toISOString(),
  };
}

function setCap(user, monthlyCap) {
  const cap = Number(monthlyCap);
  if (!Number.isFinite(cap) || cap < 0 || cap > 100000) {
    throw httpError(400, 'monthlyCap must be a number between 0 and 100000');
  }
  ensureCycle(user);
  user.budget.monthlyCap = cap;
  store.putUser(user);
  return summary(user);
}

function remaining(user) {
  const b = ensureCycle(user);
  return Math.max(0, b.monthlyCap - b.spent);
}

// Charge the budget. Throws if it would exceed the cap. Caller must persist.
function charge(user, amount) {
  const b = ensureCycle(user);
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw httpError(400, 'amount must be positive');
  if (b.spent + amt > b.monthlyCap + 1e-9) {
    throw httpError(402, `over budget: $${round(amt)} requested, $${round(b.monthlyCap - b.spent)} remaining`);
  }
  b.spent = round(b.spent + amt);
  return b.spent;
}

function round(n) { return Math.round(Number(n) * 100) / 100; }
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

module.exports = { ensureCycle, summary, setCap, remaining, charge, httpError };
