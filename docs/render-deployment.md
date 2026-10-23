# Render deployment and safe cutover

## Inspected architecture and selected service

This repository is a Vite SPA using HTML, CSS, vanilla JavaScript and Bootstrap. There is no Vite configuration overriding root, base path, output directory or entry points: build from the repository root and publish `dist`. `index.html` is the only application entry; HTML under `src` is component/page fragments bundled by Vite. `package-lock.json` exists. There is no Node application server, Netlify Function, `_redirects`, or `_headers` file. `netlify.toml` supplies only the build and SPA rewrite.

`render.yaml` uses `type: web`, `runtime: static`, `rootDir: .`, branch `initial-setup`, build `npm ci && npm run build`, publish `./dist`. It intentionally omits `repo`: a Blueprint uses its own connected repository. `SKIP_INSTALL_DEPS=true` avoids Render's automatic install before our explicit `npm ci`. Node 24 is selected for the build; Vite remains a dev dependency, so do not set `NPM_CONFIG_PRODUCTION=true` or omit dev dependencies. Existing npm scripts are unchanged.

The rewrite serves `/index.html` without changing the requested browser path, query or fragment. It covers landing/login/dashboard, all project and admin routes, and activity/deadlines/labels. Render gives existing files precedence, preserving built JS/CSS/fonts and any future real HTML entries. Missing asset paths can still hit the SPA fallback: verify all HTML-referenced assets exist and deploy the entire `dist`, rather than masking MIME errors with client changes.

References checked for this migration: [Blueprint syntax](https://render.com/docs/blueprint-spec), [rewrite precedence](https://render.com/docs/redirects-rewrites), [Static Sites](https://render.com/docs/static-sites), [Node versions](https://render.com/docs/node-version).

## Environment inventory

| Variable | Where it belongs | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Render Static Site Environment; local `.env` | Existing project's public API URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Render Static Site Environment; local `.env` | Existing project's publishable/public key |
| `NODE_VERSION` | Blueprint build environment | Node 24 |
| `SKIP_INSTALL_DEPS` | Blueprint build environment | Explicit lockfile installation |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Existing Supabase Edge Function runtime only | Supplied by Supabase to `admin-users` |
| `ALLOWED_ORIGINS` | Supabase Edge Function secrets only | Exact comma-separated app origins allowed by `admin-users` |
| `SEED_SUPABASE_URL`, `SEED_SERVICE_ROLE_KEY`, `SEED_PROJECT_REF` | Local administrative/seed environment only | Privileged scripts; never Render frontend configuration |
| `LOADTEST_OWNER_EMAIL`, `NODE_ENV` | Local load-test tooling | Load-test owner and production guard |
| `BOARD_APP_URL`, `BOARD_CDP_URL`, `BOARD_CHECK_SIDEBAR` | Local browser test process only | Test runner configuration |
| `DEADLINES_MIGRATION`, `CHECKLIST_MIGRATION`, `ACTIVITY_MIGRATION` | Local tests only | Optional migration fixture selection |

Only the first two variables are read by frontend source. Vite embeds them at build time. Keep `.env` ignored; `.env.example` has empty values. Never copy all local or Supabase secrets into Render. No database password, service-role key or `sb_secret_` key may have a `VITE_` prefix. Changing Render frontend values requires deploying a new build, not merely retrying a cached artifact.

## Dashboard steps before cutover

1. Keep the Netlify site, current DNS records, environment values and last known-good deploy available. Save current Supabase URL Configuration and the current `ALLOWED_ORIGINS` value for rollback. No Netlify URL or custom domain is hard-coded in application source; this repository does not establish which production domain is currently in use.
2. Ensure this migration is committed and pushed to `Ayrola/TaskBoardSystem`, branch `initial-setup`. In Render choose **New → Blueprint**, connect that GitHub repository, select `initial-setup`, and apply root `render.yaml`. Alternatively use **New → Static Site**, that repository/branch, blank Root Directory (repository root), build `npm ci && npm run build`, publish `dist`, and manually copy the Blueprint environment and rewrite rules. Do not create a Web Service running Express.
3. At Blueprint creation enter the existing project's `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` when prompted. For manual creation use **Environment**. Deploy and copy the actual generated HTTPS URL from Render. Below, `RENDER_ORIGIN` means that exact scheme and hostname without a trailing slash; it is a notation, not a literal value to paste.
4. In the **same existing Supabase project → Authentication → URL Configuration → Redirect URLs**, add the actual `RENDER_ORIGIN/login`. Keep the existing Netlify callback entries during verification. Preserve `http://localhost:5173/login` and add `http://127.0.0.1:5173/login` if using that development host. Add exact callbacks for any other localhost port actually used (for example Vite preview 4173); avoid broad production wildcard rules. Keep Site URL unchanged until cutover.
5. In **Supabase → Edge Functions → Secrets**, edit `ALLOWED_ORIGINS`: preserve all current required origins and append the exact Render origin. Include `http://localhost:5173` and `http://127.0.0.1:5173` only if those local hosts are used. Origins have no path; do not use `/login` here or replace the list with `*`. Keep `SUPABASE_SERVICE_ROLE_KEY` in Supabase. Verify the existing deployed `admin-users` function picks up the updated environment; redeploy that existing function if necessary through the existing Supabase deployment process. No function code migration or RLS change is needed.
6. Complete the live checklist below at the generated Render URL before moving traffic.

### Auth and integrations

Registration uses `emailRedirectTo: location.origin + '/login'`. Login is email/password; password-reset and OAuth UI flows are not implemented. Do not enable new providers or alter email-confirmation policy for this migration. With confirmation enabled, register a disposable test user and follow a fresh confirmation email to Render; confirm any custom Supabase email templates honor `RedirectTo` rather than always forcing the old Site URL. Supabase's client restores sessions and detects Auth tokens in the URL with its existing defaults. The SPA fallback must preserve `/login` and its query/hash; do not add a redirect stripping them. `returnTo` remains validated by the existing router.

No provider callback needs moving because the Supabase project has not changed. If external OAuth settings exist outside this repository, audit them separately before enabling those flows. Auth storage is origin-scoped: users moving from a Netlify hostname to a Render hostname must log in again. A shared unchanged custom domain keeps its browser storage origin.

Attachments use the same private `task-attachments` bucket and short-lived Supabase signed download links; project links are relative. Realtime uses the same Supabase private project channels. Neither requires a Render proxy, new database or weakened policies. `admin-users` calls continue going directly to the Supabase function and require its explicit CORS allowlist above.

## Live verification before switching traffic

Use an ordinary user, a project participant and an existing administrator. Use disposable records for write tests.

- Open `/`, `/login` and a built `/assets/...js` URL. In Network confirm JS/CSS/font success and MIME types; no JS response should start with HTML. Check no privileged values are present in downloaded source.
- Log in, refresh and verify session restoration; log out. Test registration and confirmation if enabled. Confirm `/login?returnTo=%2Fprojects` retains its query and goes to Projects after login. Test an actual newly issued email callback, including its fragment/query, without sharing its tokens.
- Paste a known accessible `/projects/<id>/tasks` URL into a new tab and refresh it. Repeat `/projects/<id>/edit`, `/projects/<id>/users`, `/dashboard`, `/activity`, `/deadlines`, `/labels`, `/admin` and existing admin subroutes. Verify Back and Forward and expected permission denials.
- Create, rename and delete a disposable project/task; move/reorder tasks and reload to verify persistence. Confirm sidebar updates and filters/task dialogs still work.
- Upload, download and remove a disposable attachment. Check signed downloads and original filenames.
- Open the board in two authenticated tabs and confirm Realtime updates and membership revocation behavior. Test admin user listing to verify `admin-users` CORS; verify a regular user cannot administer users.
- Confirm the same Supabase project/data is in use and that no migration or permission change has occurred.

Local build/preview or mocked browser tests cannot prove Render CDN rewrites, real email delivery, live Storage, Realtime or admin function CORS. Mark these complete only after testing the deployed URL.

## Cutover, custom domain and rollback

After the generated URL passes verification, set **Supabase → Authentication → URL Configuration → Site URL** to the intended canonical public origin: the actual Render origin, or the custom domain if keeping one. Keep exact `/login` redirect entries for both old and new origins during the rollback window. If a custom domain is used, add its HTTPS origin to `ALLOWED_ORIGINS` and its `/login` callback to Auth before moving it.

In **Render Static Site → Settings → Custom Domains**, add the actual domain and copy Render's displayed DNS instructions. Update only that domain's records at your DNS provider: a subdomain uses a CNAME to the service's actual `onrender.com` hostname; the apex uses ALIAS/ANAME/flattening to that hostname when supported, otherwise use the A-record value Render currently displays (the current [official DNS guide](https://render.com/docs/configure-other-dns) lists `216.24.57.1`; the service dashboard is the source of truth at cutover). Follow Render's instructions for conflicting A/AAAA records, preserve unrelated mail/TXT records, and verify DNS and TLS in Render. No custom domain or DNS target is invented or configured by this repository.

Keep Netlify serving the old deployment until DNS propagation, Auth callbacks and all key features are verified. Only then detach/retire Netlify. `netlify.toml` is intentionally still needed for overlap and rollback; remove it in a later change after retirement, when the Render rewrite fully replaces it. There are no Netlify Functions or header behaviors to discard.

For rollback: restore the saved DNS records and Supabase Site URL; retain the old callback and CORS entries, or restore the saved lists without removing any still-needed origin. Redeploy the last known-good Netlify revision if needed. No database restore is required: both frontends use the same unchanged Supabase backend. If rolling back a Render-only release, redeploy the known-good Render revision and its matching build-time values. Dashboard/GitHub permissions are required for deployment, Supabase configuration, domain changes and retirement; none are performed automatically by the repo configuration.

Supabase URL settings reference: [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Checks performed for this repository change

- `npm run build` passed and produced 51 files in `dist`.
- `render.yaml` parsed with Ruby's YAML parser; Static Site type, output path and required public-key variable were checked. This is local syntax/structure validation, not validation by Render's API.
- All HTML-referenced entry assets existed; built text files were scanned for secret-key values and service-role JWT payloads, with none detected. A bare `sb_secret_` string in the Supabase SDK is a key-type check, not a credential.
- Production `vite preview` served 16 landing/login/private/admin/tool paths without redirects, retained the tested query parameters, and served the three entry assets with non-HTML MIME types.
- `npm run test:board` passed. `BOARD_APP_URL=http://127.0.0.1:4173 npm run test:board:browser` passed against the production build using synthetic Supabase responses, including task CRUD, drag/move persistence after reload, desktop/mobile layout, filter/dialog handling, simulated Realtime, permissions and access loss.
- `git diff --check` passed.

No Render service was created, no DNS was changed, and no live Supabase settings or data were modified. Live registration/confirmation, session restoration on the new origin, attachment operations, real Realtime, administrator function CORS, and Render-hosted direct routes remain dashboard/deployed-site checks.
