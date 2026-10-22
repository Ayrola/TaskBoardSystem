import html from './projects.html?raw';
import './projects.css';
import { renderFragment, setText } from '../../utils/render.js';
import { listProjects, deleteProject, ProjectNotFoundError, PROJECTS_PAGE_SIZE } from '../../services/projects-service.js';
import { pageFromQuery, renderPager, totalPages } from '../../utils/pager.js';
import { openConfirmDialog } from '../../components/confirm-dialog/confirm-dialog.js';
import { showSuccess, showInfo, TOAST_MESSAGES } from '../../services/toast-service.js';

export const title = 'Projects';

export function mount(container, ctx) {
  renderFragment(container, html);
  const root = container.querySelector('.page-projects');
  const panels = root.querySelectorAll('[data-state]');
  const rows = root.querySelector('[data-rows]');
  const template = root.querySelector('[data-row-template]');
  const pager = root.querySelector('[data-pager]');
  let page = pageFromQuery(ctx.query);
  let requestId = 0;
  let dialog = null;
  let projectsById = new Map();

  const show = (state) => {
    panels.forEach((panel) => { panel.hidden = panel.dataset.state !== state; });
    root.setAttribute('aria-busy', String(state === 'loading'));
  };

  function buildRow(project) {
    const row = template.content.firstElementChild.cloneNode(true);
    const id = encodeURIComponent(project.id);
    row.dataset.projectId = project.id;

    setText(row, '[data-cell="title"]', project.title);
    const description = setText(row, '[data-cell="description"]', project.description || '—');
    if (project.description) description.title = project.description;
    for (const key of ['stageCount', 'openTasks', 'doneTasks']) {
      setText(row, `[data-cell="${key}"]`, project[key].toLocaleString());
    }

    const tasks = row.querySelector('[data-action="tasks"]');
    tasks.href = `/projects/${id}/tasks`;
    tasks.setAttribute('aria-label', `View tasks for ${project.title}`);
    const edit = row.querySelector('[data-action="edit"]');
    edit.href = `/projects/${id}/edit`;
    edit.setAttribute('aria-label', `Edit ${project.title}`);
    row.querySelector('[data-action="delete"]').setAttribute('aria-label', `Delete ${project.title}`);
    const label = project.isOwner ? 'Owned' : project.canManage ? 'Admin access' : 'Member';
    const role = setText(row, '[data-cell="role"]', label);
    role.classList.add(project.isOwner ? 'text-bg-primary' : project.canManage ? 'text-bg-dark' : 'text-bg-secondary');
    const users = row.querySelector('[data-action="users"]');
    users.href = `/projects/${id}/users`;
    users.setAttribute('aria-label', `Manage users of ${project.title}`);
    if (!project.canManage) {
      edit.hidden = true;
      users.hidden = true;
      row.querySelector('[data-action="delete"]').hidden = true;
    }
    return row;
  }

  // `quiet` refreshes the list in place (after a delete) without flashing the loading state.
  async function load({ quiet = false } = {}) {
    const current = ++requestId;
    if (!quiet) show('loading');
    try {
      const result = await listProjects({ page, signal: ctx.signal });
      if (current !== requestId || ctx.signal.aborted) return;

      // The page no longer exists (for example its last project was deleted): go to the real last page.
      if (result.rows.length === 0 && page > 1) {
        page = totalPages(result.total, PROJECTS_PAGE_SIZE);
        const params = new URLSearchParams(location.search);
        if (page === 1) params.delete('page');
        else params.set('page', String(page));
        ctx.navigate(`${location.pathname}${params.size ? `?${params}` : ''}`, { replace: true });
        return;
      }

      projectsById = new Map(result.rows.map((project) => [project.id, project]));
      rows.replaceChildren(...result.rows.map(buildRow));
      renderPager(pager, { page, total: result.total, pageSize: PROJECTS_PAGE_SIZE });
      show(result.rows.length === 0 ? 'empty' : 'table');
    } catch (error) {
      if (current !== requestId || ctx.signal.aborted) return;
      pager.hidden = true;
      setText(root, '[data-error-text]', error.message);
      show('error');
    }
  }

  async function confirmDelete(project, trigger) {
    dialog = openConfirmDialog({
      title: 'Delete project?',
      lead: `Are you sure you want to delete “${project.title}”?`,
      detail:
        'All stages, tasks and attachments in this project will also be permanently removed. This cannot be undone.',
      confirmLabel: 'Delete project',
      onConfirm: async () => {
        try {
          await deleteProject(project.id);
        } catch (error) {
          // Already gone (or no longer accessible): nothing left to delete, so refresh instead of failing.
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
    // Return focus to something sensible: the trigger if it still exists, otherwise the heading.
    const target = trigger.isConnected ? trigger : root.querySelector('h1');
    target?.focus();
  }

  ctx.cleanup.listen(rows, 'click', (event) => {
    const button = event.target.closest('[data-action="delete"]');
    if (!button || dialog) return;
    const project = projectsById.get(button.closest('tr')?.dataset.projectId);
    if (project) confirmDelete(project, button);
  });
  ctx.cleanup.listen(root.querySelector('[data-retry]'), 'click', () => load());
  ctx.cleanup.add(() => dialog?.destroy());
  load();
}
