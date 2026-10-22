import html from './admin-stages.html?raw';
import { renderFragment, setText } from '../../utils/render.js';
import {
  ADMIN_PAGE_SIZE,
  AdminNotFoundError,
  getAdminProject,
  listProjectStages,
  moveStage,
} from '../../services/admin-service.js';
import { showSuccess, showError } from '../../services/toast-service.js';
import { createStates, describeLoadError, openStageDeleteDialog, pageFromQuery, renderPager, totalPages } from './admin-common.js';

export const title = 'Admin · Stages';

export function mount(container, ctx) {
  const projectId = ctx.params.id;
  const base = `/admin/projects/${encodeURIComponent(projectId)}`;

  renderFragment(container, html);
  const root = container.querySelector('.page-admin-stages');
  const show = createStates(root);
  const rows = root.querySelector('[data-rows]');
  const template = root.querySelector('[data-row-template]');
  const pager = root.querySelector('[data-pager]');
  let page = pageFromQuery(ctx.query);
  let requestId = 0;
  let dialog = null;
  let moving = false;
  let byId = new Map();
  let total = 0;

  root.querySelector('[data-crumb-project]').href = base;
  root.querySelector('[data-link="tasks"]').href = `${base}/tasks`;

  function setMoving(value) {
    moving = value;
    rows.querySelectorAll('[data-action="up"], [data-action="down"]').forEach((button) => {
      if (value) button.disabled = true;
      else button.disabled = button.dataset.edge === 'true';
    });
  }

  function buildRow(stage, index) {
    const row = template.content.firstElementChild.cloneNode(true);
    const id = encodeURIComponent(stage.id);
    const absolute = (page - 1) * ADMIN_PAGE_SIZE + index;
    row.dataset.stageId = stage.id;
    row.dataset.index = String(absolute);
    setText(row, '[data-cell="number"]', absolute + 1);
    setText(row, '[data-cell="name"]', stage.name);
    const done = setText(row, '[data-cell="done"]', stage.isDone ? 'Done' : 'Open');
    done.classList.add(stage.isDone ? 'text-bg-success' : 'text-bg-secondary');

    const up = row.querySelector('[data-action="up"]');
    const down = row.querySelector('[data-action="down"]');
    up.setAttribute('aria-label', `Move ${stage.name} earlier`);
    down.setAttribute('aria-label', `Move ${stage.name} later`);
    up.dataset.edge = String(absolute === 0);
    down.dataset.edge = String(absolute === total - 1);
    up.disabled = absolute === 0;
    down.disabled = absolute === total - 1;

    const view = row.querySelector('[data-action="view"]');
    view.href = `/admin/stages/${id}`;
    view.setAttribute('aria-label', `View ${stage.name}`);
    const edit = row.querySelector('[data-action="edit"]');
    edit.href = `/admin/stages/${id}/edit`;
    edit.setAttribute('aria-label', `Edit ${stage.name}`);
    row.querySelector('[data-action="delete"]').setAttribute('aria-label', `Delete ${stage.name}`);
    return row;
  }

  async function load({ quiet = false } = {}) {
    const current = ++requestId;
    if (!quiet) show('loading');
    try {
      const [project, result] = await Promise.all([
        getAdminProject(projectId, { signal: ctx.signal }),
        listProjectStages(projectId, { page, signal: ctx.signal }),
      ]);
      if (current !== requestId || ctx.signal.aborted) return;

      if (result.rows.length === 0 && page > 1) {
        page = Math.min(page - 1, totalPages(result.total));
        ctx.navigate(page === 1 ? base + '/stages' : `${base}/stages?page=${page}`, { replace: true });
        return;
      }

      setText(root, '[data-crumb-project]', project.title);
      total = result.total;
      byId = new Map(result.rows.map((stage) => [stage.id, stage]));
      rows.replaceChildren(...result.rows.map(buildRow));
      renderPager(pager, { page, total });
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

  async function reorder(stage, row, direction, button) {
    if (moving) return;
    setMoving(true);
    try {
      await moveStage(stage.id, Number(row.dataset.index) + direction);
      if (ctx.signal.aborted) return;
      showSuccess('Stage order updated.');
    } catch (error) {
      if (ctx.signal.aborted) return;
      showError(describeLoadError(error));
    }
    if (ctx.signal.aborted) return;
    // Always reload: the server order is authoritative, whether or not the move succeeded.
    await load({ quiet: true });
    setMoving(false);
    const sameRow = rows.querySelector(`[data-stage-id="${stage.id}"]`);
    (sameRow?.querySelector(`[data-action="${button}"]:not(:disabled)`) ?? sameRow?.querySelector('a'))?.focus();
  }

  let preparing = false;

  async function confirmDelete(stage, trigger) {
    preparing = true;
    dialog = await openStageDeleteDialog(stage, { signal: ctx.signal });
    preparing = false;
    if (!dialog) return;
    if (ctx.signal.aborted) {
      dialog.destroy();
      return;
    }
    const deleted = await dialog.result;
    dialog = null;
    if (ctx.signal.aborted) return;
    if (deleted) {
      showSuccess('Stage deleted.');
      await load({ quiet: true });
      root.querySelector('h1')?.focus();
    } else {
      trigger.focus();
    }
  }

  ctx.cleanup.listen(rows, 'click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const row = button.closest('tr');
    const stage = byId.get(row?.dataset.stageId);
    if (!stage) return;
    const { action } = button.dataset;
    if (action === 'up' || action === 'down') reorder(stage, row, action === 'up' ? -1 : 1, action);
    else if (action === 'delete' && !dialog && !preparing) confirmDelete(stage, button);
  });
  ctx.cleanup.listen(root.querySelector('[data-retry]'), 'click', () => load());
  ctx.cleanup.add(() => dialog?.destroy());
  load();
}
