import html from './admin-project.html?raw';
import { renderFragment, setText } from '../../utils/render.js';
import { formatDateTime } from '../../utils/dates.js';
import { validateProjectTitle, validateProjectDescription } from '../../utils/validation.js';
import { getAdminProject, AdminNotFoundError } from '../../services/admin-service.js';
import { updateProject, deleteProject, ProjectNotFoundError } from '../../services/projects-service.js';
import { openConfirmDialog } from '../../components/confirm-dialog/confirm-dialog.js';
import { showSuccess, showInfo, TOAST_MESSAGES } from '../../services/toast-service.js';
import { createStates, describeLoadError } from './admin-common.js';

// Serves /admin/projects/:id (details) and /admin/projects/:id/edit.
export const title = ({ path }) => (path.endsWith('/edit') ? 'Admin · Edit project' : 'Admin · Project');

const DISCARD_MESSAGE = 'You have unsaved changes. Discard them and leave this page?';

export function mount(container, ctx) {
  const isEdit = ctx.path.endsWith('/edit');
  const id = ctx.params.id;
  const base = `/admin/projects/${encodeURIComponent(id)}`;

  renderFragment(container, html);
  const root = container.querySelector('.page-admin-project');
  const show = createStates(root);
  const form = root.querySelector('form');
  const formError = root.querySelector('[data-form-error]');
  const submitButton = root.querySelector('[data-submit]');
  const spinner = root.querySelector('[data-spinner]');
  let project = null;
  let loadId = 0;
  let saving = false;
  let finished = false;
  let dialog = null;

  const isDirty = () =>
    isEdit && !finished && project &&
    (form.elements.title.value !== project.title || form.elements.description.value !== project.description);

  function setFieldError(name, message) {
    const input = form.elements[name];
    setText(root, `[data-error-for="${name}"]`, message ?? '');
    input.classList.toggle('is-invalid', Boolean(message));
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function setSaving(value) {
    saving = value;
    submitButton.disabled = value;
    spinner.hidden = !value;
    form.elements.title.readOnly = value;
    form.elements.description.readOnly = value;
    root.setAttribute('aria-busy', String(value));
  }

  function fill() {
    setText(root, '[data-crumb]', project.title);
    root.querySelector('[data-link="cancel"]').href = base;
    if (isEdit) {
      form.elements.title.value = project.title;
      form.elements.description.value = project.description;
      show('form');
      return;
    }
    setText(root, '[data-title]', project.title);
    setText(root, '[data-field="description"]', project.description || '—');
    setText(root, '[data-field="owner"]', project.ownerLabel);
    setText(root, '[data-field="created"]', formatDateTime(project.createdAt));
    setText(root, '[data-field="updated"]', formatDateTime(project.updatedAt));
    setText(root, '[data-field="stages"]', project.stageCount.toLocaleString());
    setText(root, '[data-field="tasks"]', project.taskCount.toLocaleString());
    root.querySelector('[data-link="edit"]').href = `${base}/edit`;
    root.querySelector('[data-link="stages"]').href = `${base}/stages`;
    root.querySelector('[data-link="tasks"]').href = `${base}/tasks`;
    root.querySelector('[data-link="board"]').href = `/projects/${encodeURIComponent(id)}/tasks`;
    show('details');
  }

  async function load() {
    const current = ++loadId;
    show('loading');
    try {
      const loaded = await getAdminProject(id, { signal: ctx.signal });
      if (current !== loadId || ctx.signal.aborted) return;
      project = loaded;
      fill();
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

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    formError.hidden = true;
    const titleError = validateProjectTitle(form.elements.title.value);
    const descriptionError = validateProjectDescription(form.elements.description.value);
    setFieldError('title', titleError);
    setFieldError('description', descriptionError);
    if (titleError) return form.elements.title.focus();
    if (descriptionError) return form.elements.description.focus();

    setSaving(true);
    try {
      await updateProject(id, { title: form.elements.title.value, description: form.elements.description.value });
      showSuccess(TOAST_MESSAGES.projectUpdated);
      finished = true;
      if (!ctx.signal.aborted) ctx.navigate(base);
    } catch (error) {
      if (ctx.signal.aborted) return;
      formError.textContent = error instanceof ProjectNotFoundError
        ? 'This project no longer exists or you no longer have access to it.'
        : error.message;
      formError.hidden = false;
      setSaving(false);
    }
  }

  async function confirmDelete(trigger) {
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
    if (deleted) ctx.navigate('/admin/projects');
    else trigger.focus();
  }

  ctx.cleanup.listen(form, 'submit', onSubmit);
  ctx.cleanup.listen(form.elements.title, 'input', () => setFieldError('title', null));
  ctx.cleanup.listen(form.elements.description, 'input', () => setFieldError('description', null));
  ctx.cleanup.listen(root.querySelector('[data-delete]'), 'click', (event) => {
    if (project && !dialog) confirmDelete(event.currentTarget);
  });
  ctx.cleanup.listen(root.querySelector('[data-retry]'), 'click', load);
  ctx.cleanup.add(() => dialog?.destroy());

  ctx.setLeaveGuard(() => !isDirty() || window.confirm(DISCARD_MESSAGE));
  ctx.cleanup.listen(window, 'beforeunload', (event) => {
    if (isDirty()) event.preventDefault();
  });
  load();
}
