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

## Task attachments

Files are stored in the private `task-attachments` Storage bucket; metadata lives in
`task_attachments` (migration `20261022174902_task_attachments.sql`).

- Limits: 10 MB per file; PNG, JPEG, GIF, WebP, PDF, Word, Excel, TXT and CSV only (no SVG/HTML).
  Enforced by the bucket and again by table constraints; the browser pre-checks them too.
- Paths are `{project_id}/{task_id}/{attachment_id}`. The original filename is metadata only.
- Access follows the project (owner only for now). Storage policies cover only this bucket and check
  the real task and project, not the path text. A metadata row can only be inserted for an object that
  exists with the same size.
- Downloads use signed URLs that expire after 60 seconds.
- Storage objects are not removed by database cascades, and `storage.objects` is never deleted from SQL.
  Deleting an attachment, task or project queues the file in `attachment_cleanup_queue` (trigger); the app
  then removes it through the Storage API and clears the entry. Entries left by an interrupted cleanup are
  retried when a board is opened or the next deletion happens.
- If saving metadata fails after an upload, the new file is removed through the Storage API right away.

## Structure

- `src/` – application code (`pages/`, `components/`, `services/`, `utils/`)
- `supabase/migrations/` – SQL migrations
- `scripts/` – helper scripts

See [.github/copilot-instructions.md](.github/copilot-instructions.md) for architecture rules.

## Project membership

Migration `20261022180734_project_members.sql` adds `project_members (project_id, user_id, created_at)` with a composite primary key.

| Action | Owner | Member | Outsider |
| --- | --- | --- | --- |
| View project, stages, tasks, attachments | yes | yes | no |
| Create / edit / delete / move tasks, manage attachments | yes | yes | no |
| Edit or delete the project, change stages | yes | no | no |
| Add or remove members | yes | no | no |
| Change ownership | no (no grant) | no | no |

- RLS on `projects`, `project_stages`, `tasks`, `task_attachments`, `project_members` and the `task-attachments` Storage policies all use the helpers `is_project_owner`, `is_project_member` and `can_access_project`.
- The helpers are `SECURITY DEFINER` with `search_path = ''`, schema-qualified objects, only read `auth.uid()`, and are executable by `authenticated` only. Because they read the base tables directly, policies never recurse.
- `lock_project_for_task_changes` lets members take the project-row lock that serializes task ordering.
- Not every authenticated user is a member: access exists only through a row in `project_members`.
- Owners manage members on `/projects/:id/users` (table, Add user popup with search, Remove confirmation). The Projects list shows an Owned / Member badge and hides owner-only actions for members; the database enforces the same rules regardless of the UI.
- Migration `20261022181001_project_member_directory.sql` adds two owner-only, `SECURITY DEFINER` RPCs (fixed `search_path`, `authenticated` only):
  - `search_users_for_project(project_id, query, limit)` – min. 2 characters, `%`/`_` escaped, max 20 rows, excludes the caller and existing members; returns only `user_id` and a `label` (`Name (email)` or the email). Searching covers all registered users, whether or not they own projects.
  - `list_project_members(project_id)` – owner first, then members.
  Both answer `P0002` ("not found") to members, outsiders and for unknown projects. `auth.users` is never exposed, and no tokens, hashes or raw metadata are returned. Note that owners can see the email of users they search for.
- The owner can never be a membership row (trigger + RLS) and ownership has no UPDATE grant, so it cannot be removed or demoted through membership actions.


## Realtime board synchronization

Open boards update when someone else changes a task. Migrations `20261022181351_realtime_board_notifications.sql` and `20261022181713_fix_board_notify_setting_key.sql`:

- **Private Broadcast channel** `project:<project id>:board`. An RLS policy on `realtime.messages` (`SELECT` only) lets the owner and current members join (`can_receive_board_topic` → `can_access_project`). There is no `INSERT` policy, so browsers cannot publish; anonymous users and outsiders cannot join.
- **Database notifications**: triggers on `tasks` (insert / update / delete, which also covers `move_task`) send `project_changed`; triggers on `project_members` send `access_changed`. Triggers are `SECURITY DEFINER` with a fixed `search_path` and no client grants. At most one message per project and event is sent per transaction.
- **Payload**: only the project id (Realtime adds a message id). No titles, descriptions, user ids or attachment data.
- **Client** (`src/services/board-realtime.js`, `src/pages/tasks/tasks.js`):
  - subscribes only while the board page is mounted and removes the channel on navigation, sign-out and user change;
  - debounces notifications (300 ms) and reloads authoritative data through the normal RLS queries (no page refresh);
  - after every (re)join it reloads once, so a dropped connection never leaves a stale board; a "Live updates paused" note is shown while offline;
  - a reload never runs under an open task dialog, during a drag, or while a move is saving; it is queued and flushed afterwards, so unsaved editor fields and local drag-and-drop saves are never overwritten;
  - answers from older requests or another project are discarded.
- Stage structure changes by the owner do not send notifications (only task and membership changes do); the next reload picks them up.

### Revoking membership while a channel is connected

Realtime evaluates channel policies when a client joins and when its JWT is refreshed, **not for every message**. Verified against the live project:

| Situation | Result |
| --- | --- |
| Member removed while connected | The old channel keeps delivering bare `project_changed` pings (no data) |
| Removed member reads tasks / calls RPCs / uses Storage | Denied immediately (RLS) |
| Removed member re-joins or reconnects | Denied |
| Removed member's JWT is refreshed (about hourly) | Old channel stops receiving |

So revocation of *database and Storage* access is immediate, while the *notification channel* can linger until the next token refresh or reconnect. This is why pings carry no data. The board page also treats a denied reload as "access lost": it closes the channel and any open dialog and shows "Project not found". Removing a member sends `access_changed`, so a still-connected removed user finds out right away.
