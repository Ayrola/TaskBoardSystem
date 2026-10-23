import html from './labels.html?raw';
import { renderFragment } from '../../utils/render.js';
import { getProject, listProjects, PROJECTS_PAGE_SIZE } from '../../services/projects-service.js';
import { listProjectLabels, saveProjectLabel, removeProjectLabel, listLabelTasks, LABEL_TASKS_PAGE_SIZE } from '../../services/labels-service.js';
import { labelBadge } from '../../utils/labels.js';
import { pageFromQuery, renderPager, totalPages } from '../../utils/pager.js';
import { openConfirmDialog } from '../../components/confirm-dialog/confirm-dialog.js';

export const title = 'Labels';
export function mount(container, ctx) {
  renderFragment(container, html);
  const content = container.querySelector('[data-content]');
  const status = container.querySelector('[data-status]');
  const errorBox = container.querySelector('[data-error]');
  const pager = container.querySelector('[data-pager]');
  const retry = container.querySelector('[data-retry]');
  ctx.cleanup.listen(retry, 'click', () => load());
  let generation = 0;
  let dialog;
  let busy = false;
  const page = pageFromQuery(ctx.query);
  ctx.cleanup.add(() => dialog?.destroy());
  function node(tag, text, className = '') {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = className;
    return element;
  }
  function link(text, href) {
    const a = node('a', text);
    a.href = href;
    return a;
  }
  function fail(error) {
    if (ctx.signal.aborted) return;
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    retry.hidden = false;
    status.textContent = '';
  }
  function labelUrl(projectId, labelId) {
    return `/labels?project=${encodeURIComponent(projectId)}${labelId ? `&label=${encodeURIComponent(labelId)}` : ''}`;
  }
  function editor(project, label = null) {
    const form = document.createElement('form');
    form.className = 'd-flex flex-wrap align-items-end gap-2 my-3';
    const nameId = `label-name-${label?.id ?? 'new'}`;
    const colourId = `label-colour-${label?.id ?? 'new'}`;
    const nameGroup = node('div', '', 'flex-grow-1');
    const nameLabel = node('label', 'Label name', 'form-label');
    nameLabel.htmlFor = nameId;
    const name = document.createElement('input');
    name.id = nameId; name.className = 'form-control'; name.required = true; name.maxLength = 60;
    name.value = label?.name ?? '';
    nameGroup.append(nameLabel, name);
    const colourGroup = node('div', '');
    const colourLabel = node('label', 'Colour', 'form-label');
    colourLabel.htmlFor = colourId;
    const colour = document.createElement('input');
    colour.type = 'color'; colour.id = colourId; colour.className = 'form-control form-control-color';
    colour.value = label?.colour ?? '#2563eb';
    colourGroup.append(colourLabel, colour);
    const save = node('button', label ? 'Save label' : 'Create label', 'btn btn-primary');
    save.type = 'submit';
    form.append(nameGroup, colourGroup, save);
    ctx.cleanup.listen(form, 'submit', async (event) => {
      event.preventDefault();
      if (busy || dialog) return;
      busy = true; save.disabled = true; errorBox.hidden = true;
      try {
        await saveProjectLabel(project.id, label?.id, { name: name.value, colour: colour.value });
        await load();
      } catch (error) { fail(error); }
      finally { busy = false; save.disabled = false; }
    });
    return form;
  }
  async function load() {
    const current = ++generation;
    errorBox.hidden = true; retry.hidden = true; status.textContent = 'Loading…';
    content.setAttribute('aria-busy', 'true');
    content.replaceChildren(); pager.hidden = true;
    try {
      if (!ctx.query.project) {
        const projects = await listProjects({ page, signal: ctx.signal });
        if (ctx.signal.aborted || current !== generation) return;
        content.append(node('h2', 'Accessible projects', 'h5'));
        const list = node('ul', '', 'list-group');
        for (const project of projects.rows) {
          const li = node('li', '', 'list-group-item');
          li.append(link(project.title, labelUrl(project.id)));
          list.append(li);
        }
        content.append(list);
        status.textContent = projects.rows.length ? '' : 'No accessible projects.';
        renderPager(pager, { page, total: projects.total, pageSize: PROJECTS_PAGE_SIZE });
        return;
      }
      const project = await getProject(ctx.query.project, { signal: ctx.signal });
      const labels = await listProjectLabels(project.id, { signal: ctx.signal });
      if (ctx.signal.aborted || current !== generation) return;
      content.append(link('All accessible projects', '/labels'), node('h2', project.title, 'h4 mt-3'));
      content.append(link('Open project board', `/projects/${project.id}/tasks`));
      if (project.canManage) content.append(editor(project));
      const list = node('ul', '', 'list-group my-3');
      for (const label of labels) {
        const li = node('li', '', 'list-group-item');
        const select = link('', labelUrl(project.id, label.id));
        select.setAttribute('aria-label', `Show tasks labelled ${label.name}`);
        if (ctx.query.label === label.id) select.setAttribute('aria-current', 'true');
        select.append(labelBadge(label)); li.append(select);
        if (project.canManage) {
          const details = document.createElement('details');
          details.className = 'mt-2';
          details.append(node('summary', `Edit ${label.name}`), editor(project, label));
          const remove = node('button', 'Remove label', 'btn btn-sm btn-outline-danger');
          remove.type = 'button'; remove.setAttribute('aria-label', `Remove label ${label.name}`);
          ctx.cleanup.listen(remove, 'click', async () => {
            if (busy || dialog) return;
            dialog = openConfirmDialog({
              title: 'Remove label?', lead: `Remove “${label.name}”?`,
              detail: 'This also removes the label from every task in this project.', confirmLabel: 'Remove label',
              onConfirm: () => removeProjectLabel(project.id, label.id),
            });
            const removed = await dialog.result; dialog = null;
            if (!ctx.signal.aborted && removed) await load();
          });
          details.append(remove); li.append(details);
        }
        list.append(li);
      }
      content.append(list);
      status.textContent = labels.length ? '' : 'No labels in this project yet.';
      if (!ctx.query.label) return;
      const selected = labels.find((label) => label.id === ctx.query.label);
      if (!selected) { status.textContent = 'Label not found or no longer accessible.'; return; }
      const result = await listLabelTasks(selected.id, { page, signal: ctx.signal });
      if (ctx.signal.aborted || current !== generation) return;
      content.append(node('h2', `Tasks labelled “${selected.name}”`, 'h5 mt-4'));
      if (page > totalPages(result.total, LABEL_TASKS_PAGE_SIZE)) {
        content.append(link('Return to the first page', labelUrl(project.id, selected.id)));
        status.textContent = 'This page no longer has results.';
        return;
      }
      const tasks = node('ul', '', 'list-group');
      for (const task of result.rows) {
        const li = node('li', '', 'list-group-item');
        li.append(link(task.title, `/projects/${task.project_id}/tasks?task=${task.id}`),
          node('span', task.done ? ' · Done' : ' · Open', 'small text-body-secondary'));
        tasks.append(li);
      }
      content.append(tasks);
      if (!result.total) status.textContent = 'No accessible tasks have this label.';
      renderPager(pager, { page, total: result.total, pageSize: LABEL_TASKS_PAGE_SIZE });
    } catch (error) { if (current === generation) fail(error); }
    finally { if (current === generation) content.setAttribute('aria-busy', 'false'); }
  }
  load();
}
