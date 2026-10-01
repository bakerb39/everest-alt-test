# Assistant connector prototype

The authenticated MCP JSON endpoint is `POST /api/mcp`. The existing Netlify
wildcard route already sends it to the shared API function. No xAI or OpenAI
API key is required by this connector. For a local MCP test client, send the
Everest session token in `Authorization: Bearer ...`. Do not put tokens in chat
messages, source control, or URLs.

Tools: `get_budget`, `find_gifts`, `prepare_gift_order`,
`approve_gift_order`, `get_order_status`.

All options and orders are simulations. Preparing an order spends nothing.
The exact item, recipient, card and total are stored for review. Approval must
reference that order and its exact total; expired orders and over-budget orders
are rejected. Repeated approval does not charge twice in the standalone server.
Shipping and tax are zero in this simulation only. No payment or shipping takes
place. A tool argument asserting approval is not cryptographic evidence of user
consent: real purchases require a trusted user approval UI or receipt.

Run `node test/mcp.test.js`, `node test/smoke.js`, and
`node --test test/netlify-fn.test.js`.

## Remaining before connecting regular ChatGPT/Grok accounts

Implement OAuth account linking and discovery, scoped revocable connector
credentials, and verify the chosen assistant's supported authentication flow.
The current endpoint supports bearer-authenticated development clients; it is
not yet a one-click connector for the consumer apps.

The existing Netlify adapter saves the entire DB blob without a conditional
transaction. Concurrent instances can overwrite each other's budget/order
changes. Move orders and budget charging to a transactional datastore before
real spending or multi-user autonomous operation. The old `/api/chat` and
`/api/gifts` prototype routes retain their existing simulated behavior.

Companion Mode scheduling is not implemented here. It needs owner-only event
rules, explicit preauthorization, a recurring background worker, single-order
and monthly limits, and atomic event deduplication. Real commerce additionally
needs a vendor quote/checkout/fulfillment API and payment integration.

Build and deploy on a feature branch first; do not call this a live purchasing
integration or merge to the production branch until account linking is ready.
