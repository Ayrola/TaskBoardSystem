import html from './admin-user.html?raw';
import { renderFragment, setText } from '../../utils/render.js';
import { formatDateTime } from '../../utils/dates.js';
import { validateEmail } from '../../utils/validation.js';
import { AdminNotFoundError } from '../../services/admin-service.js';
import { getAdminUser, updateAdminUser, USER_DISPLAY_NAME_MAX } from '../../services/admin-users-service.js';
import { showSuccess, showInfo } from '../../services/toast-service.js';
import { createStates, describeLoadError } from './admin-common.js';
import { runUserDeletion, userLabel } from './admin-user-delete.js';

// Serves /admin/users/:id (details) and /admin/users/:id/edit.
export const title = ({ path }) => (path.endsWith('/edit') ? 'Admin · Edit user' : 'Admin · User');

const DISCARD_MESSAGE = 'You have unsaved changes. Discard them and leave this page?';

export function mount(container, ctx) {
  const isEdit = ctx.path.endsWith('/edit');
  const id = ctx.params.id;
  const base = `/admin/users/${encodeURIComponent(id)}`;

  renderFragment(container, html);
  const root = container.querySelector('.page-admin-user');
  const show = createStates(root);
  const form = root.querySelector('form');
  const formError = root.querySelector('[data-form-error]');
  const submitButton = root.querySelector('[data-submit]');
  const spinner = root.querySelector('[data-spinner]');
  let user = null;
  let loadId = 0;
  let saving = false;
  let finished = false;
  let dialog = null;

  const isDirty = () =>
    isEdit && !finished && user &&
    (form.elements.displayName.value !== user.displayName || form.elements.email.value !== user.email);

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
    form.elements.displayName.readOnly = value;
    form.elements.email.readOnly = value;
    root.setAttribute('aria-busy', String(value));
  }

  function fill() {
    setText(root, '[data-crumb]', userLabel(user));
    root.querySelector('[data-link="cancel"]').href = base;
    if (isEdit) {
      form.elements.displayName.value = user.displayName;
      form.elements.email.value = user.email;
      show('form');
      return;
    }
    setText(root, '[data-title]', userLabel(user));
    setText(root, '[data-field="name"]', user.displayName || '—');
    setText(root, '[data-field="email"]', user.email ? `${user.email}${user.emailConfirmed ? '' : ' (unconfirmed)'}` : '—');
    setText(root, '[data-field="role"]', user.role);
    setText(root, '[data-field="status"]', user.banned ? 'Sign-in disabled' : 'Active');
    setText(root, '[data-field="created"]', user.createdAt ? formatDateTime(user.createdAt) : '—');
    setText(root, '[data-field="signin"]', user.lastSignInAt ? formatDateTime(user.lastSignInAt) : 'Never');
    root.querySelector('[data-link="edit"]').href = `${base}/edit`;
    show('details');
  }

  async function load() {
    const current = ++loadId;
    show('loading');
    try {
      const loaded = await getAdminUser(id, { signal: ctx.signal });
      if (current !== loadId || ctx.signal.aborted) return;
      user = loaded;
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

  function validateName(value) {
    const name = value.trim();
    // eslint-disable-next-line no-control-regex
    if (!name || name.length > USER_DISPLAY_NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) {
      return `Enter a display name of up to ${USER_DISPLAY_NAME_MAX} characters.`;
    }
    return null;
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    formError.hidden = true;
    const nameError = validateName(form.elements.displayName.value);
    const emailError = validateEmail(form.elements.email.value);
    setFieldError('displayName', nameError);
    setFieldError('email', emailError);
    if (nameError) return form.elements.displayName.focus();
    if (emailError) return form.elements.email.focus();

    setSaving(true);
    try {
      const result = await updateAdminUser(id, {
        displayName: form.elements.displayName.value,
        email: form.elements.email.value,
      });
      if (result.changed) showSuccess('User updated.');
      else showInfo('No changes to save.');
      finished = true;
      if (!ctx.signal.aborted) ctx.navigate(base);
    } catch (error) {
      if (ctx.signal.aborted) return;
      if (error.code === 'email_taken') setFieldError('email', error.message);
      formError.textContent = error instanceof AdminNotFoundError ? 'This user no longer exists.' : error.message;
      formError.hidden = false;
      setSaving(false);
    }
  }

  ctx.cleanup.listen(form, 'submit', onSubmit);
  ctx.cleanup.listen(form.elements.displayName, 'input', () => setFieldError('displayName', null));
  ctx.cleanup.listen(form.elements.email, 'input', () => setFieldError('email', null));
  ctx.cleanup.listen(root.querySelector('[data-delete]'), 'click', async (event) => {
    if (!user || dialog) return;
    const trigger = event.currentTarget;
    trigger.disabled = true;
    const deleted = await runUserDeletion(user, { signal: ctx.signal, onDialog: (d) => { dialog = d; } });
    dialog = null;
    if (ctx.signal.aborted) return;
    trigger.disabled = false;
    if (deleted) ctx.navigate('/admin/users');
    else trigger.focus();
  });
  ctx.cleanup.listen(root.querySelector('[data-retry]'), 'click', load);
  ctx.cleanup.add(() => dialog?.destroy());

  ctx.setLeaveGuard(() => !isDirty() || window.confirm(DISCARD_MESSAGE));
  ctx.cleanup.listen(window, 'beforeunload', (event) => {
    if (isDirty()) event.preventDefault();
  });
  load();
}
