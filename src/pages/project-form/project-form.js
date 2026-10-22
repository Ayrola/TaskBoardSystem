import html from './project-form.html?raw';
import './project-form.css';
import { renderFragment, setText } from '../../utils/render.js';
import { validateProjectTitle, validateProjectDescription } from '../../utils/validation.js';
import {
  createProject,
  getProject,
  updateProject,
  ProjectNotFoundError,
} from '../../services/projects-service.js';
import { showSuccess, TOAST_MESSAGES } from '../../services/toast-service.js';

// Serves both /projects/add and /projects/:id/edit.
export const title = ({ params }) => (params.id ? 'Edit project' : 'Add project');

const DISCARD_MESSAGE = 'You have unsaved changes. Discard them and leave this page?';

export function mount(container, ctx) {
  const { params } = ctx;
  const isEdit = Boolean(params.id);

  renderFragment(container, html);
  const root = container.querySelector('.page-project-form');
  const form = root.querySelector('form');
  const titleInput = form.elements.title;
  const descriptionInput = form.elements.description;
  const formError = root.querySelector('[data-form-error]');
  const submitButton = root.querySelector('[data-submit]');
  const spinner = root.querySelector('[data-submit-spinner]');
  const panels = root.querySelectorAll('[data-state]');

  setText(root, '[data-heading]', isEdit ? 'Edit project' : 'Add project');
  setText(root, '[data-submit-label]', isEdit ? 'Save changes' : 'Create project');

  let initial = { title: '', description: '' };
  let saving = false;
  let finished = false; // saved successfully: leaving is no longer "discarding"
  let loadId = 0;

  const show = (state) => {
    panels.forEach((panel) => { panel.hidden = panel.dataset.state !== state; });
    root.setAttribute('aria-busy', String(state === 'loading'));
  };

  const isDirty = () =>
    !finished &&
    (titleInput.value !== initial.title || descriptionInput.value !== initial.description);

  function setFieldError(name, message) {
    const input = form.elements[name];
    const box = root.querySelector(`[data-error-for="${name}"]`);
    box.textContent = message ?? '';
    input.classList.toggle('is-invalid', Boolean(message));
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function setFormError(message) {
    formError.textContent = message ?? '';
    formError.hidden = !message;
  }

  function setSaving(value) {
    saving = value;
    submitButton.disabled = value;
    spinner.hidden = !value;
    titleInput.readOnly = value;
    descriptionInput.readOnly = value;
    root.setAttribute('aria-busy', String(value));
  }

  function validate() {
    const titleError = validateProjectTitle(titleInput.value);
    const descriptionError = validateProjectDescription(descriptionInput.value);
    setFieldError('title', titleError);
    setFieldError('description', descriptionError);
    if (titleError) titleInput.focus();
    else if (descriptionError) descriptionInput.focus();
    return !titleError && !descriptionError;
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    setFormError(null);
    if (!validate()) return;

    const values = { title: titleInput.value, description: descriptionInput.value };
    setSaving(true);
    try {
      if (isEdit) {
        await updateProject(params.id, values);
        showSuccess(TOAST_MESSAGES.projectUpdated);
      } else {
        await createProject(values);
        showSuccess(TOAST_MESSAGES.projectCreated);
      }
      finished = true;
      if (!ctx.signal.aborted) ctx.navigate('/projects');
    } catch (error) {
      if (ctx.signal.aborted) return;
      // The form is never re-rendered, so everything the user typed is preserved.
      setFormError(
        error instanceof ProjectNotFoundError
          ? 'This project no longer exists or you no longer have access to it.'
          : error.message,
      );
      setSaving(false);
    }
  }

  async function loadProject() {
    const current = ++loadId;
    show('loading');
    try {
      const project = await getProject(params.id, { signal: ctx.signal });
      if (current !== loadId || ctx.signal.aborted) return;
      initial = { title: project.title, description: project.description };
      titleInput.value = initial.title;
      descriptionInput.value = initial.description;
      show('form');
    } catch (error) {
      if (current !== loadId || ctx.signal.aborted) return;
      if (error instanceof ProjectNotFoundError) {
        show('notfound');
      } else {
        setText(root, '[data-load-error]', error.message);
        show('error');
      }
    }
  }

  ctx.cleanup.listen(form, 'submit', onSubmit);
  ctx.cleanup.listen(titleInput, 'input', () => setFieldError('title', null));
  ctx.cleanup.listen(descriptionInput, 'input', () => setFieldError('description', null));
  ctx.cleanup.listen(root.querySelector('[data-retry]'), 'click', loadProject);

  // In-app navigation (links, Back/Forward) goes through the router guard; reload/close through beforeunload.
  ctx.setLeaveGuard(() => !isDirty() || window.confirm(DISCARD_MESSAGE));
  ctx.cleanup.listen(window, 'beforeunload', (event) => {
    if (isDirty()) event.preventDefault();
  });

  if (isEdit) loadProject();
  else show('form');
}
