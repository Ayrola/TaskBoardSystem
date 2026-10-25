import { mountDeadlinePicker } from '../deadline-picker/deadline-picker.js';
import '../task-dialog.css';
import { browserTimezone, toLocalDeadlineInput, deadlineFromEditor } from '../../utils/deadlines.js';
import { createTaskDescriptionEditor } from '../task-description-editor.js';
import html from './task-form-modal.html?raw';
import './task-form-modal.css';
import { mountModal } from '../../utils/modal-host.js';
import { setText } from '../../utils/render.js';
import { sanitizeRichText, RICH_TEXT_MAX_LENGTH } from '../../utils/sanitize.js';
import { validateTaskTitle, validateTaskStage } from '../../utils/validation.js';

// Opens the add/edit task modal.
//   mode:      'add' | 'edit'
//   stages:    [{ id, name }] in board order
//   stageId:   preselected stage (add) — edit uses task.stageId
//   task:      { id, title, description, stageId } when editing
//   onSubmit:  async ({ title, stageId, description }) => void; throw an Error to show its message in the form
// Returns { result, destroy }. `result` resolves true when saved, false when cancelled or dismissed.
export function openTaskFormModal({ mode, stages, stageId, task, onSubmit }) {
  const isEdit = mode === 'edit';
  const modal = mountModal(html, { backdrop: 'static', dismissedValue: false });
  const { element, signal } = modal;

  const form = element.querySelector('form');
  const titleInput = form.elements.title;
  const stageSelect = form.elements.stage;
  const deadlineInput = form.elements.deadline;
  deadlineInput.value = toLocalDeadlineInput(task?.dueAt);
  setText(element, '[data-deadline-help]', `Local time (${browserTimezone()}). Repeated times when clocks go back use the first occurrence; unchanged deadlines keep their original instant.`);
  const deadlinePicker = mountDeadlinePicker(deadlineInput, { signal, onChange: () => setFieldError('deadline', null) });
  const formError = element.querySelector('[data-form-error]');
  const submitButton = element.querySelector('[data-submit]');
  const cancelButton = element.querySelector('[data-cancel]');
  const closeButton = element.querySelector('.btn-close');
  const spinner = element.querySelector('[data-spinner]');

  setText(element, '[data-modal-title]', isEdit ? 'Edit task' : 'Add task');
  setText(element, '[data-submit-label]', isEdit ? 'Save changes' : 'Add task');

  const initialStageId = isEdit ? task.stageId : (stageId ?? stages[0]?.id);
  stageSelect.append(
    ...stages.map((stage) => {
      const option = document.createElement('option');
      option.value = stage.id;
      option.textContent = stage.name;
      return option;
    }),
  );
  stageSelect.value = initialStageId;

  const stageHint = element.querySelector('[data-stage-hint]');
  if (isEdit) titleInput.value = task.title;
  const updateStageHint = () => { stageHint.hidden = !isEdit || stageSelect.value === initialStageId; };
  updateStageHint();

  // The toolbar is created by Quill inside the same wrapper as the editor element.
  const editorHost = element.querySelector('[data-editor]');
  let quill = createTaskDescriptionEditor(editorHost, {
    value: isEdit ? task.description : '', labelId: 'task-description-label', errorId: 'task-description-error',
  });

  let busy = false;
  modal.setCanClose(() => !busy);

  const onTextChange = () => setFieldError('description', null);
  quill.on('text-change', onTextChange);

  function setFieldError(name, message) {
    const box = element.querySelector(`[data-error-for="${name}"]`);
    box.textContent = message ?? '';
    const input = name === 'description' ? quill.root : form.elements[name];
    input.classList.toggle('is-invalid', Boolean(message));
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function setFormError(message) {
    formError.textContent = message ?? '';
    formError.hidden = !message;
    if (message) formError.scrollIntoView({ block: 'nearest' });
  }

  function setBusy(value) {
    busy = value;
    submitButton.disabled = value;
    cancelButton.disabled = value;
    closeButton.disabled = value;
    spinner.hidden = !value;
    titleInput.readOnly = value;
    stageSelect.disabled = value;
    deadlineInput.disabled = value;
    deadlinePicker.setDisabled(value);
    quill.enable(!value);
    element.setAttribute('aria-busy', String(value));
  }

  // getSemanticHTML yields standard <p>/<ul>/<ol>/<li>; spaces it protects are turned back into plain spaces.
  const readDescription = () => quill.getSemanticHTML().replace(/&nbsp;/g, ' ');

  function validate() {
    const titleError = validateTaskTitle(titleInput.value);
    const stageError = validateTaskStage(stageSelect.value);
    const description = sanitizeRichText(readDescription());
    const descriptionError =
      description.length > RICH_TEXT_MAX_LENGTH ? 'The description is too long.' : null;

    let deadlineError = deadlineInput.validity.badInput ? 'Enter a complete deadline date and time, or clear it.' : null;
    try { deadlineFromEditor(deadlineInput.value, task?.dueAt); }
    catch (error) { deadlineError = error.message; }
    setFieldError('deadline', deadlineError);
    setFieldError('title', titleError);
    setFieldError('stage', stageError);
    setFieldError('description', descriptionError);

    if (titleError) titleInput.focus();
    else if (stageError) stageSelect.focus();
    else if (descriptionError) quill.focus();
    else if (deadlineError) deadlineInput.focus();
    return !titleError && !stageError && !descriptionError && !deadlineError;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return; // ignores a second Enter/click while the first request is running
    setFormError(null);
    if (!validate()) return;

    setBusy(true);
    try {
      await onSubmit({
        title: titleInput.value,
        stageId: stageSelect.value,
        description: readDescription(),
        dueAt: deadlineFromEditor(deadlineInput.value, task?.dueAt),
      });
    } catch (error) {
      if (signal.aborted) return;
      // The form stays as it is, so nothing the user typed is lost.
      setFormError(error?.message || 'Could not save the task. Please try again.');
      setBusy(false);
      return;
    }
    if (signal.aborted) return;
    setBusy(false);
    modal.close(true);
  }, { signal });

  titleInput.addEventListener('input', () => setFieldError('title', null), { signal });
  stageSelect.addEventListener('change', () => {
    setFieldError('stage', null);
    updateStageHint();
  }, { signal });
  element.addEventListener('shown.bs.modal', () => titleInput.focus(), { signal });

  // Quill has no destroy(); unsubscribing and dropping the reference (the DOM goes with the modal) releases it.
  const release = () => {
    quill?.off('text-change', onTextChange);
    quill = null;
  };
  element.addEventListener('hidden.bs.modal', release, { signal });
  signal.addEventListener('abort', release, { once: true });

  const draft = () => JSON.stringify([titleInput.value, stageSelect.value, deadlineInput.value, quill?.getSemanticHTML()]);
  const initialDraft = draft();
  const canLeave = () => !busy && (draft() === initialDraft || window.confirm('Discard unsaved task changes?'));
  modal.show();
  return { result: modal.result, destroy: modal.destroy, canLeave };
}
