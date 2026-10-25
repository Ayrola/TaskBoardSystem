# Taskboard – Copilot Instructions

## Project
A Trello-style application where users manage projects, stages and tasks.

## Architecture
- Vanilla JavaScript ES modules.
- Vite.
- Bootstrap.
- Separate HTML, CSS and JS files for pages and substantial components.
- Shared header and footer.
- Services for database operations.
- Utilities for validation, dates and safe rendering.
- HTML fragments must not include html, head or body elements.
- Use one client-side router with History API.
- Clean up page event listeners and subscriptions when unmounting.
- Use Supabase RLS as the authorization boundary.
- Save and synchronize SQL migrations.
- Project membership: the owner manages members; members can view the project and work with its tasks (see README).
- Application roles: `user` / `admin` in `user_roles`; admins manage all projects via `is_admin()` inside RLS helpers. Roles are never taken from client metadata and there is no self-promotion path; admins are bootstrapped manually with `scripts/bootstrap-admin.js`.

## Canonical routes
- `/`
- `/login`
- `/dashboard` (legacy entry: resolves the last accessible project)
- `/projects/:id/dashboard`
- `/projects/:id/labels`
- `/projects/:id/deadlines`
- `/projects/:id/activity`
- `/projects/:id/task-list`
- `/projects`
- `/projects/add`
- `/projects/:id/edit`
- `/projects/:id/tasks`
- `/projects/:id/users`

- Admin pages live under /admin; guard routes but rely on database authorization. Stage delete/reorder go through RPCs only; no Auth user administration in browser code.

- Project feature pages receive verified `ctx.project` from the router. The URL project ID is authoritative; all queries must include its scope. Never use the last-project localStorage preference as access authorization. Use `ctx.onProjectRefresh` for non-board project refreshes and `ctx.signal`/cleanup for lifecycle isolation.
