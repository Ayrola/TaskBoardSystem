import './admin.css';
import {
  ADMIN_PAGE_SIZE,
  AdminAccessError,
  deleteStage,
  getAdminStage,
  listAllProjectStages,
} from '../../services/admin-service.js';
import { openConfirmDialog } from '../../components/confirm-dialog/confirm-dialog.js';
import { showError } from '../../services/toast-service.js';
import { renderPager as sharedRenderPager, totalPages as sharedTotalPages } from '../../utils/pager.js';

// Shows one `[data-state]` panel of a page and hides the others.
export function createStates(root) {
  const panels = root.querySelectorAll('[data-state]');
  return (state) => {
    panels.forEach((panel) => { panel.hidden = panel.dataset.state !== state; });
    root.setAttribute('aria-busy', String(state === 'loading'));
  };
}

export function describeLoadError(error) {
  return error instanceof AdminAccessError ? 'You do not have admin access.' : error.message;
}

export { pageFromQuery } from '../../utils/pager.js';

export const totalPages = (total) => sharedTotalPages(total, ADMIN_PAGE_SIZE);

export const renderPager = (container, { page, total }) =>
  sharedRenderPager(container, { page, total, pageSize: ADMIN_PAGE_SIZE });

// Stage deletion dialog. A stage with tasks requires an explicit destination stage of the same project;
// the database enforces that again. Returns null (after showing a message) when it cannot be opened.
export async function openStageDeleteDialog(stage, { signal } = {}) {
  let info;
  let stages;
  try {
    [info, stages] = await Promise.all([
      getAdminStage(stage.id, { signal }),
      listAllProjectStages(stage.projectId, { signal }),
    ]);
  } catch (error) {
    if (!signal?.aborted) showError(describeLoadError(error));
    return null;
  }
  const options = stages.filter((other) => other.id !== stage.id).map((other) => ({ value: other.id, label: other.name }));
  if (options.length === 0) {
    showError('A project must keep at least one stage.');
    return null;
  }
  const hasTasks = info.taskCount > 0;
  return openConfirmDialog({
    title: 'Delete stage?',
    lead: `Delete the stage “${stage.name}”?`,
    detail: hasTasks
      ? `It contains ${info.taskCount} ${info.taskCount === 1 ? 'task' : 'tasks'}. They will be added to the end of the stage you choose, and their done status will follow that stage.`
      : 'The stage is empty. This cannot be undone.',
    confirmLabel: 'Delete stage',
    choice: hasTasks ? { label: 'Move its tasks to', options } : undefined,
    onConfirm: (target) => deleteStage(stage.id, hasTasks ? target : null),
  });
}
