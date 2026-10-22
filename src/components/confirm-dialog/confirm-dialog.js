import Modal from 'bootstrap/js/dist/modal';
import html from './confirm-dialog.html?raw';
import './confirm-dialog.css';
import { renderFragment, setText } from '../../utils/render.js';

// Opens a destructive-action confirmation. `onConfirm` is async; the dialog stays open and shows
// an inline error if it throws. `result` resolves true after a successful confirm, false otherwise.
// Call `destroy()` when the owning page unmounts so no dialog or backdrop is left behind.
export function openConfirmDialog({ title, lead, detail, confirmLabel = 'Delete', onConfirm }) {
  const host = document.createElement('div');
  renderFragment(host, html);
  const element = host.firstElementChild;
  document.body.append(element);

  setText(element, '[data-dialog-title]', title);
  setText(element, '[data-dialog-detail]', detail);
  setText(element, '[data-dialog-confirm-label]', confirmLabel);
  // The lead text can contain the (user-supplied) project name, so it is set as text only.
  setText(element, '[data-dialog-lead]', lead);

  const confirmButton = element.querySelector('[data-dialog-confirm]');
  const cancelButtons = element.querySelectorAll('[data-bs-dismiss]');
  const spinner = element.querySelector('[data-dialog-spinner]');
  const errorBox = element.querySelector('[data-dialog-error]');
  const modal = new Modal(element, { backdrop: 'static' });
  let busy = false;
  let confirmed = false;
  let destroyed = false;
  let destroy = () => {};
  const result = new Promise((resolve) => {
    const finish = () => {
      if (destroyed) return;
      destroyed = true;
      modal.dispose();
      element.remove();
      resolve(confirmed);
    };

    // Escape and the close button are ignored while the request is running.
    element.addEventListener('hide.bs.modal', (event) => {
      if (busy) event.preventDefault();
    });
    element.addEventListener('hidden.bs.modal', finish);
    element.addEventListener('shown.bs.modal', () => element.querySelector('[data-dialog-cancel]')?.focus());

    confirmButton.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      errorBox.hidden = true;
      confirmButton.disabled = true;
      spinner.hidden = false;
      cancelButtons.forEach((button) => { button.disabled = true; });
      try {
        await onConfirm();
        confirmed = true;
        busy = false;
        modal.hide();
      } catch (error) {
        busy = false;
        errorBox.textContent = error?.message || 'Something went wrong. Please try again.';
        errorBox.hidden = false;
        confirmButton.disabled = false;
        spinner.hidden = true;
        cancelButtons.forEach((button) => { button.disabled = false; });
      }
    });

    destroy = () => {
      busy = false;
      if (destroyed) return;
      destroyed = true;
      element.remove();
      // Disposing mid-transition makes Bootstrap's pending callback throw, so defer it.
      setTimeout(() => modal.dispose(), 500);
      document.querySelectorAll('.modal-backdrop').forEach((node) => node.remove());
      document.body.classList.remove('modal-open');
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('padding-right');
      resolve(false);
    };
  });

  modal.show();
  return { result, destroy: () => destroy() };
}
