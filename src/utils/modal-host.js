import Modal from 'bootstrap/js/dist/modal';
import { renderFragment } from './render.js';

// Owns the lifecycle of one Bootstrap modal built from a static HTML fragment:
// it is appended to <body> on creation and, however it ends, its Bootstrap instance, listeners
// and DOM are all released exactly once.
//
// - Add listeners with `{ signal }`; they are removed automatically when the modal is released.
// - `close(value)` hides the modal; `result` then resolves with `value`.
// - Any other dismissal (Escape, close button, Cancel with data-bs-dismiss) resolves `dismissedValue`.
// - `setCanClose(fn)` lets the owner block dismissal while a request is running.
// - `destroy()` is for page unmount: it removes everything immediately, backdrop included.
export function mountModal(html, { backdrop = true, dismissedValue = null, onRelease } = {}) {
  const host = document.createElement('div');
  renderFragment(host, html);
  const element = host.firstElementChild;
  document.body.append(element);

  const modal = new Modal(element, { backdrop });
  const listeners = new AbortController();
  const { signal } = listeners;
  let outcome = dismissedValue;
  let released = false;
  let canClose = () => true;
  let resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });

  function release() {
    if (released) return false;
    released = true;
    onRelease?.();
    listeners.abort();
    return true;
  }

  element.addEventListener('hide.bs.modal', (event) => {
    if (!canClose()) event.preventDefault();
  }, { signal });

  // 'hidden' fires after the hide transition, so disposing here is safe.
  element.addEventListener('hidden.bs.modal', () => {
    if (!release()) return;
    modal.dispose();
    element.remove();
    resolveResult(outcome);
  }, { signal });

  return {
    element,
    signal,
    result,
    show: () => modal.show(),
    setCanClose(fn) { canClose = fn; },
    close(value) {
      outcome = value;
      canClose = () => true;
      modal.hide();
    },
    destroy() {
      if (!release()) return;
      element.remove();
      // Disposing mid-transition makes Bootstrap's pending callback throw, so defer it.
      setTimeout(() => modal.dispose(), 500);
      document.querySelectorAll('.modal-backdrop').forEach((node) => node.remove());
      document.body.classList.remove('modal-open');
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('padding-right');
      resolveResult(dismissedValue);
    },
  };
}
