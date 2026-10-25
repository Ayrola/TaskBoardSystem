import '../task-dialog.css';
import html from './add-stage-modal.html?raw';
import { mountModal } from '../../utils/modal-host.js';
import { STAGE_NAME_MAX } from '../../services/stages-service.js';

export function openAddStageModal({ stages, onSave }) {
  const modal = mountModal(html, { dismissedValue: false });
  const { element, signal } = modal;
  const form = element.querySelector('form');
  const name = form.elements.name;
  const error = element.querySelector('[data-error]');
  const submit = element.querySelector('[data-submit]');
  let saving = false;
  modal.setCanClose(() => !saving);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;
    const value = name.value.trim();
    const message = !value ? 'Enter a stage name.'
      : [...value].length > STAGE_NAME_MAX ? 'Name must be at most 100 characters.'
        : stages.some(stage => stage.name.trim().toLowerCase() === value.toLowerCase()) ? 'A stage with this name already exists in this project.' : '';
    error.textContent = message;
    error.hidden = !message;
    name.setAttribute('aria-invalid', String(Boolean(message)));
    if (message) { name.focus(); return; }
    saving = true;
    element.setAttribute('aria-busy', 'true');
    submit.textContent = 'Adding…';
    form.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
    try {
      await onSave({ name: value, isDone: form.elements.isDone.checked });
      if (!signal.aborted) modal.close(true);
    } catch (failure) {
      if (!signal.aborted) {
        error.textContent = failure.message;
        error.hidden = false;
      }
    } finally {
      saving = false;
      element.setAttribute('aria-busy', 'false');
      submit.textContent = 'Add Stage';
      form.querySelectorAll('button, input').forEach(control => { control.disabled = false; });
      if (!signal.aborted && !error.hidden) name.focus();
    }
  }, { signal });
  element.addEventListener('shown.bs.modal', () => name.focus(), { signal });
  modal.show();
  return { result: modal.result, destroy: modal.destroy };
}
