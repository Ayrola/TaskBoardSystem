// Canonical routes. Pages are lazy-loaded modules exporting `title` (string or function) and `mount`.
export const routes = [
  { path: '/', load: () => import('./pages/home/home.js') },
  { path: '/login', load: () => import('./pages/login/login.js') },
  { path: '/dashboard', load: () => import('./pages/dashboard/dashboard.js') },
  { path: '/projects', load: () => import('./pages/projects/projects.js') },
  { path: '/projects/add', load: () => import('./pages/project-form/project-form.js') },
  { path: '/projects/:id/edit', load: () => import('./pages/project-form/project-form.js') },
  { path: '/projects/:id/tasks', load: () => import('./pages/tasks/tasks.js') },
  { path: '/projects/:id/users', load: () => import('./pages/users/users.js') },
];

export const notFoundRoute = {
  path: '*',
  load: () => import('./pages/not-found/not-found.js'),
};
