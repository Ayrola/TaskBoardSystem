import { renderPriority } from '../../components/task-priority/task-priority.js';
import { renderTaskDeadline } from '../../utils/deadlines.js';
import html from './admin-task.html?raw';
import { renderFragment, setText } from '../../utils/render.js';
import { richTextToFragment } from '../../utils/sanitize.js';
import { formatDateTime } from '../../utils/dates.js';
import {
  AdminNotFoundError,
  getAdminProject,
  getAdminTask,
  listAllProjectStages,
} from '../../services/admin-service.js';
import { deleteTask, saveTaskForm, TaskNotFoundError } from '../../services/tasks-service.js';
import { openConfirmDialog } from '../../components/confirm-dialog/confirm-dialog.js';
import { openTaskFormModal } from '../../components/task-form-modal/task-form-modal.js';
import { showSuccess, showInfo } from '../../services/toast-service.js';
import { createStates, describeLoadError } from './admin-common.js';

// Serves /admin/tasks/:id (details) and /admin/tasks/:id/edit (the shared task editor in a modal).
export const title = ({ path }) => (path.endsWith('/edit') ? 'Admin · Edit task' : 'Admin · Task');

export function mount(container, ctx) {
  const isEdit = ctx.path.endsWith('/edit');
  const id = ctx.params.id;
  const base = `/admin/tasks/${encodeURIComponent(id)}`;

  renderFragment(container, html);
  const root = container.querySelector('.page-admin-task');
  const show = createStates(root);
  let task = null;
  let loadId = 0;
  let dialog = null;
  let editor = null;
  ctx.setLeaveGuard(() => editor?.canLeave?.() ?? true);

  function setLink(selector, href, label) {
    const link = root.querySelector(selector);
    link.href = href;
    if (label !== undefined) link.textContent = label;
  }

  async function openEditor(stages) {
    editor = openTaskFormModal({
      mode: 'edit',
      projectId: task.projectId,
      stages: stages.map((stage) => ({ id: stage.id, name: stage.name })),
      task: { id: task.id, title: task.title, description: task.description, stageId: task.stageId, priority: task.priority, dueAt: task.dueAt },
      onSubmit: async (values) => {
        try {
          await saveTaskForm({projectId:task.projectId,taskId:task.id,...values});
        } catch (error) {
          if (error instanceof TaskNotFoundError) throw new Error('This task no longer exists.');
          throw error;
        }
      },
    });
    const saved = await editor.result;
    editor = null;
    if (ctx.signal.aborted) return;
    if (saved) showSuccess('Task saved.');
    ctx.navigate(base, { replace: true });
  }

  async function load() {
    const current = ++loadId;
    show('loading');
    try {
      const loaded = await getAdminTask(id, { signal: ctx.signal });
      const [project, stages] = await Promise.all([
        getAdminProject(loaded.projectId, { signal: ctx.signal }),
        listAllProjectStages(loaded.projectId, { signal: ctx.signal }),
      ]);
      if (current !== loadId || ctx.signal.aborted) return;
      task = loaded;
      const stage = stages.find((item) => item.id === task.stageId);
      const projectBase = `/admin/projects/${encodeURIComponent(task.projectId)}`;

      setLink('[data-crumb-project]', projectBase, project.title);
      setLink('[data-crumb-tasks]', `${projectBase}/tasks`);
      setText(root, '[data-crumb]', task.title);

      if (isEdit) {
        show('editing');
        openEditor(stages);
        return;
      }

      setText(root, '[data-title]', task.title);
      setLink('[data-link="project"]', projectBase, project.title);
      setLink('[data-link="stage"]', `/admin/stages/${encodeURIComponent(task.stageId)}`, stage?.name ?? 'Stage');
      const status = setText(root, '[data-field="status"]', task.done ? 'Done' : 'Open');
      status.classList.add(task.done ? 'text-bg-success' : 'text-bg-secondary');
      renderTaskDeadline(root.querySelector('[data-deadline]'), task);
      renderPriority(root.querySelector('[data-admin-priority]'), task.priority);
      setText(root, '[data-field="position"]', task.position + 1);
      setText(root, '[data-field="created"]', formatDateTime(task.createdAt));
      setText(root, '[data-field="updated"]', formatDateTime(task.updatedAt));
      const description = root.querySelector('[data-field="description"]');
      // The description is sanitized and appended as DOM nodes; stored HTML is never assigned to innerHTML.
      if (task.description) description.replaceChildren(richTextToFragment(task.description));
      else description.textContent = '—';
      setLink('[data-link="edit"]', `${base}/edit`);
      show('details');
    } catch (error) {
      if (current !== loadId || ctx.signal.aborted) return;
      if (error instanceof AdminNotFoundError) {
        show('notfound');
      } else {
        setText(root, '[data-error-text]', describeLoadError(error));
        show('error');
      }
    }
  }

  async function confirmDelete(trigger) {
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
    if (deleted) ctx.navigate(`/admin/projects/${encodeURIComponent(task.projectId)}/tasks`);
    else trigger.focus();
  }

  ctx.cleanup.listen(root.querySelector('[data-delete]'), 'click', (event) => {
    if (task && !dialog) confirmDelete(event.currentTarget);
  });
  ctx.cleanup.listen(root.querySelector('[data-retry]'), 'click', load);
  ctx.cleanup.add(() => {
    dialog?.destroy();
    editor?.destroy();
  });
  load();
}
