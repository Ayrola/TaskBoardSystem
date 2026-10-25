import Toast from 'bootstrap/js/dist/toast';

// Reusable toast notifications built on Bootstrap's Toast component.
// Callers pass short, human-readable text. Messages are rendered with textContent only,
// and anything that looks like a credential is redacted before display.

const MAX_LENGTH = 200;
const MAX_VISIBLE = 4;
const SUCCESS_DELAY_MS = 5000;
const INFO_DELAY_MS = 6000;

const TYPES = {
  error: { icon: 'bi-exclamation-octagon-fill', color: 'danger', live: 'assertive', fallback: 'Something went wrong. Please try again.' },
  success: { icon: 'bi-check-circle-fill', color: 'success', live: 'polite', fallback: 'Done.' },
  info: { icon: 'bi-info-circle-fill', color: 'primary', live: 'polite', fallback: 'Notice.' },
};

// Wording for the significant mutations, so every screen says the same thing.
export const TOAST_MESSAGES = {
  projectCreated: 'Project created.',
  projectUpdated: 'Project saved.',
  projectDeleted: 'Project deleted.',
  taskDeleted: 'Task deleted.',
  taskSaved: 'Task saved.',
  uploadCompleted: 'Upload completed.',
};

const REDACTIONS = [
  /eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g, // JWTs
  /\bBearer\s+[\w.~+/=-]+/gi,
  /\bsb_(?:publishable|secret)_[\w-]+/gi,
  /\b(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|password|secret|authorization)\s*[=:]\s*\S+/gi,
  /\b[A-Za-z0-9_-]{32,}\b/g, // long opaque strings: keys, hashes, ids
];

// Exported so other code and tests can reuse the same rules.
export function sanitizeMessage(message, fallback = TYPES.error.fallback) {
  if (typeof message !== 'string') return fallback;
  let text = message;
  for (const pattern of REDACTIONS) text = text.replace(pattern, '[hidden]');
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
}

const regions = { assertive: null, polite: null };
const active = new Map(); // dedupe key -> { element, toast }

// The live regions must exist before content is added, or screen readers may stay silent.
export function initToasts() {
  const host = document.getElementById('toast-host') ?? createHost();
  regions.assertive = host.querySelector('[data-toast-region="assertive"]');
  regions.polite = host.querySelector('[data-toast-region="polite"]');
}

function createHost() {
  const host = document.createElement('section');
  host.id = 'toast-host';
  host.className = 'toast-host position-fixed top-0 end-0 p-3';
  host.setAttribute('aria-label', 'Notifications');
  for (const live of ['assertive', 'polite']) {
    const region = document.createElement('div');
    region.className = 'toast-container d-flex flex-column gap-2 position-static';
    region.dataset.toastRegion = live;
    region.setAttribute('aria-live', live);
    region.setAttribute('aria-relevant', 'additions');
    host.append(region);
  }
  document.body.append(host);
  return host;
}

function buildToast(type, text) {
  const { icon, color, live } = TYPES[type];
  const element = document.createElement('div');
  element.className = `toast align-items-center border-0 text-bg-${color}`;
  element.setAttribute('role', live === 'assertive' ? 'alert' : 'status');
  element.setAttribute('aria-live', live);
  element.setAttribute('aria-atomic', 'true');

  const layout = document.createElement('div');
  layout.className = 'd-flex';

  const body = document.createElement('div');
  body.className = 'toast-body d-flex align-items-start gap-2';
  const iconElement = document.createElement('i');
  iconElement.className = `bi ${icon} flex-shrink-0`;
  iconElement.setAttribute('aria-hidden', 'true');
  const message = document.createElement('span');
  message.textContent = text;
  body.append(iconElement, message);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn-close btn-close-white me-2 m-auto';
  close.setAttribute('data-bs-dismiss', 'toast');
  close.setAttribute('aria-label', 'Close notification');

  layout.append(body, close);
  element.append(layout);
  return element;
}

function removeEntry(key) {
  const entry = active.get(key);
  if (!entry) return;
  active.delete(key);
  entry.element.remove();
  // Disposing mid-transition makes Bootstrap's pending callback throw, so defer it.
  setTimeout(() => entry.toast.dispose(), 500);
}

function show(type, message, options = {}) {
  if (!regions.polite) initToasts();

  const text = sanitizeMessage(message, TYPES[type].fallback);
  // One failed action should produce one toast: identical messages (or the same explicit key) collapse.
  const key = options.key ?? `${type}:${text}`;
  if (active.has(key)) return;

  while (active.size >= MAX_VISIBLE) removeEntry(active.keys().next().value);

  const element = buildToast(type, text);
  const autohide = type !== 'error'; // errors stay until the user closes them
  const delay = type === 'success' ? SUCCESS_DELAY_MS : INFO_DELAY_MS;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const toast = new Toast(element, { autohide, delay, animation: !reduceMotion });

  element.addEventListener('hidden.bs.toast', () => removeEntry(key), { once: true });

  active.set(key, { element, toast });
  regions[TYPES[type].live].append(element);
  toast.show();
}

export const showError = (message, options) => show('error', message, options);
export const showSuccess = (message, options) => show('success', message, options);
export const showInfo = (message, options) => show('info', message, options);

// Used when the signed-in user changes so one user's messages are not shown to the next.
export function clearToasts() {
  for (const key of [...active.keys()]) removeEntry(key);
}
