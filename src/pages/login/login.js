import html from './login.html?raw';
import './login.css';
import { renderFragment, setText } from '../../utils/render.js';
import {
  validateEmail,
  validateLoginPassword,
  validateNewPassword,
  validatePasswordConfirmation,
} from '../../utils/validation.js';
import { signIn, signUp, describeAuthError, getAuthConfigError } from '../../services/auth-service.js';
import { safeReturnTo } from '../../router.js';

export const title = ({ query }) => (query.mode === 'register' ? 'Register' : 'Login');

// On success the router reacts to the auth state change and redirects, so this page never navigates.
export function mount(container, { query, signal, cleanup }) {
  renderFragment(container, html);

  const isRegister = query.mode === 'register';
  const returnTo = safeReturnTo(query.returnTo);

  const form = container.querySelector('[data-form]');
  const emailInput = form.elements.email;
  const passwordInput = form.elements.password;
  const confirmInput = form.elements.confirm;
  const alertBox = container.querySelector('[data-alert]');
  const confirmNotice = container.querySelector('[data-confirm-notice]');
  const submit = container.querySelector('[data-submit]');
  const spinner = container.querySelector('[data-spinner]');
  let busy = false;

  setText(container, '[data-heading]', isRegister ? 'Create your account' : 'Log in');
  setText(
    container,
    '[data-subheading]',
    isRegister ? 'Register with your email and a password.' : 'Welcome back. Log in to see your projects.',
  );
  setText(container, '[data-submit-label]', isRegister ? 'Register' : 'Log in');
  setText(container, '[data-switch-text]', isRegister ? 'Already have an account?' : 'New to Taskboard?');
  setText(container, '[data-switch-link]', isRegister ? 'Log in' : 'Register');

  const switchParams = new URLSearchParams();
  if (!isRegister) switchParams.set('mode', 'register');
  if (returnTo) switchParams.set('returnTo', returnTo);
  const switchQuery = switchParams.toString();
  container.querySelector('[data-switch-link]').href = switchQuery ? `/login?${switchQuery}` : '/login';

  passwordInput.autocomplete = isRegister ? 'new-password' : 'current-password';
  container.querySelector('[data-register-only]').hidden = !isRegister;

  const configError = getAuthConfigError();
  if (configError) {
    showAlert(configError);
    form.querySelectorAll('input, button').forEach((element) => (element.disabled = true));
  }

  function showAlert(message) {
    alertBox.textContent = message;
    alertBox.hidden = false;
  }

  function setFieldError(name, message) {
    const input = form.elements[name];
    const feedback = container.querySelector(`[data-error="${name}"]`);
    if (!input) return;
    input.classList.toggle('is-invalid', Boolean(message));
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    feedback.textContent = message ?? '';
  }

  function setBusy(value) {
    busy = value;
    submit.disabled = value || Boolean(configError);
    spinner.hidden = !value;
    form.setAttribute('aria-busy', String(value));
  }

  function validate() {
    const password = passwordInput.value;
    const errors = {
      email: validateEmail(emailInput.value),
      password: isRegister ? validateNewPassword(password) : validateLoginPassword(password),
      confirm: isRegister ? validatePasswordConfirmation(password, confirmInput.value) : null,
    };
    for (const [name, message] of Object.entries(errors)) setFieldError(name, message);
    const firstInvalid = Object.keys(errors).find((name) => errors[name]);
    if (firstInvalid) form.elements[firstInvalid].focus();
    return !firstInvalid;
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    alertBox.hidden = true;
    confirmNotice.hidden = true;
    if (!validate()) return;

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    setBusy(true);
    const result = isRegister ? await signUp(email, password) : await signIn(email, password);

    // Never keep the password in the DOM after the request has been sent.
    passwordInput.value = '';
    if (confirmInput) confirmInput.value = '';

    // The page was left (navigation, logout or account change): drop the stale result.
    if (signal.aborted) return;
    setBusy(false);

    if (result.error) {
      showAlert(describeAuthError(result.error));
      passwordInput.focus();
      return;
    }
    if (isRegister && result.needsConfirmation) {
      form.hidden = true;
      confirmNotice.hidden = false;
    }
    // With a session, the router's auth listener performs the redirect.
  }

  cleanup.listen(form, 'submit', onSubmit);
  for (const input of form.querySelectorAll('input')) {
    cleanup.listen(input, 'input', () => setFieldError(input.name, null));
  }
}
