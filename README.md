# Taskboard

A Trello-style application where users manage projects, stages and tasks.
Built with vanilla JavaScript ES modules, Vite, Bootstrap and Supabase.

## Setup

```powershell
npm install
Copy-Item .env.example .env   # then fill in your Supabase values
npm run dev
```

## Scripts

- `npm run dev` – start the dev server
- `npm run build` – production build to `dist/`
- `npm run preview` – preview the production build

## Authentication

Email and password auth uses Supabase Auth through `src/services/auth-service.js`.
Private routes (`/dashboard` and everything under `/projects`) require a session.

**Classroom setting (manual): disable email confirmation.** This cannot be changed from the
code or the MCP tools, so do it once in the Supabase dashboard for the classroom project:

1. Open the project, then **Authentication**.
2. Go to **Sign In / Providers** and open the **Email** provider.
3. Turn **off** *Confirm email* and click **Save**.
4. Verify with the project's public settings: `mailer_autoconfirm` must be `true`
   (`GET https://<project-ref>.supabase.co/auth/v1/settings` with the `apikey` header).

While confirmation is still enabled, registering shows a "Check your email" notice and no
session is created until the link is opened.

## Classroom seed data

`scripts/seed-classroom.js` is a server-side script that creates three demo Auth users
(steve, maria, peter @gmail.com) through the Supabase Auth Admin API, plus four fictional
projects, each with three default stages and twelve tasks. It never runs in the browser.

1. Copy `.env.seed.example` to `.env.seed` (git-ignored) and paste the project's
   service role / secret key into `SEED_SERVICE_ROLE_KEY`. Never use a `VITE_` prefix.
2. Preview without writing anything: `npm run seed:dry`
3. Seed: `npm run seed`

The script refuses to run unless the URL's project reference equals `SEED_PROJECT_REF`.
Records have deterministic IDs, so reruns skip anything that already exists. Existing users
keep their passwords, and no unrelated records are modified. Users are created as already
confirmed, so no emails are sent.

## Deploying to Netlify

`netlify.toml` sets the build (`npm run build`, publish `dist`) and rewrites every path to
`index.html` so deep links such as `/projects` work with the History API router.

Vite inlines `VITE_*` values at **build time**, and `.env` is git-ignored, so set them in
Netlify under *Site configuration → Environment variables* (then trigger a new deploy):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Only the public URL and publishable key belong here. Never add the service role key to Netlify
for this site. Afterwards, in Supabase *Authentication → URL Configuration*, set the Site URL to
your Netlify URL and add it to the redirect URLs.

## Structure

- `src/` – application code (`pages/`, `components/`, `services/`, `utils/`)
- `supabase/migrations/` – SQL migrations
- `scripts/` – helper scripts

See [.github/copilot-instructions.md](.github/copilot-instructions.md) for architecture rules.
