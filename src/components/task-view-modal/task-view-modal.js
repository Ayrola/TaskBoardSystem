import html from './task-view-modal.html?raw';
import './task-view-modal.css';
import { mountModal } from '../../utils/modal-host.js';
import { setText } from '../../utils/render.js';
import { richTextToFragment } from '../../utils/sanitize.js';
import { formatDateTime } from '../../utils/dates.js';

// Read-only task details. `result` resolves 'edit', 'delete', or null when simply closed.
// The description is sanitized and appended as DOM nodes; stored HTML is never assigned to innerHTML.
export function openTaskViewModal({ task, stage }) {
  const modal = mountModal(html, { dismissedValue: null });
  const { element, signal } = modal;

  setText(element, '[data-task-title]', task.title);
  setText(element, '[data-stage-badge]', stage?.name ?? '');
  element.querySelector('[data-done-badge]').hidden = !task.done;

  const description = element.querySelector('[data-description]');
  const fragment = richTextToFragment(task.description);
  const hasDescription = fragment.textContent.trim() !== '';
  if (hasDescription) description.replaceChildren(fragment);
  description.hidden = !hasDescription;
  element.querySelector('[data-no-description]').hidden = hasDescription;

  setText(element, '[data-created]', formatDateTime(task.createdAt));
  const updated = formatDateTime(task.updatedAt);
  const edited = updated && updated !== formatDateTime(task.createdAt);
  element.querySelector('[data-updated-row]').hidden = !edited;
  if (edited) setText(element, '[data-updated]', updated);

  element.querySelector('[data-action="edit"]').addEventListener('click', () => modal.close('edit'), { signal });
  element.querySelector('[data-action="delete"]').addEventListener('click', () => modal.close('delete'), { signal });
  element.addEventListener('shown.bs.modal', () => element.querySelector('[data-action="edit"]')?.focus(), { signal });

  modal.show();
  return { result: modal.result, destroy: modal.destroy };
}
