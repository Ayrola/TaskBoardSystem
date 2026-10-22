import html from './admin-tasks.html?raw';
import { renderFragment, setText } from '../../utils/render.js';
import { formatDateTime } from '../../utils/dates.js';
import {
  AdminNotFoundError,
  getAdminProject,
  listAllProjectStages,
  listProjectTasks,
} from '../../services/admin-service.js';
import { deleteTask, TaskNotFoundError } from '../../services/tasks-service.js';
import { openConfirmDialog } from '../../components/confirm-dialog/confirm-dialog.js';
import { showSuccess, showInfo } from '../../services/toast-service.js';
import { createStates, describeLoadError, pageFromQuery, renderPager, totalPages } from './admin-common.js';

export const title = 'Admin · Tasks';

export function mount(container, ctx) {
  const projectId = ctx.params.id;
  const base = `/admin/projects/${encodeURIComponent(projectId)}`;

  renderFragment(container, html);
  const root = container.querySelector('.page-admin-tasks');
  const show = createStates(root);
  const rows = root.querySelector('[data-rows]');
  const template = root.querySelector('[data-row-template]');
  const pager = root.querySelector('[data-pager]');
  let page = pageFromQuery(ctx.query);
  let requestId = 0;
  let dialog = null;
  let byId = new Map();
  let stageNames = new Map();

  root.querySelector('[data-crumb-project]').href = base;
  root.querySelector('[data-link="stages"]').href = `${base}/stages`;

  function buildRow(task) {
    const row = template.content.firstElementChild.cloneNode(true);
    const id = encodeURIComponent(task.id);
    row.dataset.taskId = task.id;
    setText(row, '[data-cell="title"]', task.title);
    setText(row, '[data-cell="stage"]', stageNames.get(task.stageId) ?? '—');
    const status = setText(row, '[data-cell="status"]', task.done ? 'Done' : 'Open');
    status.classList.add(task.done ? 'text-bg-success' : 'text-bg-secondary');
    setText(row, '[data-cell="updated"]', formatDateTime(task.updatedAt));
    const view = row.querySelector('[data-action="view"]');
    view.href = `/admin/tasks/${id}`;
    view.setAttribute('aria-label', `View ${task.title}`);
    const edit = row.querySelector('[data-action="edit"]');
    edit.href = `/admin/tasks/${id}/edit`;
    edit.setAttribute('aria-label', `Edit ${task.title}`);
    row.querySelector('[data-action="delete"]').setAttribute('aria-label', `Delete ${task.title}`);
    return row;
  }

  async function load({ quiet = false } = {}) {
    const current = ++requestId;
    if (!quiet) show('loading');
    try {
      const [project, stages, result] = await Promise.all([
        getAdminProject(projectId, { signal: ctx.signal }),
        listAllProjectStages(projectId, { signal: ctx.signal }),
        listProjectTasks(projectId, { page, signal: ctx.signal }),
      ]);
      if (current !== requestId || ctx.signal.aborted) return;

      if (result.rows.length === 0 && page > 1) {
        page = Math.min(page - 1, totalPages(result.total));
        ctx.navigate(page === 1 ? `${base}/tasks` : `${base}/tasks?page=${page}`, { replace: true });
        return;
      }

      setText(root, '[data-crumb-project]', project.title);
      stageNames = new Map(stages.map((stage) => [stage.id, stage.name]));
      byId = new Map(result.rows.map((task) => [task.id, task]));
      rows.replaceChildren(...result.rows.map(buildRow));
      renderPager(pager, { page, total: result.total });
      show(result.rows.length === 0 ? 'empty' : 'table');
    } catch (error) {
      if (current !== requestId || ctx.signal.aborted) return;
      if (error instanceof AdminNotFoundError) {
        show('notfound');
        return;
      }
      setText(root, '[data-error-text]', describeLoadError(error));
      show('error');
    }
  }

  async function confirmDelete(task, trigger) {
    dialog = openConfirmDialog({
      title: 'Delete task?',
      lead: `Delete the task “${task.title}”?`,
      detail: 'Its attachments will be removed too. This cannot be undone.',
      confirmLabel: 'Delete task',
      onConfirm: async () => {
        try {
          await deleteTask(task.id);
        } catch (error) {
          if (!(error instanceof TaskNotFoundError)) throw error;
          showInfo('That task no longer exists.');
          return;
        }
        showSuccess('Task deleted.');
      },
    });
    const deleted = await dialog.result;
    dialog = null;
    if (ctx.signal.aborted) return;
    if (deleted) await load({ quiet: true });
    (trigger.isConnected ? trigger : root.querySelector('h1'))?.focus();
  }

  ctx.cleanup.listen(rows, 'click', (event) => {
    const button = event.target.closest('[data-action="delete"]');
    if (!button || dialog) return;
    const task = byId.get(button.closest('tr')?.dataset.taskId);
    if (task) confirmDelete(task, button);
  });
  ctx.cleanup.listen(root.querySelector('[data-retry]'), 'click', () => load());
  ctx.cleanup.add(() => dialog?.destroy());
  load();
}
