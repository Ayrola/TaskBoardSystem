// Canonical routes. Pages are lazy-loaded modules exporting `title` (string or function) and `mount`.
// access: 'public' (default) | 'private' (needs a session) | 'guest' (signed-out users only).
export const routes = [
  { path: '/', load: () => import('./pages/home/home.js') },
  { path: '/login', access: 'guest', load: () => import('./pages/login/login.js') },
  { path: '/dashboard', access: 'private', legacySection: 'dashboard', refreshOnReselect: true, load: () => import('./pages/dashboard/dashboard.js') },
  { path: '/tasks', access: 'private', legacySection: 'task-list', load: () => import('./pages/task-list/task-list.js') },
  { path: '/activity', access: 'private', legacySection: 'activity', load: () => import('./pages/activity/activity.js') },
  { path: '/deadlines', access: 'private', legacySection: 'deadlines', load: () => import('./pages/deadlines/deadlines.js') },
  { path: '/labels', access: 'private', legacySection: 'labels', load: () => import('./pages/labels/labels.js') },
  { path: '/projects/:id/dashboard', access: 'private', project: true, refreshOnReselect: true, load: () => import('./pages/dashboard/dashboard.js') },
  { path: '/projects/:id/labels', access: 'private', project: true, load: () => import('./pages/labels/labels.js') },
  { path: '/projects/:id/deadlines', access: 'private', project: true, load: () => import('./pages/deadlines/deadlines.js') },
  { path: '/projects/:id/activity', access: 'private', project: true, load: () => import('./pages/activity/activity.js') },
  { path: '/projects/:id/task-list', access: 'private', project: true, load: () => import('./pages/task-list/task-list.js') },
  { path: '/projects', access: 'private', load: () => import('./pages/projects/projects.js') },
  { path: '/projects/add', access: 'private', load: () => import('./pages/project-form/project-form.js') },
  { path: '/projects/:id/edit', access: 'private', project: true, load: () => import('./pages/project-form/project-form.js') },
  { path: '/projects/:id/tasks', access: 'private', project: true, load: () => import('./pages/tasks/tasks.js') },
  { path: '/projects/:id/users', access: 'private', project: true, load: () => import('./pages/users/users.js') },

  // Admin console: unavailable (shown as not found) to everyone but admins; RLS and RPC checks decide what is allowed.
  { path: '/admin', access: 'admin', load: () => import('./pages/admin/admin-projects.js') },
  { path: '/admin/projects', access: 'admin', load: () => import('./pages/admin/admin-projects.js') },
  { path: '/admin/projects/:id', access: 'admin', load: () => import('./pages/admin/admin-project.js') },
  { path: '/admin/projects/:id/edit', access: 'admin', load: () => import('./pages/admin/admin-project.js') },
  { path: '/admin/projects/:id/stages', access: 'admin', load: () => import('./pages/admin/admin-stages.js') },
  { path: '/admin/projects/:id/tasks', access: 'admin', load: () => import('./pages/admin/admin-tasks.js') },
  { path: '/admin/users', access: 'admin', load: () => import('./pages/admin/admin-users.js') },
  { path: '/admin/users/:id', access: 'admin', load: () => import('./pages/admin/admin-user.js') },
  { path: '/admin/users/:id/edit', access: 'admin', load: () => import('./pages/admin/admin-user.js') },
  { path: '/admin/stages/:id', access: 'admin', load: () => import('./pages/admin/admin-stage.js') },
  { path: '/admin/stages/:id/edit', access: 'admin', load: () => import('./pages/admin/admin-stage.js') },
  { path: '/admin/tasks/:id', access: 'admin', load: () => import('./pages/admin/admin-task.js') },
  { path: '/admin/tasks/:id/edit', access: 'admin', load: () => import('./pages/admin/admin-task.js') },
];

export const notFoundRoute = {
  path: '*',
  load: () => import('./pages/not-found/not-found.js'),
};
