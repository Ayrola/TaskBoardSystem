import html from './admin-stage.html?raw';
import { renderFragment, setText } from '../../utils/render.js';
import { AdminNotFoundError, getAdminProject, getAdminStage, updateStage, STAGE_NAME_MAX } from '../../services/admin-service.js';
import { showSuccess } from '../../services/toast-service.js';
import { createStates, describeLoadError, openStageDeleteDialog } from './admin-common.js';

// Serves /admin/stages/:id (details) and /admin/stages/:id/edit.
export const title = ({ path }) => (path.endsWith('/edit') ? 'Admin · Edit stage' : 'Admin · Stage');

const DISCARD_MESSAGE = 'You have unsaved changes. Discard them and leave this page?';

export function mount(container, ctx) {
  const isEdit = ctx.path.endsWith('/edit');
  const id = ctx.params.id;
  const base = `/admin/stages/${encodeURIComponent(id)}`;

  renderFragment(container, html);
  const root = container.querySelector('.page-admin-stage');
  const show = createStates(root);
  const form = root.querySelector('form');
  const formError = root.querySelector('[data-form-error]');
  const submitButton = root.querySelector('[data-submit]');
  const spinner = root.querySelector('[data-spinner]');
  let stage = null;
  let loadId = 0;
  let saving = false;
  let finished = false;
  let dialog = null;
  let preparing = false;

  const isDirty = () =>
    isEdit && !finished && stage &&
    (form.elements.name.value !== stage.name || form.elements.isDone.checked !== stage.isDone);

  function setNameError(message) {
    const input = form.elements.name;
    setText(root, '[data-error-for="name"]', message ?? '');
    input.classList.toggle('is-invalid', Boolean(message));
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function setSaving(value) {
    saving = value;
    submitButton.disabled = value;
    spinner.hidden = !value;
    form.elements.name.readOnly = value;
    form.elements.isDone.disabled = value;
    root.setAttribute('aria-busy', String(value));
  }

  function fill(project) {
    root.querySelector('[data-crumb-project]').href = `/admin/projects/${encodeURIComponent(stage.projectId)}`;
    setText(root, '[data-crumb-project]', project.title);
    root.querySelector('[data-crumb-stages]').href = `/admin/projects/${encodeURIComponent(stage.projectId)}/stages`;
    setText(root, '[data-crumb]', stage.name);
    root.querySelector('[data-link="cancel"]').href = base;
    if (isEdit) {
      form.elements.name.value = stage.name;
      form.elements.isDone.checked = stage.isDone;
      show('form');
      return;
    }
    setText(root, '[data-title]', stage.name);
    const projectLink = root.querySelector('[data-link="project"]');
    projectLink.href = `/admin/projects/${encodeURIComponent(stage.projectId)}`;
    projectLink.textContent = project.title;
    setText(root, '[data-field="position"]', stage.position + 1);
    setText(root, '[data-field="done"]', stage.isDone ? 'Yes' : 'No');
    setText(root, '[data-field="tasks"]', stage.taskCount.toLocaleString());
    root.querySelector('[data-link="edit"]').href = `${base}/edit`;
    show('details');
  }

  async function load() {
    const current = ++loadId;
    show('loading');
    try {
      const loaded = await getAdminStage(id, { signal: ctx.signal });
      const project = await getAdminProject(loaded.projectId, { signal: ctx.signal });
      if (current !== loadId || ctx.signal.aborted) return;
      stage = loaded;
      fill(project);
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
    const name = form.elements.name.value.trim();
    const nameError = !name ? 'Enter a stage name.' : name.length > STAGE_NAME_MAX ? `Name must be at most ${STAGE_NAME_MAX} characters.` : null;
    setNameError(nameError);
    if (nameError) return form.elements.name.focus();

    setSaving(true);
    try {
      await updateStage(id, { name, isDone: form.elements.isDone.checked });
      showSuccess('Stage saved.');
      finished = true;
      if (!ctx.signal.aborted) ctx.navigate(base);
    } catch (error) {
      if (ctx.signal.aborted) return;
      formError.textContent = error instanceof AdminNotFoundError ? 'This stage no longer exists.' : error.message;
      formError.hidden = false;
      setSaving(false);
    }
  }

  async function confirmDelete(trigger) {
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
      ctx.navigate(`/admin/projects/${encodeURIComponent(stage.projectId)}/stages`);
    } else {
      trigger.focus();
    }
  }

  ctx.cleanup.listen(form, 'submit', onSubmit);
  ctx.cleanup.listen(form.elements.name, 'input', () => setNameError(null));
  ctx.cleanup.listen(root.querySelector('[data-delete]'), 'click', (event) => {
    if (stage && !dialog && !preparing) confirmDelete(event.currentTarget);
  });
  ctx.cleanup.listen(root.querySelector('[data-retry]'), 'click', load);
  ctx.cleanup.add(() => dialog?.destroy());

  ctx.setLeaveGuard(() => !isDirty() || window.confirm(DISCARD_MESSAGE));
  ctx.cleanup.listen(window, 'beforeunload', (event) => {
    if (isDirty()) event.preventDefault();
  });
  load();
}
