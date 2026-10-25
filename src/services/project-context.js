import { getProject, listProjects, ProjectNotFoundError } from './projects-service.js';
import { isUuid } from '../utils/validation.js';

const preferenceKey = userId => `taskboard:last-project:${userId}`;
export function rememberProject(userId, projectId) {
  if (!userId || !isUuid(projectId)) return;
  try { localStorage.setItem(preferenceKey(userId), projectId); } catch { /* Optional preference only. */ }
}
export async function loadProjectContext(projectId, { signal } = {}) {
  const project = await getProject(projectId, { signal });
  signal?.throwIfAborted();
  return Object.freeze({ ...project, name: project.title, permissions: Object.freeze({ work: true, manage: project.canManage }) });
}
// A remembered ID is a preference, never an access grant. Recheck it before navigation.
export async function resolveProjectEntry(userId, { requestedId, signal } = {}) {
  let remembered;
  try { remembered = localStorage.getItem(preferenceKey(userId)); } catch { /* Optional storage. */ }
  for (const candidate of new Set([requestedId, remembered].filter(isUuid))) {
    try { return await loadProjectContext(candidate, { signal }); }
    catch (error) { if (!(error instanceof ProjectNotFoundError)) throw error; }
  }
  for (let page = 1; ; page++) {
    const accessible = await listProjects({ page, signal });
    for (const project of accessible.rows) {
      try { return await loadProjectContext(project.id, { signal }); }
      catch (error) { if (!(error instanceof ProjectNotFoundError)) throw error; }
    }
    signal?.throwIfAborted();
    if (!accessible.rows.length) return null;
  }
}
