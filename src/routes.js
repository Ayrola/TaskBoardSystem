// Canonical routes. Pages are lazy-loaded modules exporting `title` (string or function) and `mount`.
// access: 'public' (default) | 'private' (needs a session) | 'guest' (signed-out users only).
export const routes = [
  { path: '/', load: () => import('./pages/home/home.js') },
  { path: '/login', access: 'guest', load: () => import('./pages/login/login.js') },
  { path: '/dashboard', access: 'private', load: () => import('./pages/dashboard/dashboard.js') },
  { path: '/projects', access: 'private', load: () => import('./pages/projects/projects.js') },
  { path: '/projects/add', access: 'private', load: () => import('./pages/project-form/project-form.js') },
  { path: '/projects/:id/edit', access: 'private', load: () => import('./pages/project-form/project-form.js') },
  { path: '/projects/:id/tasks', access: 'private', load: () => import('./pages/tasks/tasks.js') },
  { path: '/projects/:id/users', access: 'private', load: () => import('./pages/users/users.js') },
];

export const notFoundRoute = {
  path: '*',
  load: () => import('./pages/not-found/not-found.js'),
};
