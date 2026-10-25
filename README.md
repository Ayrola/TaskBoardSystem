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

## Deploying to Render

Use a **Render Static Site** with the repository-root `render.yaml`: branch `initial-setup`,
build `npm ci && npm run build`, publish `dist`, and a `/*` → `/index.html` rewrite.
Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Render; they are public
build-time values and changes require a new build. Supabase continues to host the existing
Database, Auth, Storage and `admin-users` Edge Function. No application server is needed.

Follow [the deployment, Supabase settings, verification, cutover and rollback guide](docs/render-deployment.md).
It includes the required dashboard steps; adding this configuration does not deploy the site.
`netlify.toml` is intentionally retained for the existing Netlify deployment and rollback until
Render is verified. No Netlify Functions or additional Netlify headers/redirect files were found.

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


### Task assignees

Apply `supabase/migrations/20261022220000_task_assignees.sql` before running the updated client (`supabase db push`). Open a task to search project participants and assign or remove multiple responsible people. Cards show their names. Owners and current members can manage assignments; unrelated users cannot be assigned, even through direct API inserts. Removing a project member clears their assignments in the same transaction. Assignment changes refresh connected boards.

Run `npm run test:assignees` for isolated PostgreSQL checks of the migration, participant directory, RLS, assignment eligibility, duplicate prevention, membership removal, and cascading task deletion. The test uses PGlite with minimal existing-schema fixtures; it does not connect to the deployed database or exercise concurrent transactions.


### Project labels

`/projects/:id/labels` lists that project’s labels, usage counts and matching tasks (20 per page).
Owners and admins create, rename, recolour and remove project labels. Owners, current
members and admins can add/remove labels in task details. Cards display label names;
black or white text is selected using WCAG relative luminance for at least 4.5:1 contrast.
Task links open details even when the task is beyond the board's first loaded page.

The `project_labels` migration enables RLS and uses an internally derived `project_id`
on `task_labels` with composite foreign keys to both parents. Cross-project assignments
and parent changes that would invalidate assignments are rejected by PostgreSQL,
including privileged writes. Deleting a label removes its task assignments; deleting
a task/project cascades its label data. Changes notify connected boards.

Run `npm run test:labels` for isolated PostgreSQL authorization, consistency, pagination,
cascade and colour contrast tests. These use PGlite, not the deployed database, and do
not simulate concurrent sessions. Apply the new migration before deploying the client.


### Task deadlines

Tasks have an optional `due_at` timestamp. The shared task editor (including admin
editing) can set, change, or clear it. Input is explicitly in the browser's local
timezone and stored as an ISO UTC instant. Invalid/nonexistent local times are
rejected; ambiguous times during the autumn clock change use the first occurrence.
An unchanged deadline preserves the original seconds and offset, including the
second occurrence of a repeated local time.

`/projects/:id/deadlines` shows only that project’s accessible **open** tasks, filtered and paginated in the
database (20 per page, ordered by deadline then ID). Overdue means before the server's
current instant. Today spans midnight to the next midnight in the selected IANA
display timezone, including any overdue tasks today. Upcoming starts at the next
midnight. Day boundaries account for DST, including 23/25-hour days. Project scope comes from the URL, with no in-page project selector. Applying filters resets pagination.
The selected display timezone is remembered locally and also used for task deadline
displays; the default is the browser timezone. Completed tasks retain their deadlines
but are never marked as overdue work. The overview refreshes every minute; board
markers refresh every 30 seconds. Deadline changes also trigger existing board updates.

Deadline RPCs run as the caller and delegate to existing task creation/update RPCs
in the same transaction, retaining RLS, project locks and stage positioning. Legacy
RPCs preserve existing deadlines. Apply the `task_deadlines` migration before deploying
the new client. Run `npm run test:deadlines` for PostgreSQL access/order/pagination
checks and local-time/DST conversion tests. The deterministic day-boundary tests
inject a clock only into the isolated PGlite fixture, never the deployed function.


### Task checklists

Open task details to add, edit, complete, delete, or reorder plain-text checklist items.
Up/down buttons support keyboard reordering. A text summary and progress bar show
completed/total items; cards also show progress, and empty lists offer an add-item form.
Completing every item never changes the task's stage or its `done` flag.

The `task_checklists` migration creates `task_checklist_items`, with RLS enforced
through the parent task for owners, current project members and admins. Item text is
1–500 characters and rendered using text nodes or form values. Task/item deletion
cascades checklist data. Task IDs and generated metadata cannot be changed by clients.

The invoker `write_task_checklist` RPC saves each mutation in a transaction using the
existing authorized project lock, then rechecks the parent task. Reordering validates
the complete new order against the expected current order; stale, duplicate, missing,
and foreign item IDs are rejected atomically. Positions are unique per task and
renumbered after deletion. A stale reorder refreshes the UI before retrying. Checklist
changes notify connected boards; checklist writes do not modify parent task fields.

Apply the new migration before deploying the client. `npm run test:checklists` runs
isolated PostgreSQL tests for CRUD, ordering, stale snapshots, access rules, progress,
empty lists, cascades and unchanged task state. It does not simulate concurrent sessions
or exercise browser interactions.


### Task activity log

`/projects/:id/activity` shows that project’s accessible task activity newest first, with an optional task filter
and server-side pages of 20 entries. Board and task-detail links open the relevant
history. Page links retain a server-generated ID boundary so newly appended events
do not shift older pages; Refresh returns to the latest first page. Timestamps use
the browser's local timezone. Deleted tasks show a saved title and stable task UUID
without a broken task-details link.

Covered changes, starting when `task_activity` is installed:

- Task creation and deletion, including direct task writes.
- Actual title changes, with old/new plain-text titles.
- Description changes, recorded as a flag without copying rich-text bodies.
- Stage changes, with stage UUIDs and name snapshots.
- Explicit task position changes, with old/new zero-based positions (displayed as
  one-based positions in the UI).
- Completion changes, including changes caused by moving stages or editing a
  stage's completed status. Completing a checklist still does not complete a task.

A task row update can record several changed fields in one entry. An editor save
that changes content and then moves a task may produce a content entry and a move
entry. No-op writes, timestamp-only changes, and internal position shifts of
neighbours during the supported move/delete/stage-removal functions are omitted.
Stage removal records the actual tasks moved, and a drag records only its target.
The public mutation signatures and board ordering behaviour are preserved.

Audit generation runs in controlled database triggers. Actors come from server
`auth.uid()`, never request body actor IDs; only the UUID is stored, with no duplicated
email, auth metadata, tokens or credentials. Actorless database/maintenance writes
are marked System/database operation. A private table holds temporary renumbering
context; callers cannot write it or suppress auditing with browser-controlled
settings. Private mutation implementations are not directly executable by clients.
The controlled dispatcher checks owner/member/admin access before changing tasks,
and manager access before stage deletion. Failed/rolled-back mutations leave no audit.
Future ordering changes must retain these controlled mutation entry points.

Authenticated application users, including application admins, can only read audit
rows under project-access RLS. They cannot insert, edit, delete or truncate them.
Database-owner/infrastructure privileges remain privileged. Task deletion preserves
history; deleting a project removes its history, and no historical events are
invented for tasks predating the migration. The log stores each event's task title,
stage/position/completion data, not full task records or description contents.

Not covered: deadlines, labels, assignees, checklist items, comments, attachments,
project/member changes, stage renames/reordering, reads, logins, or changes to files
in Storage. A stage completion change is covered only through its effects on tasks.
Direct maintenance reordering outside the controlled mutation functions is logged
per changed task because there is no trusted user-action context to group it.

Migration `20261023070428_task_activity.sql` has been applied to the connected
Supabase project. It includes the approved task move/delete and stage-delete wrappers
that establish protected audit context while preserving existing mutation signatures.
`npm run test:activity` checks audit coverage, trusted actors, append-only client
permissions, one-event moves/deletes, private context, deletion snapshots, RLS,
rollback, and stable pagination using isolated PostgreSQL fixtures. Browser UI and
concurrent sessions are not exercised by this test.

### Project board interface

The board uses scoped task-surface tokens, a compact project header, expandable
project descriptions, exact project/stage totals, and a primary Add task action.
Secondary project actions live in a disclosure menu; manager actions retain the
existing permission hints. Cards show a safe plain-text excerpt and only available
labels, assignees, deadlines, checklist progress, attachment counts and comment counts.
Card action menus support keyboard navigation; handle-based dragging excludes interactive controls.
Task dialogs group the description/checklist/discussion separately from properties.
Mobile layouts include expandable filter controls and a stage-jump selector.

Title/description search and status, stage, label, assignment and deadline filters
retain their values through task dialogs and CRUD refreshes. Active filter chips
can be removed individually or cleared together. Empty projects and no-match
searches have distinct states. Full description text is searched, not just excerpts.

Unfiltered columns retain keyset pagination. To make filtered counts and results
complete without changing the schema or adding a search RPC, an active filter scans
all accessible task pages with bounded column concurrency. The UI reports scan
progress and cancels superseded requests. This can be slower on very large projects;
server-side full-text search would require a separate backend change. The full
canonical task arrays remain separate from the visible filtered cards. Dragging is
disabled while filters are active; Move remains available and uses the existing
relative-anchor/end-of-stage RPC. Never submit visible-card indexes as persisted order.

`npm run test:board` checks search/filter semantics. `npm run test:board:browser`
uses local Chrome's DevTools protocol without adding a browser dependency. Start
Vite on `127.0.0.1:5173` and a separate Chrome profile with
`--headless --remote-debugging-port=9223 --user-data-dir=/tmp/taskboard-browser-checks`.
Optional `BOARD_APP_URL` and `BOARD_CDP_URL` must be loopback URLs. The browser test
creates/closes its own tab and replaces Supabase HTTP/Realtime traffic with synthetic
fixtures; it does not mutate real accounts or database rows. It exercises desktop
and mobile layouts, partial loading, full-project search, CRUD and failure recovery,
filter retention, handle-based dragging, keyboard moves, reload persistence, Realtime,
permission hints, empty/error states, access loss and safe long text. Screenshots
are saved to the temporary directory printed by the test. These checks do not prove
live Supabase authorization or live network behaviour, and were run in Chrome only.

### Authenticated project navigation

Private and admin routes share a persistent sidebar; public landing and login pages keep the public layout. The sidebar drains every page of the existing RLS-backed project listing before searching, so matches include owned and assigned projects beyond the first page. Management links use the API's `canManage` hint; database authorization remains unchanged.

Project and membership mutations invalidate the in-memory directory. Existing board access broadcasts also invalidate it. External changes are rechecked on focus/visibility when stale and every minute while visible; no additional database publication is required. Logout and account changes abort pending requests and clear directory data. Only harmless display preferences and a per-user last-project ID are stored locally; every project entry rechecks access.

On desktop, collapse creates an icon rail. On mobile, Bootstrap Offcanvas supplies the backdrop, Escape handling and focus trap; closing restores focus to the navigation opener. The board keeps its own horizontal scrolling area.

Run `npm run test:sidebar:browser` with local Vite and an isolated Chrome DevTools session (defaults: `127.0.0.1:5173` and `127.0.0.1:9223`). It uses synthetic API responses to check paginated search, empty/error states, permission links, directory refresh, persistent layout, history, collapse, mobile drawer/focus, account switching and logout. `npm run test:board:browser` covers board regressions. Neither browser suite writes to Supabase.

### Colour themes

Choose **Light**, **Dark** or **System** in the sidebar account area (an icon stack when collapsed), or in the public-page footer. System is the default and follows OS changes. Only explicit Light/Dark preferences are stored under `taskboard:theme`; System removes that override. Choices synchronize across tabs and remain after logout. If storage is unavailable, the choice works for the current page lifetime.

`public/theme.js` is the single theme service and a blocking head script, so it sets Bootstrap 5.3's root `data-bs-theme` and native `color-scheme` before rendering. The application uses its subscription API through `src/services/theme-service.js`. Semantic palettes live in `src/styles.css`; board tokens reference them. Quill Snow toolbar/link-editor colours and Sortable drag states use these tokens. Label foregrounds continue to be selected by their existing contrast calculation. No data, permissions or theme-resolved OS values are stored as preferences.

Checks: `npm run test:theme` covers preferences, storage errors, media/storage events, subscription cleanup and semantic palette AA text contrast. With local Chrome DevTools available, `BOARD_APP_URL=http://127.0.0.1:4173 npm run test:theme:browser` checks the production preview, including real cross-tab updates and desktop/mobile screenshots. `BOARD_DARK=1` or `BOARD_LIGHT=1` with `npm run test:board:browser` exercises the board in each system theme. Browser suites use synthetic Supabase data; they do not prove live backend behavior or constitute a full accessibility audit.

### Projects browser

The Projects page uses a responsive card grid with literal title/description search, name/creation/metadata-update sorting, Owned/Member filters, accurate task/stage counts and task-completion progress. Project `updated_at` describes project metadata changes, not the most recent task activity. Missing descriptions remain empty; task-free projects display neutral progress.

`browse_projects_page` (migration `20261023142454_project_browser.sql`) applies filters and ordering before the existing 20-project page window. The single response includes filtered and accessible totals and complete per-project task/stage aggregates. It is SECURITY INVOKER, authenticated-only, and preserves the existing RLS and management helpers. The existing `list_projects_page` RPC remains unchanged for the sidebar and older clients. Apply the new migration before deploying this frontend to another backend.

Search, sort, access filter and pagination are encoded in the URL. A small in-memory, account-scoped UI preference also restores the list when using a board's Back to Projects link; project data and permissions are always fetched again. Existing create/edit/delete services invalidate the list; deletion retains its confirmation dialog.

Verification: `npm run test:projects` runs isolated Postgres tests for search across pages, literal wildcards, deterministic sorts, counts, pagination and owner/member/admin/anonymous access. `BOARD_APP_URL=http://127.0.0.1:4173 npm run test:projects:browser` checks the production preview with synthetic projects, including CRUD/cancel, permissions, keyboard menus, history/back navigation and responsive light/dark screenshots. These browser fixtures do not perform live project mutations.

### Dashboard summary navigation

Project dashboard summaries use native links. Stages opens `/projects/:id/tasks`; Total/Open/Done tasks open `/projects/:id/task-list` with the corresponding status. Counts use exact server-side RLS-protected queries scoped to the URL project. Zero counts remain navigable; summaries are hidden during loading/errors. Modified clicks keep normal browser behaviour.

The reusable project task list supports All/Open/Done with deterministic 20-row server pagination and exact totals. Clear Filters stays within the project. Task links open the existing board popup. No cross-project task selector or aggregation is used by these pages.

`BOARD_APP_URL=http://127.0.0.1:4173 npm run test:dashboard:browser` uses the production preview and synthetic Supabase responses to verify destinations, filtered totals, pagination, project scope, clear/reload, task opening, Back/Forward, native-link keyboard/modified-click behavior, zero/loading/error/retry states and light/dark/mobile screenshots. These checks do not validate live backend data.


### Task card display and interaction

The shared `task-card` component renders safe plain-text previews, two label chips plus overflow, compact deadline/status chips, batched attachment/comment/checklist counts and two assignee initials plus overflow. It omits empty metadata and does not invent task references or priorities. Full deadline timestamps and overflow names are available through native titles and accessible names. No Bootstrap tooltip instances or per-card API requests are created.

Choose Comfortable/Compact density and Show descriptions in the board toolbar's expanded controls. These harmless display preferences are stored under `taskboard:board-display`, follow cross-tab updates, and degrade to current-page settings if storage is unavailable. Hiding previews does not affect full-description search. The app had no existing density/preview preference mechanism in this checkout.

Dragging starts from the card background, title, description and non-interactive metadata. Interactive controls are excluded; no dedicated grip is required. Main content clicks still open details; a keyboard opener shows the card focus ring, and Move task remains in the action menu. Sortable retains its single fallback path, 4px tolerance, 160ms touch hold, control exclusions, release-click suppression, filtered-board locking, partial-column relative placement, authoritative failure recovery and Realtime queuing. No card-wide touch-action or selection restrictions are applied.

Run `BOARD_APP_URL=http://127.0.0.1:4173 BOARD_CHECK_CARDS=1 npm run test:board:browser` for card screenshots/overflow/preferences checks, and the normal board browser suite for whole-card reordering, cross-column moves, touch scrolling/dragging, controls, persistence and failure recovery. Both use synthetic backend responses.


### Active project context

The project ID in the URL is authoritative. Project sections are `/projects/:id/dashboard`, `/projects/:id/tasks` (the board), `/projects/:id/labels`, `/projects/:id/deadlines` and `/projects/:id/activity`. The paginated dashboard drill-down uses `/projects/:id/task-list`. Existing `/projects/:id/users` and `/projects/:id/edit` remain available to managers. Projects and administration remain global. There is no account-settings route in the existing application, so navigation adds no placeholder settings link.

`project-context.js` loads the project through the existing RLS-backed service and supplies its name and effective permission hints in `ctx.project`. The router clears the old page, aborts its requests and checks access before mounting the next project page. A new navigation supersedes pending context and page requests; no project-record cache is shared across users or projects. Page requests use the lifecycle abort signal, and the board retains its own ordering, pagination, dialog and drag safeguards.

After login, the `/dashboard` compatibility entry resolves the signed-in user’s last accessible project, then an accessible fallback. The only stored project preference is `taskboard:last-project:<userId>`. It is revalidated against the backend and never authorizes reads. Explicit project deep links take precedence. Zero-project users reach the Projects empty state with Create Project and invitation guidance. An explicit missing/deleted/inaccessible project shows an unavailable state with Retry and an accessible-project destination.

The sidebar separates Projects/admin links from the verified current project’s Dashboard, Board, Labels, Deadlines and Activity. Members/Project Settings are shown according to backend-derived management hints. Switching projects preserves the section when permitted, otherwise opens the board; it intentionally drops filters, selection and pagination. Task/label/project drafts use navigation guards. Back/Forward and reload obtain context from their own URLs.

Project data is filtered server-side: task lists and board pages include project equality filters, deadlines/activity pass the project ID to existing RPCs, and labels/usage counts query only the project catalogue. Label task pagination first verifies the selected label belongs to that project; the existing label RPC then follows that label’s unique project relation. Existing FK constraints prevent cross-project label assignments. No schema, RLS or RPC changes are needed.

Non-board project pages own one private project Broadcast subscription and revalidate access before refreshing. The board retains its existing single subscription and refresh deferral while dragging/editing. Old subscriptions and request controllers are released on navigation/logout/account change. Access checks also run after project-directory mutations, on focus and every minute while visible. Revocation clears the page and current-project navigation; transient verification failures offer Retry. Snapshot activity pagination and deadline display-timezone/DST conventions are preserved.

Legacy `/dashboard`, `/tasks`, `/labels`, `/deadlines` and `/activity` entries resolve to the corresponding project URL using replace navigation. Compatible query parameters survive; selections/snapshots/pages associated with an unavailable requested project are discarded. They are compatibility entry points, not duplicate global navigation items.

Verification: `npm run test:context` checks section preservation, management fallback, legacy filter cleanup, per-user preference isolation, blocked storage and aborted access checks. `BOARD_APP_URL=http://127.0.0.1:4173 npm run test:context:browser` uses two visibly different synthetic projects to check page/query isolation, last-project fallback, deep links, history/reload, rapid switching, delayed responses, Realtime isolation, revoked access, empty projects and mobile themes. Existing SQL/RLS tests remain separate from these mocked browser checks; they run locally in PGlite, not against production.
