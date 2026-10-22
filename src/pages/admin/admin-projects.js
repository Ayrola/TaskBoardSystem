import html from './admin-projects.html?raw';
import { renderFragment, setText } from '../../utils/render.js';
import { formatDateTime } from '../../utils/dates.js';
import { listAdminProjects } from '../../services/admin-service.js';
import { deleteProject, ProjectNotFoundError } from '../../services/projects-service.js';
import { openConfirmDialog } from '../../components/confirm-dialog/confirm-dialog.js';
import { showSuccess, showInfo, TOAST_MESSAGES } from '../../services/toast-service.js';
import { createStates, describeLoadError, pageFromQuery, renderPager, totalPages } from './admin-common.js';

export const title = 'Admin · Projects';

export function mount(container, ctx) {
  // /admin is just the entry point of the console.
  if (ctx.path === '/admin') {
    ctx.navigate('/admin/projects', { replace: true });
    return;
  }

  renderFragment(container, html);
  const root = container.querySelector('.page-admin-projects');
  const show = createStates(root);
  const rows = root.querySelector('[data-rows]');
  const template = root.querySelector('[data-row-template]');
  const pager = root.querySelector('[data-pager]');
  const searchForm = root.querySelector('[data-search-form]');
  const search = (ctx.query.q ?? '').trim().slice(0, 100);
  let page = pageFromQuery(ctx.query);
  let requestId = 0;
  let dialog = null;
  let byId = new Map();

  searchForm.elements.q.value = search;

  function buildRow(project) {
    const row = template.content.firstElementChild.cloneNode(true);
    const id = encodeURIComponent(project.id);
    row.dataset.projectId = project.id;
    setText(row, '[data-cell="title"]', project.title);
    setText(row, '[data-cell="owner"]', project.ownerLabel);
    setText(row, '[data-cell="stages"]', project.stageCount.toLocaleString());
    setText(row, '[data-cell="tasks"]', project.taskCount.toLocaleString());
    setText(row, '[data-cell="created"]', formatDateTime(project.createdAt));
    const view = row.querySelector('[data-action="view"]');
    view.href = `/admin/projects/${id}`;
    view.setAttribute('aria-label', `View ${project.title}`);
    const edit = row.querySelector('[data-action="edit"]');
    edit.href = `/admin/projects/${id}/edit`;
    edit.setAttribute('aria-label', `Edit ${project.title}`);
    row.querySelector('[data-action="delete"]').setAttribute('aria-label', `Delete ${project.title}`);
    return row;
  }

  async function load({ quiet = false } = {}) {
    const current = ++requestId;
    if (!quiet) show('loading');
    try {
      const result = await listAdminProjects({ page, search, signal: ctx.signal });
      if (current !== requestId || ctx.signal.aborted) return;

      // The last row of the last page was removed: continue on the previous page.
      if (result.rows.length === 0 && page > 1) {
        page = Math.min(page - 1, totalPages(result.total));
        const params = new URLSearchParams(location.search);
        if (page === 1) params.delete('page');
        else params.set('page', String(page));
        ctx.navigate(`${location.pathname}${params.size ? `?${params}` : ''}`, { replace: true });
        return;
      }

      byId = new Map(result.rows.map((project) => [project.id, project]));
      rows.replaceChildren(...result.rows.map(buildRow));
      renderPager(pager, { page, total: result.total });
      if (result.rows.length === 0) {
        setText(root, '[data-empty-text]', search ? 'No projects match your search.' : 'There are no projects yet.');
        show('empty');
      } else {
        show('table');
      }
    } catch (error) {
      if (current !== requestId || ctx.signal.aborted) return;
      setText(root, '[data-error-text]', describeLoadError(error));
      show('error');
    }
  }

  async function confirmDelete(project, trigger) {
    dialog = openConfirmDialog({
      title: 'Delete project?',
      lead: `Delete “${project.title}” owned by ${project.ownerLabel}?`,
      detail: `Its ${project.stageCount} stages, ${project.taskCount} tasks, members and attachments will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Delete project',
      onConfirm: async () => {
        try {
          await deleteProject(project.id);
        } catch (error) {
          if (!(error instanceof ProjectNotFoundError)) throw error;
          showInfo('That project no longer exists.');
          return;
        }
        showSuccess(TOAST_MESSAGES.projectDeleted);
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
    const project = byId.get(button.closest('tr')?.dataset.projectId);
    if (project) confirmDelete(project, button);
  });
  ctx.cleanup.listen(searchForm, 'submit', (event) => {
    event.preventDefault();
    const value = searchForm.elements.q.value.trim();
    ctx.navigate(value ? `/admin/projects?q=${encodeURIComponent(value)}` : '/admin/projects');
  });
  ctx.cleanup.listen(root.querySelector('[data-retry]'), 'click', () => load());
  ctx.cleanup.add(() => dialog?.destroy());
  load();
}
