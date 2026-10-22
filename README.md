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

## Task comments

Migration `20261022210000_task_comments.sql` adds `task_comments` (`id, task_id, author_id, body, created_at, updated_at`, plus `project_id`, derived from the parent task) and the discussion section in the task details dialog.

- **Access** is decided live through the parent task's project (`can_access_project`), never from stored data: owners, members and admins can read and add. Authors edit or delete their own comments only while they still have access. Owners and admins can **delete** any comment (moderation) but cannot edit someone else's words. A removed member immediately loses read/add/edit/delete; their old comments stay.
- **Integrity:** the browser can only send `task_id` + `body` (column grants); a trigger sets `author_id` to `auth.uid()` (a different value is rejected), derives `project_id` from the task (invisible task = not found), trims the body and maintains `updated_at`. Composite FK `(task_id, project_id)` cascades with the task. Body: 1–2000 characters. If an author's account is deleted the comments remain, shown as "Deleted user".
- **Plain text:** bodies are rendered with `textContent` and CSS `pre-wrap`; markup is shown literally.
- **Author labels** come from `list_task_comments` (SECURITY DEFINER): profile name, else the part of the email before `@`, else a short id. The browser never reads `auth.users`, and full emails are not shown to other participants.
- **Pagination:** newest first, 20 per page, keyset cursor `(created_at, id)` served by index `task_comments_task_created_idx`; the dialog shows total, "Load older comments", an empty state, and an inline confirmation before deleting.
- Comments do not use Realtime; the list refreshes after your own changes and when the dialog is reopened.

## Pagination and large boards

Migration `20261022200000_pagination_large_boards.sql` (apply with `supabase db push`) adds the indexes and RPCs below.

**Why a short visible list does not mean few records.** The browser only ever holds one page of projects and one page of each column. A column showing 50 cards may hold 5,000 tasks; the rest are simply not downloaded yet. Every number shown (project totals, stage badges, dashboard figures) is computed by the database (`COUNT`) and includes unloaded rows; "Showing X of Y", "Load more" and "End of list" say whether more exist.

**Projects.** `list_projects_page(limit, offset)` returns `{ total, rows }` ordered by `created_at desc, id` (deterministic), max 50 per page; the UI uses 20 and pages via `?page=N` with clamping when the last page empties. Per-project stage/open/done counts come from SQL, not from loaded rows.

**Board columns.** Each column is read independently with keyset pagination on `(position, id)` (`id` breaks ties), 50 rows per request, fetching one extra row to know exactly whether more exist. Next pages load on scroll-near-bottom or the button, with loading, error/retry and end-of-list indicators; ids already shown are never appended twice.

**Moves.** Dragging uses the authoritative `move_task_relative` RPC. The browser sends only "after task X" (or top / end of stage), never a position computed from the loaded subset; the server locks the project and renumbers the *whole* source and destination columns. Placement for partly loaded columns: dropping below the last loaded card puts the task directly after it, ahead of unloaded tasks; the move dialog also offers "End of the stage" (after all tasks, loaded or not). If the anchor no longer exists the server refuses (`40001`) and the board reloads.

**Invalidation.** A reorder invalidates every cursor of the affected columns. The page keeps an epoch counter, bumped on every reload, move and Realtime notification; a page response that finishes under an older epoch is discarded. After a move or notification the board reloads every column from the top to the depth already shown in one request per column (up to 500 rows), so a snapshot is never glued together from old and new pages. Loading more is blocked during drags, saves and open dialogs.

### Load-test seed (development only)

`npm run seed:loadtest:dry` prints the plan without touching the database: 125 projects (one large board with Backlog 260, In Progress 17, Review 3, Blocked 0, Done 120 tasks, plus 124 projects with 0–30 tasks each). `npm run seed:loadtest` creates it for an existing user (`LOADTEST_OWNER_EMAIL` in `.env.seed`; same `SEED_*` safeguards as the classroom seed, refuses `NODE_ENV=production`, requires `--confirm-dev`). Fixtures use deterministic ids and the `[LOADTEST]` title prefix; `npm run seed:loadtest:cleanup` deletes only those (owned by that user); stages and tasks cascade. Existing demo projects are never touched.

### Revoking membership while a channel is connected

Realtime evaluates channel policies when a client joins and when its JWT is refreshed, **not for every message**. Verified against the live project:

| Situation | Result |
| --- | --- |
| Member removed while connected | The old channel keeps delivering bare `project_changed` pings (no data) |
| Removed member reads tasks / calls RPCs / uses Storage | Denied immediately (RLS) |
| Removed member re-joins or reconnects | Denied |
| Removed member's JWT is refreshed (about hourly) | Old channel stops receiving |

So revocation of *database and Storage* access is immediate, while the *notification channel* can linger until the next token refresh or reconnect. This is why pings carry no data. The board page also treats a denied reload as "access lost": it closes the channel and any open dialog and shows "Project not found". Removing a member sends `access_changed`, so a still-connected removed user finds out right away.

## Application roles

Migrations `20261022182316_app_roles.sql` and `20261022182334_admin_authorization.sql`.

- `app_role` enum (`user`, `admin`) and `user_roles` (one row per user, default `user`).
- **New users** get `user` from a trigger on `auth.users` that uses a constant and never reads signup metadata. Existing users were backfilled with `ON CONFLICT DO NOTHING`, so an existing admin row is never overwritten.
- `is_admin()` is `SECURITY DEFINER` with a fixed `search_path`, granted to `authenticated` only. It reads `user_roles` directly, so RLS policies that call it cannot recurse.
- **Role table access**: users read only their own row; only admins can insert or update roles. Nobody has a delete grant, and a trigger stops a signed-in admin from removing or demoting the last admin.
- **Admins** can see and manage all projects, stages, tasks, attachments (including Storage), members, and use the task RPCs, because `can_access_project` and the new `can_manage_project` include `is_admin()`. Owners and members behave as before. Admins cannot change project ownership or create projects for others. The dashboard counts all projects for an admin, and `is_owner` stays strictly "I own it" (the project list also returns `can_manage`).
- There is **no public "become admin" operation** and no role UI. Editing user metadata has no effect.

### Bootstrapping the first admin

Run it manually with the service-role key in `.env.seed` (never in a `VITE_` variable, never committed), naming one explicit user UUID:

```
npm run bootstrap-admin -- <user-uuid>
npm run bootstrap-admin -- <user-uuid> --demote
```

The script refuses to run without exactly one UUID and checks the target project ref. Demotion or revocation takes effect for database and Storage access at once; an already-connected realtime channel can linger until its token refreshes (see above).

## Admin console

Admins get an **Admin** nav item and pages under `/admin` (projects, stages, tasks: list, details, edit, confirmed delete, with pagination).

- The route guard only hides pages; authorization is enforced by the database (`is_admin()` in RLS and RPCs, `admin_list_projects` is admin-only).
- Stages are reordered and deleted only through the `move_stage` / `delete_stage` RPCs (direct stage DELETE and position writes are revoked). Deleting a stage that has tasks requires a different destination stage in the same project; the last stage cannot be deleted.
- Changing a stage's `is_done` updates `tasks.done` via triggers.
- Project/task deletion drains the attachment cleanup queue through the Storage API.
- User administration (below) goes through an Edge Function; the browser never holds a privileged key.

### Admin users (Edge Function `admin-users`)

Pages: `/admin/users`, `/admin/users/:id`, `/admin/users/:id/edit` (list with pagination, view, edit, delete). Server code: `supabase/functions/admin-users/index.ts`, migration `20261022190000_admin_user_deletion.sql`.

**Server checks on every call:** the bearer token is validated with `auth.getUser(jwt)`, then the caller's *current* role is read from `public.user_roles`; nothing role-related is read from the request. The service-role key exists only in the function's environment. Responses contain only `id, email, display_name, role, email_confirmed, banned, created_at, last_sign_in_at` (no tokens, hashes, identities, or raw metadata). Listing is paginated (max 50 per page). CORS allows only origins in the `ALLOWED_ORIGINS` secret.

**Allowed edits:** `display_name` (stored as `user_metadata.full_name`, merged with existing metadata) and `email`. Any other field (role, password, ban, id, metadata) is rejected.

**Email change:** applied immediately through the Auth Admin API and marked verified (the admin vouches for it). No confirmation email is sent to either address, existing sessions stay valid, and the user must use the new address from their next sign-in. A duplicate address returns a 409 error.

**Deleting a user:** the UI first shows live counts (owned projects, stages, tasks, attachments and size, other members, memberships and uploads in other users' projects) and requires typing the account's email (or id). The server re-checks the confirmation text and that the counts still match what was reviewed. Self-deletion and removing the last admin are refused. Ownership is never transferred; owned projects are deleted. The sequence is retryable, and the Auth user is removed last:
1. Ban the account (no sign-in or refresh during cleanup).
2. One DB transaction (`admin_delete_user_data`): delete owned projects (cascading to stages, tasks, attachment rows, members), the user's memberships and uploads; queue every affected Storage path.
3. Remove queued objects through the Storage API in batches and clear the queue rows.
4. Delete the Auth user (cascades `user_roles`).
If a step fails the user sees which one, and pressing delete again continues (the account stays banned meanwhile).

**Deployment** (not done automatically):
1. Apply the migration: `supabase db push`.
2. Set the secret: `supabase secrets set ALLOWED_ORIGINS="https://your-app.example,http://localhost:5173"` (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically).
3. Deploy: `supabase functions deploy admin-users --no-verify-jwt` (the function authenticates the token itself, which also works with the new publishable/secret API keys).
4. Smoke-test as an admin and as a non-admin (expect 403).
