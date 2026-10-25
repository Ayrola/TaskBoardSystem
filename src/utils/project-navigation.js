const sections = new Set(['dashboard', 'tasks', 'task-list', 'labels', 'deadlines', 'activity', 'users', 'edit']);
export function projectSection(path) {
  const section = /^\/projects\/[^/]+\/([^/]+)$/.exec(path)?.[1];
  return sections.has(section) ? section : 'tasks';
}
export function projectDestination(project, path) {
  let section = projectSection(path);
  if (['users', 'edit'].includes(section) && !project.canManage) section = 'tasks';
  return `/projects/${encodeURIComponent(project.id)}/${section}`;
}
export function legacyProjectQuery(section, query, sameProject) {
  const next = new URLSearchParams();
  const allowed = { dashboard: [], tasks: ['task','add','status','stage','label','assignment','assignee','due','search'], 'task-list': ['status'], labels: ['label', 'page'], deadlines: ['bucket', 'timezone', 'page'], activity: ['task', 'page', 'snapshot'] }[section] ?? [];
  for (const key of allowed) {
    if (!sameProject && ['task', 'label', 'stage', 'assignee', 'snapshot', 'page'].includes(key)) continue;
    if (query.get(key)) next.set(key, query.get(key));
  }
  return next.size ? `?${next}` : '';
}
