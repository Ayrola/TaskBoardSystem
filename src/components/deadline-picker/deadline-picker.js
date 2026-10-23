import { todayDeadlineInput } from '../../utils/deadlines.js';
import './deadline-picker.css';

// Native input is the draft source of truth; consumers retain their existing Save/conversion flow.
export function mountDeadlinePicker(input, { signal, onChange = () => {} } = {}) {
  const group = input.parentElement;
  group.classList.add('deadline-picker');
  const clear = group.querySelector('[data-clear-deadline]');
  const today = document.createElement('button');
  today.type = 'button';
  today.className = 'btn btn-outline-secondary';
  today.dataset.deadlineToday = '';
  today.textContent = 'Today';
  today.setAttribute('aria-label', 'Set deadline date to today');
  today.setAttribute('aria-controls', input.id);
  input.after(today);
  function update(value) {
    if (input.disabled || input.readOnly) return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
  }
  today.addEventListener('click', () => update(todayDeadlineInput(input.value, input.type)), { signal });
  clear?.addEventListener('click', () => update(''), { signal });
  input.addEventListener('input', onChange, { signal });
  return { setDisabled(disabled) { today.disabled = disabled; if (clear) clear.disabled = disabled; } };
}
