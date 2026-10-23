import { listProjectLabels, listTaskLabelIds, setTaskLabel } from '../../services/labels-service.js';
import { labelBadge } from '../../utils/labels.js';

export function setupTaskLabels(element, { taskId, projectId, signal, setBusy }) {
  const root = element.querySelector('[data-task-labels]');
  const list = root.querySelector('[data-label-list]');
  const search = root.querySelector('input');
  const status = root.querySelector('[role="status"]');
  const errorBox = root.querySelector('[role="alert"]');
  let labels = [];
  let assigned = new Set();
  let busy = false;
  function render() {
    list.replaceChildren();
    const visible = labels.filter((label) => label.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
    for (const label of visible) {
      const wrapper = document.createElement('label');
      wrapper.className = 'd-flex align-items-center gap-2 py-1';
      const checkbox = document.createElement('input');
      checkbox.dataset.labelId = label.id;
      checkbox.className = 'form-check-input mt-0'; checkbox.type = 'checkbox';
      checkbox.checked = assigned.has(label.id); checkbox.disabled = busy;
      checkbox.addEventListener('change', () => change(label, checkbox.checked), { signal });
      wrapper.append(checkbox, labelBadge(label)); list.append(wrapper);
    }
    status.textContent = !labels.length ? 'No project labels yet. Owners and admins can create them on the Labels page.'
      : !visible.length ? 'No matching labels.' : '';
  }
  async function change(label, add) {
    if (busy) return;
    const restoreFocus = list.contains(document.activeElement);
    busy = true; setBusy(true); errorBox.hidden = true; render();
    try {
      await setTaskLabel(taskId, label.id, add);
      assigned = await listTaskLabelIds(taskId, { signal });
    } catch (error) {
      if (!signal.aborted) { errorBox.textContent = error.message; errorBox.hidden = false; }
    } finally {
      busy = false; setBusy(false);
      if (!signal.aborted) {
        render();
        if (restoreFocus) list.querySelector(`[data-label-id="${CSS.escape(label.id)}"]`)?.focus();
      }
    }
  }
  search.addEventListener('input', render, { signal });
  async function load() {
    try {
      [labels, assigned] = await Promise.all([
        listProjectLabels(projectId, { signal }), listTaskLabelIds(taskId, { signal }),
      ]);
      if (signal.aborted) return;
      search.disabled = false; render();
    } catch (error) {
      if (!signal.aborted) { status.textContent = ''; errorBox.textContent = error.message; errorBox.hidden = false; }
    }
  }
  load();
}
