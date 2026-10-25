import { isUuid } from './validation.js';
import { isOverdue } from './deadlines.js';
export const EMPTY_BOARD_FILTERS = Object.freeze({ search: '', status: '', stage: '', label: '', assignment: '', assignee: '', due: '' });
export function hasBoardFilters(filters) { return Object.values(filters).some(value => String(value).trim() !== ''); }
export function matchesBoardTask(task, stageId, filters, plainDescription = '', now = Date.now()) {
  const search = filters.search.trim().toLocaleLowerCase();
  if (search && !`${task.title} ${plainDescription}`.toLocaleLowerCase().includes(search)) return false;
  if (filters.status === 'open' && task.done) return false;
  if (filters.status === 'completed' && !task.done) return false;
  if (filters.stage && filters.stage !== stageId) return false;
  if (filters.label && !task.labels?.some(label => label.id === filters.label)) return false;
  if (filters.assignee && !task.assignees?.some(person => person.user_id === filters.assignee)) return false;
  if (filters.assignment === 'assigned' && !task.assignees?.length) return false;
  if (filters.assignment === 'unassigned' && task.assignees?.length) return false;
  if (filters.due === 'overdue' && !isOverdue(task, now)) return false;
  if (filters.due === 'scheduled' && !task.dueAt) return false;
  if (filters.due === 'none' && task.dueAt) return false;
  return true;
}

export function boardFiltersFromQuery(query = {}) {
  const filters = { ...EMPTY_BOARD_FILTERS };
  for (const key of ['stage', 'label', 'assignee']) if (isUuid(query[key])) filters[key] = query[key];
  for (const [key, values] of Object.entries({ status: ['open','completed'], assignment: ['assigned','unassigned'], due: ['overdue','scheduled','none'] })) if (values.includes(query[key])) filters[key] = query[key];
  if (typeof query.search === 'string') filters.search = query.search.trim().slice(0,200);
  return filters;
}
