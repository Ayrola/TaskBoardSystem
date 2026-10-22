import html from './projects.html?raw';
import './projects.css';
import { renderFragment, setText } from '../../utils/render.js';
import { listProjects } from '../../services/projects-service.js';
import { showInfo } from '../../services/toast-service.js';

export const title = 'Projects';

export function mount(container, ctx) {
  renderFragment(container, html);
  const root = container.querySelector('.page-projects');
  const panels = root.querySelectorAll('[data-state]');
  const rows = root.querySelector('[data-rows]');
  const template = root.querySelector('[data-row-template]');
  let requestId = 0;

  const show = (state) => {
    panels.forEach((panel) => { panel.hidden = panel.dataset.state !== state; });
    root.setAttribute('aria-busy', String(state === 'loading'));
  };

  function buildRow(project) {
    const row = template.content.firstElementChild.cloneNode(true);
    const id = encodeURIComponent(project.id);

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
    return row;
  }

  async function load() {
    const current = ++requestId;
    show('loading');
    try {
      const projects = await listProjects({ signal: ctx.signal });
      if (current !== requestId || ctx.signal.aborted) return;

      rows.replaceChildren(...projects.map(buildRow));
      show(projects.length === 0 ? 'empty' : 'table');
    } catch (error) {
      if (current !== requestId || ctx.signal.aborted) return;
      setText(root, '[data-error-text]', error.message);
      show('error');
    }
  }

  // Delete is a placeholder until the deletion flow exists; one listener covers all rows.
  ctx.cleanup.listen(rows, 'click', (event) => {
    if (event.target.closest('[data-action="delete"]')) showInfo('Deleting projects is not available yet.');
  });
  ctx.cleanup.listen(root.querySelector('[data-retry]'), 'click', load);
  load();
}
