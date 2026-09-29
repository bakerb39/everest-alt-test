# Deploy Everest ALT to Netlify

This backend is built for Netlify: the UI is served as **static files** from
`public/`, and the API runs as a **serverless function** (`netlify/functions/api.js`)
backed by **Netlify Blobs** for durable storage — no database account needed.

> **Why the plain zip drop failed:** the API function has one dependency
> (`@netlify/blobs`). Netlify installs and bundles function dependencies during
> a **Git deploy** or a **CLI build deploy** — but *not* for a drag-and-drop of a
> zip. So use one of the two methods below. Both are quick.

---

## Option A — GitHub (recommended, ~3 minutes)

A git repo is already initialized in this folder with a first commit. You just
need to put it on GitHub and connect Netlify.

1. Create an empty repo on GitHub (e.g. `everest-alt-backend`). Don't add a
   README/license — the folder already has commits.
2. In this folder, add the remote and push (replace the URL):

   ```bash
   git remote add origin https://github.com/YOURNAME/everest-alt-backend.git
   git branch -M main
   git push -u origin main
   ```

3. On Netlify: **Add new site → Import an existing project → GitHub →** pick the
   repo. Netlify reads `netlify.toml` automatically:
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
   - Build command runs `npm install` (installs `@netlify/blobs`)
4. Click **Deploy**. When it finishes you get a URL like
   `https://everest-alt-backend.netlify.app` — that's the live app.

Every future `git push` redeploys automatically.

## Option B — Netlify CLI (no GitHub)

```bash
npm install -g netlify-cli
netlify login
netlify deploy --build --prod
```

Run that from this folder. `--build` makes Netlify install the function
dependency and bundle it, then deploys straight to your account.

---

## After it's live

- **Run real Grok for everyone (optional):** in Netlify → Site settings →
  Environment variables, add `XAI_API_KEY = xai-…`. Otherwise each user connects
  their own key in the app, or uses demo mode.
- **Pin the signing secret (recommended for multiple regions):** add
  `SERVER_SECRET` = a long random string. Without it the server generates one
  and stores it in Blobs, which is fine for a single-region site.
- **Point the marketing site at it:** change the marketing site's *Connect Grok*
  button to link to this new URL (e.g. `https://everest-alt-backend.netlify.app`).

## Verify the deploy

- `https://YOUR-SITE.netlify.app/` → the app (sign up / log in)
- `https://YOUR-SITE.netlify.app/demo` → the instant no-signup demo
- `https://YOUR-SITE.netlify.app/api/health` → `{"ok":true,...}`

## Local development against the same setup

```bash
npm install -g netlify-cli
netlify dev
```

`netlify dev` serves the static files and runs the function with a local Blobs
sandbox, exactly like production. (Plain `node server.js` also still works and
uses a local JSON file instead of Blobs.)
