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

## Canonical routes
- `/`
- `/login`
- `/dashboard`
- `/projects`
- `/projects/add`
- `/projects/:id/edit`
- `/projects/:id/tasks`
- `/projects/:id/users`
