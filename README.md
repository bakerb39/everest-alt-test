# Everest ALT — backend

The gifting rail for AI companions. This is the real, working backend behind the
"connect your Grok" flow: accounts, a hard budget ledger, and the single tool —
**`send_gift`** — that an AI companion is allowed to call to send a real physical
gift, always within a budget the user sets. **The AI only ever sees a budget
number. It never sees or handles payment details.**

Zero external dependencies — it runs on the Node.js standard library alone.

---

## Run it

```bash
node server.js
```

- **http://127.0.0.1:8787/** — the real app: create an account, set a monthly
  budget, connect Grok (your xAI key, or demo mode), add the people you love,
  chat, and see a live gift history. Sessions persist (token in the browser).
- **http://127.0.0.1:8787/demo** — an instant, no-signup demo that auto-creates
  an account so you can watch the flow in one click.

Type something like *"It's Maya's birthday — send her some flowers, under $100"*
and watch Grok call `send_gift`, the gift get created, and the budget drop.

Run the full self-test:

```bash
node test/smoke.js
```

(24 checks: signup/login/auth, budget cap, Grok connect, chat → tool call →
ledger charge, idempotency, and hard-cap rejection.)

> No system Node? A portable `node.exe` works too — just call it by full path.

---

## Deploy it (make it public)

**Netlify (recommended — full guide in [`DEPLOY-NETLIFY.md`](DEPLOY-NETLIFY.md)).**
The UI is served statically from `public/` and the API runs as a serverless
function backed by Netlify Blobs (durable storage, no database account). A git
repo is already initialized here — push it to GitHub and *Import project* on
Netlify, or run `netlify deploy --build --prod` with the CLI. Note: a plain
drag-and-drop zip will **not** work, because Netlify only installs the function's
dependency on a Git or CLI deploy.

Other hosts that run a normal Node server:

**Render (one click)** — push this folder to a Git repo, then in Render pick
*New → Blueprint* and point it at the repo. It reads `render.yaml`: builds,
starts `node server.js`, health-checks `/api/health`, and mounts a 1 GB disk at
`/var/data` so accounts, gifts, and the auto-generated secret persist. Add your
`XAI_API_KEY` in the dashboard to run real Grok for everyone, or leave it blank
and let each user connect their own key in the app.

**Docker (anywhere)**

```bash
docker build -t everest-alt .
docker run -p 8787:8787 -v everest_data:/data everest-alt
```

The image binds `0.0.0.0`, reads `PORT`, and stores `data.json` + `.secret` on
the `/data` volume. A `Procfile` is included for Heroku/Railway-style hosts too.

Once it's live, point the marketing site's **Connect Grok** button at the
deployed URL and you have a complete signup → budget → Grok → gift funnel.

---

## How it works

```
 user ──login──► Everest ALT account
        └─set budget ($/month, hard cap)
        └─connect Grok  (paste xAI key  ▸ real Grok
                          or leave blank ▸ deterministic mock for demos)

 user ──chat──► /api/chat ──► Grok agent loop (xAI, OpenAI-compatible)
                                │  one tool exposed: send_gift
                                ▼
                        lib/gifts.sendGift()
                          • resolve recipient + pick a real product
                          • enforce budget (charge throws if over cap)
                          • log gift, 1-hour cancel window
                          • return card-free confirmation only
```

The system prompt tells Grok the remaining budget and the rules; `tool_choice:
auto` lets it decide when to send. Every charge is enforced server-side in
`lib/budget.js`, so the agent physically cannot spend past the cap.

## Files

| File | What it does |
|------|--------------|
| `server.js` | Zero-dep HTTP server + JSON API + static demo UI |
| `config.js` | Env/config with safe local defaults (+ tiny `.env` loader) |
| `lib/security.js` | scrypt password hashing, signed session tokens, AES-256-GCM key encryption |
| `lib/store.js` | Atomic JSON datastore (swap for Postgres later) |
| `lib/budget.js` | Monthly-cycle budget ledger + hard-cap enforcement |
| `lib/gifts.js` | `send_gift` — recipient → product → charge → logged gift |
| `lib/grok.js` | xAI agent loop (real) + deterministic mock; the `send_gift` tool schema |
| `lib/catalog.js` | 50-product catalog (generated from the store page) |
| `public/grok-chat.html` | The live demo chat UI |
| `test/smoke.js` | End-to-end self-test |

## API

| Method & path | Purpose |
|---|---|
| `POST /api/signup` · `POST /api/login` | Accounts → session token |
| `GET  /api/me` | Current account + budget |
| `POST /api/budget` | Set monthly cap (`{ monthlyCap }`) |
| `POST /api/connect/grok` | Connect Grok — `{ apiKey }` for real, `{}` for mock |
| `POST /api/chat` | `{ message }` → Grok runs, may call `send_gift` |
| `GET  /api/gifts` · `POST /api/gifts` | History · direct `send_gift` (honors `Idempotency-Key`) |
| `GET/POST /api/recipients` | Saved recipients |

All authed routes take `Authorization: Bearer <token>`.

## Connecting a real Grok

Either set a global key in `.env` (`XAI_API_KEY=...`) or let each user connect
their own via `POST /api/connect/grok { "apiKey": "xai-..." }` — it's encrypted
at rest with AES-256-GCM. With no key, the deterministic mock stands in so the
whole flow is demonstrable offline.

## Production notes

- **Secret management is automatic.** If you don't supply `SERVER_SECRET`, the
  server generates a strong random one on first start and persists it to a
  gitignored `.secret` file, so the insecure default is never used and sessions
  stay valid across restarts. Supplying `SERVER_SECRET` (env or `.env`) still
  overrides it — do that when you run multiple instances so they share one secret.
- **The datastore is crash-safe.** Writes are synchronous (serialized within the
  process) and durable — payload is `fsync`'d to a temp file then atomically
  renamed over the live `data.json`, so a crash can't corrupt it. Good through
  launch scale on one node; swap `lib/store.js` for a Postgres-backed module to
  scale out (its exported functions are the only persistence touch-points).
- Fulfillment "makers" are a labeled placeholder for the local-maker network and
  get wired in at fulfillment time; each gift's maker is now assigned
  deterministically. The 50-item catalog mirrors the store page.
