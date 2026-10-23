import { getTaskChecklist, writeTaskChecklist, ChecklistChangedError, CHECKLIST_TEXT_MAX } from '../../services/checklist-service.js';

export function setupTaskChecklist(element, { taskId, signal, setBusy }) {
  const root = element.querySelector('[data-task-checklist]');
  const list = root.querySelector('[data-checklist-list]');
  const form = root.querySelector('[data-checklist-add]');
  const input = form.elements.text;
  const submit = form.querySelector('button');
  const status = root.querySelector('[data-checklist-status]');
  const errorBox = root.querySelector('[data-checklist-error]');
  const retry = root.querySelector('[data-checklist-retry]');
  const summary = root.querySelector('[data-checklist-summary]');
  const progress = root.querySelector('progress');
  let items = [];
  let loaded = false;
  let busy = false;
  let editing = null;
  let draft = '';
  let confirming = null;
  const node = (tag, text, className = '') => {
    const result = document.createElement(tag); result.textContent = text; result.className = className; return result;
  };
  function button(text, action, label, style = 'secondary') {
    const result = node('button', text, `btn btn-sm btn-outline-${style}`);
    result.type = 'button'; result.dataset.checklistAction = action; result.setAttribute('aria-label', label);
    result.disabled = busy || !loaded; return result;
  }
  function showError(message) {
    errorBox.textContent = message; errorBox.hidden = !message;
  }
  function render() {
    input.disabled = submit.disabled = busy || !loaded || editing !== null;
    retry.disabled = busy;
    progress.hidden = !loaded || !items.length;
    progress.max = items.length || 1; progress.value = items.filter(item => item.completed).length;
    summary.textContent = loaded ? `${progress.value} of ${items.length} complete` : '';
    progress.setAttribute('aria-label', summary.textContent || 'Checklist progress');
    status.textContent = !loaded ? 'Checklist unavailable. Try loading it again.'
      : !items.length ? 'No checklist items yet. Add the first item below.' : '';
    list.replaceChildren();
    items.forEach((item, index) => {
      const li = node('li', '', 'list-group-item'); li.dataset.checklistId = item.id;
      const row = node('div', '', 'd-flex align-items-start gap-2');
      const label = node('label', '', 'd-flex align-items-start gap-2 flex-grow-1 min-w-0');
      const check = document.createElement('input'); check.type = 'checkbox';
      check.className = 'form-check-input flex-shrink-0'; check.dataset.checklistToggle = '';
      check.checked = item.completed; check.disabled = busy || !loaded || editing !== null;
      const text = node('span', item.text, `checklist-text${item.completed ? ' text-decoration-line-through' : ''}`);
      label.append(check, text); row.append(label);
      const controls = node('div', '', 'd-flex flex-wrap gap-1');
      const up = button('↑', 'up', `Move up: ${item.text}`);
      const down = button('↓', 'down', `Move down: ${item.text}`);
      up.disabled ||= index === 0 || editing !== null; down.disabled ||= index === items.length - 1 || editing !== null;
      const edit = button('Edit', 'edit', `Edit checklist item: ${item.text}`);
      const remove = button('Delete', 'delete', `Delete checklist item: ${item.text}`, 'danger');
      edit.disabled ||= editing !== null; remove.disabled ||= editing !== null;
      controls.append(up, down, edit, remove); row.append(controls); li.append(row);
      if (editing === item.id) {
        const editor = document.createElement('form'); editor.dataset.checklistEdit = ''; editor.className = 'mt-2';
        const fieldLabel = node('label', 'Item text', 'form-label small');
        const field = document.createElement('textarea'); field.name = 'text'; field.maxLength = CHECKLIST_TEXT_MAX;
        field.id = `checklist-edit-${item.id}`; fieldLabel.htmlFor = field.id;
        field.className = 'form-control form-control-sm'; field.rows = 2; field.value = draft; field.required = true; field.disabled = busy;
        const save = button('Save item', 'save', 'Save checklist item', 'primary'); save.type = 'submit';
        const cancel = button('Cancel', 'cancel-edit', 'Cancel editing checklist item');
        const actions = node('div', '', 'd-flex gap-2 mt-2'); actions.append(save, cancel);
        editor.append(fieldLabel, field, actions); li.append(editor);
      }
      if (confirming === item.id) {
        const confirmation = node('div', '', 'd-flex flex-wrap align-items-center gap-2 mt-2');
        confirmation.setAttribute('role', 'group'); confirmation.setAttribute('aria-label', 'Confirm checklist item deletion');
        confirmation.append(node('span', 'Delete this checklist item?', 'small'),
          button('Delete item', 'confirm-delete', 'Confirm delete checklist item', 'danger'), button('Keep', 'keep', 'Keep checklist item'));
        li.append(confirmation);
      }
      list.append(li);
    });
  }
  function focusItem(itemId, action = null) {
    const row = itemId && list.querySelector(`[data-checklist-id="${CSS.escape(itemId)}"]`);
    const target = row?.querySelector(action ? `[data-checklist-action="${action}"]` : '[data-checklist-toggle]');
    if (target && !target.disabled) target.focus();
    else if (row?.querySelector('[data-checklist-toggle]:not(:disabled)')) row.querySelector('[data-checklist-toggle]').focus();
    else input.focus();
  }
  async function reload() {
    const data = await getTaskChecklist(taskId, { signal });
    if (signal.aborted) return;
    items = data.items; loaded = true; retry.hidden = true;
  }
  async function mutate(action, values, focusId = null, focusAction = null) {
    if (busy || !loaded) return;
    busy = true; setBusy(true); showError(''); render();
    try {
      await writeTaskChecklist(taskId, action, values);
      if (signal.aborted) return;
      if (action === 'add') input.value = '';
      editing = null; confirming = null;
      try { await reload(); }
      catch (error) { loaded = false; retry.hidden = false; throw error; }
    } catch (error) {
      if (!signal.aborted) {
        if (error instanceof ChecklistChangedError) {
          try { await reload(); } catch { loaded = false; retry.hidden = false; }
        }
        showError(error.message);
      }
    } finally {
      busy = false; setBusy(false);
      if (!signal.aborted) {
        render();
        if (editing) list.querySelector('textarea')?.focus();
        else focusItem(focusId, focusAction);
      }
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!busy && loaded) mutate('add', { text: input.value });
  }, { signal });
  list.addEventListener('input', event => { if (event.target.matches('textarea')) draft = event.target.value; }, { signal });
  list.addEventListener('submit', event => {
    const editor = event.target.closest('[data-checklist-edit]');
    if (!editor) return;
    event.preventDefault();
    mutate('edit', { itemId: editing, text: editor.elements.text.value }, editing, 'edit');
  }, { signal });
  list.addEventListener('change', event => {
    const checkbox = event.target.closest('[data-checklist-toggle]');
    if (!checkbox) return;
    const itemId = checkbox.closest('[data-checklist-id]').dataset.checklistId;
    mutate('complete', { itemId, completed: checkbox.checked }, itemId);
  }, { signal });
  list.addEventListener('click', event => {
    const control = event.target.closest('[data-checklist-action]');
    if (!control || busy) return;
    const itemId = control.closest('[data-checklist-id]').dataset.checklistId;
    const index = items.findIndex(item => item.id === itemId); const item = items[index];
    if (!item) return;
    const action = control.dataset.checklistAction;
    if (action === 'up' || action === 'down') {
      const next = index + (action === 'up' ? -1 : 1);
      if (next < 0 || next >= items.length) return;
      const expectedOrder = items.map(item => item.id); const order = [...expectedOrder];
      [order[index], order[next]] = [order[next], order[index]];
      mutate('reorder', { order, expectedOrder }, itemId, action);
    } else if (action === 'edit') {
      editing = itemId; draft = item.text; confirming = null; render(); list.querySelector('textarea')?.focus();
    } else if (action === 'cancel-edit') {
      editing = null; render(); focusItem(itemId, 'edit');
    } else if (action === 'delete') {
      confirming = itemId; render(); focusItem(itemId, 'confirm-delete');
    } else if (action === 'keep') {
      confirming = null; render(); focusItem(itemId, 'delete');
    } else if (action === 'confirm-delete') {
      mutate('delete', { itemId }, items[index+1]?.id ?? items[index-1]?.id);
    }
  }, { signal });
  async function load() {
    if (busy) return;
    busy = true; showError(''); status.textContent = 'Loading checklist…'; retry.disabled = true;
    try { await reload(); }
    catch (error) { if (!signal.aborted) { showError(error.message); retry.hidden = false; } }
    finally { busy = false; if (!signal.aborted) render(); }
  }
  retry.addEventListener('click', load, { signal });
  load();
}
