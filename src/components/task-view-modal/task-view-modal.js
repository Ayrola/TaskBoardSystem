import { mountDeadlinePicker } from '../deadline-picker/deadline-picker.js';
import '../task-dialog.css';
import { setupTaskChecklist } from './task-checklist.js';
import { renderTaskDeadline, browserTimezone, toLocalDeadlineInput, deadlineFromEditor } from '../../utils/deadlines.js';
import { setupTaskLabels } from './task-labels.js';
import { listTaskAssignees, searchTaskAssignees, setTaskAssignee } from '../../services/assignees-service.js';
import html from './task-view-modal.html?raw';
import './task-view-modal.css';
import { mountModal } from '../../utils/modal-host.js';
import { setText } from '../../utils/render.js';
import { sanitizeRichText, RICH_TEXT_MAX_LENGTH } from '../../utils/sanitize.js';
import { validateTaskTitle, validateTaskStage } from '../../utils/validation.js';
import { createTaskDescriptionEditor } from '../task-description-editor.js';
import '../task-form-modal/task-form-modal.css';
import { formatDateTime } from '../../utils/dates.js';
import { ATTACHMENT_ACCEPT, ATTACHMENT_HELP, ATTACHMENT_TYPES, formatFileSize } from '../../utils/files.js';
import {
  listAttachments,
  uploadAttachment,
  removeAttachment,
  getAttachmentDownloadUrl,
} from '../../services/attachments-service.js';
import { showSuccess, TOAST_MESSAGES } from '../../services/toast-service.js';
import {
  COMMENTS_PAGE_SIZE,
  COMMENT_MAX_LENGTH,
  listComments,
  addComment,
  updateComment,
  deleteComment,
  validateCommentBody,
} from '../../services/comments-service.js';

const FILE_ICONS = {
  Image: 'bi-file-earmark-image',
  PDF: 'bi-file-earmark-pdf',
  Word: 'bi-file-earmark-word',
  Excel: 'bi-file-earmark-spreadsheet',
  CSV: 'bi-file-earmark-spreadsheet',
  Text: 'bi-file-earmark-text',
};

// Editable task details. `result` resolves 'saved', 'delete', or null on dismissal.
export function openTaskViewModal({ task, stage, stages, projectId, onSave }) {
  const modal = mountModal(html, { dismissedValue: null });
  const { element, signal } = modal;
  let saveBusy = false;
  let checklistBusy = false;
  let labelBusy = false;
  let assignmentBusy = false;
  let attachmentBusy = false;
  modal.setCanClose(() => !saveBusy && !checklistBusy && !labelBusy && !assignmentBusy && !attachmentBusy);

  const titleInput = element.querySelector('[data-task-title]');
  titleInput.value = task.title;
  element.querySelector('[data-task-activity]').href = `/activity?project=${encodeURIComponent(projectId)}&task=${encodeURIComponent(task.id)}`;
  const stageInput = element.querySelector('[data-stage-input]');
  stageInput.replaceChildren(...stages.map(item => new Option(item.name, item.id)));
  const originalStageId = task.stageId ?? stage?.id;
  stageInput.value = originalStageId;
  const deadlineInput = element.querySelector('[data-deadline-input]');
  deadlineInput.value = toLocalDeadlineInput(task.dueAt);
  setText(element, '[data-deadline-help]', `Local time (${browserTimezone()}). Repeated times when clocks go back use the first occurrence; unchanged deadlines keep their original instant.`);
  stageInput.addEventListener('change', () => {
    element.querySelector('[data-stage-hint]').hidden = stageInput.value === originalStageId;
  }, { signal });
  const deadlinePicker = mountDeadlinePicker(deadlineInput, { signal, onChange: () => {
    setText(element, '[data-deadline-error]', '');
    deadlineInput.classList.remove('is-invalid');
    deadlineInput.setAttribute('aria-invalid', 'false');
  } });
  const deadline = element.querySelector('[data-deadline]');
  renderTaskDeadline(deadline, task);
  const deadlineTimer = setInterval(() => renderTaskDeadline(deadline, task), 30000);
  signal.addEventListener('abort', () => clearInterval(deadlineTimer), { once: true });
  setText(element, '[data-stage-badge]', stage?.name ?? '');
  element.querySelector('[data-done-badge]').hidden = !task.done;

  let editor = createTaskDescriptionEditor(element.querySelector('[data-description-editor]'), {
    value: task.description, labelId: 'task-view-description-label', errorId: 'task-view-description-error',
  });
  signal.addEventListener('abort', () => { editor = null; }, { once: true });

  setText(element, '[data-created]', formatDateTime(task.createdAt));
  const updated = formatDateTime(task.updatedAt);
  const edited = updated && updated !== formatDateTime(task.createdAt);
  element.querySelector('[data-updated-row]').hidden = !edited;
  if (edited) setText(element, '[data-updated]', updated);

  const saveButton = element.querySelector('[data-action="save"]');
  const deleteButton = element.querySelector('[data-action="delete"]');
  saveButton.addEventListener('click', async () => {
    if (saveBusy || checklistBusy || labelBusy || assignmentBusy || attachmentBusy) return;
    const titleError = validateTaskTitle(titleInput.value);
    const stageError = validateTaskStage(stageInput.value) || (!stages.some(item => item.id === stageInput.value) ? 'Choose an available stage.' : '');
    let dueAt = null;
    let deadlineError = deadlineInput.validity.badInput ? 'Enter a complete deadline date and time, or clear it.' : '';
    try { dueAt = deadlineFromEditor(deadlineInput.value, task.dueAt); }
    catch (error) { deadlineError = error.message; }
    setText(element, '[data-stage-error]', stageError);
    setText(element, '[data-deadline-error]', deadlineError);
    stageInput.classList.toggle('is-invalid', Boolean(stageError));
    stageInput.setAttribute('aria-invalid', String(Boolean(stageError)));
    deadlineInput.classList.toggle('is-invalid', Boolean(deadlineError));
    deadlineInput.setAttribute('aria-invalid', String(Boolean(deadlineError)));
    const description = editor.getSemanticHTML().replace(/&nbsp;/g, ' ');
    const descriptionError = sanitizeRichText(description).length > RICH_TEXT_MAX_LENGTH ? 'The description is too long.' : '';
    setText(element, '[data-title-error]', titleError ?? '');
    setText(element, '[data-description-error]', descriptionError);
    titleInput.classList.toggle('is-invalid', Boolean(titleError));
    titleInput.setAttribute('aria-invalid', String(Boolean(titleError)));
    editor.root.setAttribute('aria-invalid', String(Boolean(descriptionError)));
    const errorBox = element.querySelector('[data-save-error]'); errorBox.hidden = true;
    if (titleError) { titleInput.focus(); return; }
    if (stageError) { stageInput.focus(); return; }
    if (deadlineError) { deadlineInput.focus(); return; }
    if (descriptionError) { editor.focus(); return; }
    saveBusy = true; setSaving(true);
    try {
      await onSave({ title: titleInput.value, description, stageId: stageInput.value, dueAt });
      if (!signal.aborted) modal.close('saved');
    } catch (error) {
      if (!signal.aborted) {
        errorBox.textContent = error.message || 'Could not save the task. Please try again.';
        errorBox.hidden = false; errorBox.scrollIntoView({ block: 'nearest' });
      }
    } finally {
      saveBusy = false;
      if (!signal.aborted) setSaving(false);
    }
  }, { signal });
  function setSaving(busy) {
    titleInput.readOnly = busy; editor.enable(!busy);
    stageInput.disabled = deadlineInput.disabled = busy;
    deadlinePicker.setDisabled(busy);
    saveButton.disabled = deleteButton.disabled = busy || checklistBusy || labelBusy || assignmentBusy || attachmentBusy;
    element.querySelector('[data-save-spinner]').hidden = !busy;
    element.setAttribute('aria-busy', String(busy));
    element.querySelectorAll('[data-bs-dismiss]').forEach(button => { button.disabled = busy; });
    element.querySelectorAll('.task-detail-main > section:not(.task-overview), .task-detail-sidebar').forEach(section => { section.inert = busy; });
  }
  deleteButton.addEventListener('click', () => modal.close('delete'), { signal });
  element.addEventListener('shown.bs.modal', () => titleInput.focus(), { signal });

  setupTaskChecklist(element, { taskId: task.id, signal, setBusy: (busy) => {
    checklistBusy = busy;
    saveButton.disabled = deleteButton.disabled = saveBusy || checklistBusy || labelBusy || assignmentBusy || attachmentBusy;
  } });
  setupTaskLabels(element, { taskId: task.id, projectId, signal, setBusy: (busy) => {
    labelBusy = busy;
    saveButton.disabled = deleteButton.disabled = saveBusy || labelBusy || assignmentBusy || attachmentBusy || checklistBusy;
  } });
  setupAssignees();
  setupAttachments();
  setupComments();

  modal.show();
  return { result: modal.result, destroy: modal.destroy };

  // Discussion: plain text only. Bodies are written with textContent (never innerHTML) and wrapped with CSS
  // pre-wrap, so markup typed by a user is shown literally. Pages are keyset-paged newest first; a generation
  // counter drops answers that arrive after a reload so pages are never mixed.
  function setupAssignees() {
    const list = element.querySelector('[data-assignee-list]');
    const results = element.querySelector('[data-assignee-results]');
    const search = element.querySelector('[data-assignee-search]');
    const empty = element.querySelector('[data-assignee-empty]');
    const status = element.querySelector('[data-assignee-status]');
    const errorBox = element.querySelector('[data-assignee-error]');
    let assigned = [];
    let candidates = [];
    let busy = false;
    let loaded = false;
    let generation = 0;
    let timer;
    signal.addEventListener('abort', () => clearTimeout(timer), { once: true });

    function showError(message = '') {
      errorBox.textContent = message;
      errorBox.hidden = !message;
    }
    function row(user, remove) {
      const item = document.createElement('li');
      item.className = 'list-group-item d-flex align-items-center justify-content-between gap-2';
      const label = document.createElement('span');
      label.className = 'text-break';
      label.textContent = user.label;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-sm btn-outline-' + (remove ? 'danger' : 'primary');
      button.textContent = remove ? 'Remove' : 'Assign';
      button.setAttribute('aria-label', `${remove ? 'Unassign' : 'Assign'} ${user.label}`);
      button.disabled = busy || !loaded;
      button.addEventListener('click', () => change(user, !remove), { signal });
      item.append(label, button);
      return item;
    }
    function render() {
      list.replaceChildren(...assigned.map((user) => row(user, true)));
      empty.hidden = assigned.length > 0;
      empty.textContent = loaded ? 'Unassigned.' : 'Loading assignees...';
      const available = candidates.filter((user) => !assigned.some((a) => a.user_id === user.user_id));
      results.replaceChildren(...available.map((user) => row(user, false)));
      status.textContent = available.length ? '' : 'No matching unassigned participants.';
    }
    async function find() {
      const current = ++generation;
      results.replaceChildren();
      status.textContent = 'Searching...';
      try {
        const found = await searchTaskAssignees(projectId, search.value, { signal });
        if (signal.aborted || current !== generation) return;
        candidates = found;
        render();
      } catch (error) {
        if (!signal.aborted && current === generation) { status.textContent = ''; showError(error.message); }
      }
    }
    async function change(user, add) {
      if (busy || !loaded) return;
      busy = true;
      assignmentBusy = true;
      saveButton.disabled = true;
      deleteButton.disabled = true;
      showError();
      render();
      try {
        await setTaskAssignee(task.id, user.user_id, add);
        if (signal.aborted) return;
        assigned = await listTaskAssignees([task.id], { signal });
        await find();
      } catch (error) {
        if (!signal.aborted) showError(error.message);
      } finally {
        busy = false;
        assignmentBusy = false;
        if (!signal.aborted) {
          saveButton.disabled = saveBusy || attachmentBusy || labelBusy || checklistBusy;
          deleteButton.disabled = saveBusy || attachmentBusy || labelBusy || checklistBusy;
          render();
        }
      }
    }
    search.addEventListener('input', () => {
      clearTimeout(timer);
      generation += 1;
      candidates = [];
      results.replaceChildren();
      timer = setTimeout(find, 200);
    }, { signal });
    async function load() {
      try {
        assigned = await listTaskAssignees([task.id], { signal });
        if (signal.aborted) return;
        loaded = true;
        render();
        await find();
      } catch (error) {
        if (!signal.aborted) { empty.textContent = 'Assignees unavailable.'; showError(error.message); }
      }
    }
    load();
  }

  function setupComments() {
    const form = element.querySelector('[data-comment-form]');
    const input = element.querySelector('[data-comment-input]');
    const submit = element.querySelector('[data-comment-submit]');
    const spinner = element.querySelector('[data-comment-spinner]');
    const remaining = element.querySelector('[data-comment-remaining]');
    const errorBox = element.querySelector('[data-comment-error]');
    const loadingText = element.querySelector('[data-comment-loading]');
    const emptyText = element.querySelector('[data-comment-empty]');
    const list = element.querySelector('[data-comment-list]');
    const more = element.querySelector('[data-comment-more]');
    const loadMoreButton = element.querySelector('[data-comment-load-more]');
    const end = element.querySelector('[data-comment-end]');
    const countBadge = element.querySelector('[data-comment-count]');
    const template = element.querySelector('[data-comment-template]');

    let comments = [];
    let total = 0;
    let hasMore = false;
    let cursor = null;
    let generation = 0;
    let loadingPage = false;
    let posting = false;

    const showError = (message) => {
      errorBox.textContent = message ?? '';
      errorBox.hidden = !message;
    };

    function updateRemaining() {
      const left = COMMENT_MAX_LENGTH - input.value.length;
      remaining.textContent = left <= 200 ? `${left} left.` : '';
    }

    function render() {
      const items = comments.map(buildItem);
      list.replaceChildren(...items);
      list.hidden = comments.length === 0;
      emptyText.hidden = loadingText.hidden === false || comments.length > 0;
      countBadge.hidden = total === 0;
      countBadge.textContent = String(total);
      countBadge.setAttribute('aria-label', `${total} ${total === 1 ? 'comment' : 'comments'}`);
      more.hidden = !hasMore;
      end.hidden = hasMore || comments.length <= COMMENTS_PAGE_SIZE;
      setText(element, '[data-comment-summary]', `Showing ${comments.length} of ${total}`);
      loadMoreButton.disabled = loadingPage;
      loadMoreButton.textContent = loadingPage ? 'Loading…' : 'Load older comments';
    }

    function buildItem(comment) {
      const item = template.content.firstElementChild.cloneNode(true);
      item.dataset.commentId = comment.id;
      setText(item, '[data-comment-author]', comment.authorLabel);
      setText(item, '[data-comment-time]', formatDateTime(comment.createdAt));
      setText(item, '[data-comment-body]', comment.body);
      item.querySelector('[data-comment-edited]').hidden = comment.updatedAt === comment.createdAt;
      const edit = item.querySelector('[data-comment-action="edit"]');
      const del = item.querySelector('[data-comment-action="delete"]');
      edit.hidden = !comment.canEdit;
      del.hidden = !comment.canDelete;
      edit.setAttribute('aria-label', `Edit comment by ${comment.authorLabel}`);
      edit.title = 'Edit comment';
      del.setAttribute('aria-label', `Delete comment by ${comment.authorLabel}`);
      del.title = 'Delete comment';
      if (!comment.isMine && comment.canDelete) {
        setText(item, '[data-comment-confirm-text]', `Remove this comment by ${comment.authorLabel} as a moderator?`);
      }
      return item;
    }

    // Reloads from the newest page, down to the depth already shown, so a refresh after a change keeps the
    // user's place without stitching old and new pages together.
    async function reload({ keepDepth = false } = {}) {
      const mine = ++generation;
      const wanted = keepDepth ? Math.max(comments.length, COMMENTS_PAGE_SIZE) : COMMENTS_PAGE_SIZE;
      try {
        const fresh = [];
        let page = await listComments(task.id, { signal });
        fresh.push(...page.comments);
        while (fresh.length < wanted && page.hasMore) {
          if (signal.aborted || mine !== generation) return;
          page = await listComments(task.id, { cursor: page.nextCursor, signal });
          fresh.push(...page.comments);
        }
        if (signal.aborted || mine !== generation) return;
        comments = fresh;
        total = page.total;
        hasMore = page.hasMore;
        cursor = page.nextCursor;
        showError(null);
        loadingText.hidden = true;
        input.disabled = false;
        submit.disabled = posting;
        render();
      } catch (error) {
        if (signal.aborted || mine !== generation) return;
        loadingText.hidden = true;
        showError(error.message);
      }
    }

    async function loadOlder() {
      if (loadingPage || !hasMore) return;
      const mine = generation;
      loadingPage = true;
      render();
      try {
        const page = await listComments(task.id, { cursor, signal });
        if (signal.aborted || mine !== generation) return;
        const known = new Set(comments.map((comment) => comment.id));
        comments = [...comments, ...page.comments.filter((comment) => !known.has(comment.id))];
        total = page.total;
        hasMore = page.hasMore;
        cursor = page.nextCursor;
      } catch (error) {
        if (!signal.aborted && mine === generation) showError(error.message);
      } finally {
        loadingPage = false;
        if (!signal.aborted) render();
      }
    }

    const itemFor = (target) => target.closest('[data-comment-id]');
    const commentFor = (item) => comments.find((candidate) => candidate.id === item?.dataset.commentId);

    function setMode(item, mode) {
      item.querySelector('[data-comment-edit-form]').hidden = mode !== 'edit';
      item.querySelector('[data-comment-confirm]').hidden = mode !== 'delete';
      item.querySelector('[data-comment-body]').hidden = mode === 'edit';
      item.querySelector('[data-comment-buttons]').hidden = mode !== null;
      if (mode === 'edit') {
        const field = item.querySelector('[data-comment-edit-input]');
        field.value = commentFor(item).body;
        field.focus();
      } else if (mode === 'delete') {
        item.querySelector('[data-comment-action="cancel-delete"]').focus();
      }
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (posting) return;
      const problem = validateCommentBody(input.value);
      if (problem) {
        showError(problem);
        return;
      }
      showError(null);
      posting = true;
      submit.disabled = true;
      spinner.hidden = false;
      try {
        await addComment(task.id, input.value);
        if (signal.aborted) return;
        input.value = '';
        updateRemaining();
        await reload();
      } catch (error) {
        if (!signal.aborted) showError(error.message);
      } finally {
        posting = false;
        if (!signal.aborted) {
          spinner.hidden = true;
          submit.disabled = false;
          input.focus();
        }
      }
    }, { signal });
    input.addEventListener('input', updateRemaining, { signal });
    loadMoreButton.addEventListener('click', loadOlder, { signal });

    list.addEventListener('submit', async (event) => {
      event.preventDefault();
      const item = itemFor(event.target);
      const comment = commentFor(item);
      if (!comment) return;
      const field = item.querySelector('[data-comment-edit-input]');
      const problem = validateCommentBody(field.value);
      if (problem) {
        showError(problem);
        return;
      }
      showError(null);
      try {
        await updateComment(comment.id, field.value);
        if (signal.aborted) return;
        await reload({ keepDepth: true });
      } catch (error) {
        if (signal.aborted) return;
        showError(error.message);
        await reload({ keepDepth: true });
      }
    }, { signal });

    list.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-comment-action]');
      if (!button) return;
      const item = itemFor(button);
      const comment = commentFor(item);
      if (!comment) return;

      switch (button.dataset.commentAction) {
        case 'edit': setMode(item, 'edit'); break;
        case 'delete': setMode(item, 'delete'); break;
        case 'cancel-edit':
        case 'cancel-delete':
          setMode(item, null);
          item.querySelector(`[data-comment-action="${button.dataset.commentAction === 'cancel-edit' ? 'edit' : 'delete'}"]`)?.focus();
          break;
        case 'confirm-delete':
          showError(null);
          button.disabled = true;
          try {
            await deleteComment(comment.id);
          } catch (error) {
            if (!signal.aborted) showError(error.message);
          }
          if (!signal.aborted) {
            await reload({ keepDepth: true });
            input.focus();
          }
          break;
        default: break;
      }
    }, { signal });

    updateRemaining();
    reload();
  }

  function setupAttachments() {
    const input = element.querySelector('[data-attachment-input]');
    const uploadButton = element.querySelector('[data-attachment-upload]');
    const spinner = element.querySelector('[data-upload-spinner]');
    const uploadIcon = element.querySelector('[data-upload-icon]');
    const uploadLabel = element.querySelector('[data-upload-label]');
    const errorBox = element.querySelector('[data-attachment-error]');
    const loadingText = element.querySelector('[data-attachment-loading]');
    const emptyText = element.querySelector('[data-attachment-empty]');
    const list = element.querySelector('[data-attachment-list]');
    const countBadge = element.querySelector('[data-attachment-count]');
    const template = element.querySelector('[data-attachment-template]');
    let attachments = [];
    let busy = false;

    input.accept = ATTACHMENT_ACCEPT;
    setText(element, '[data-attachment-help]', ATTACHMENT_HELP);
    uploadButton.disabled = true; // enabled once the list has loaded


    const showError = (message) => {
      errorBox.textContent = message ?? '';
      errorBox.hidden = !message;
    };

    function setBusy(active, label = 'Upload file') {
      busy = active;
      attachmentBusy = active;
      spinner.hidden = !active;
      uploadIcon.hidden = active;
      uploadLabel.textContent = label;
      uploadButton.disabled = active;
      saveButton.disabled = saveBusy || active || assignmentBusy || labelBusy || checklistBusy;
      deleteButton.disabled = saveBusy || active || assignmentBusy || labelBusy || checklistBusy;
      for (const button of list.querySelectorAll('button')) button.disabled = active;
    }

    function buildItem(attachment) {
      const item = template.content.firstElementChild.cloneNode(true);
      item.dataset.attachmentId = attachment.id;
      const kind = ATTACHMENT_TYPES[attachment.mimeType];
      item.querySelector('[data-attachment-icon]').classList.add(FILE_ICONS[kind] ?? 'bi-file-earmark');
      setText(item, '[data-attachment-name]', attachment.filename);
      setText(item, '[data-attachment-meta]', `${formatFileSize(attachment.size)} · ${formatDateTime(attachment.createdAt)}`);
      const labels = {
        download: `Download ${attachment.filename}`,
        remove: `Remove ${attachment.filename}`,
      };
      for (const [action, label] of Object.entries(labels)) {
        const button = item.querySelector(`[data-attachment-action="${action}"]`);
        button.setAttribute('aria-label', label);
        button.title = label;
      }
      return item;
    }

    function renderList() {
      list.replaceChildren(...attachments.map(buildItem));
      list.hidden = attachments.length === 0;
      emptyText.hidden = attachments.length > 0;
      countBadge.hidden = attachments.length === 0;
      countBadge.textContent = String(attachments.length);
      countBadge.setAttribute('aria-label', `${attachments.length} ${attachments.length === 1 ? 'attachment' : 'attachments'}`);
    }

    async function load() {
      try {
        attachments = await listAttachments(task.id, { signal });
        if (signal.aborted) return;
        renderList();
        uploadButton.disabled = false;
      } catch (error) {
        if (signal.aborted) return;
        showError(error.message);
      } finally {
        if (!signal.aborted) loadingText.hidden = true;
      }
    }

    async function upload(file) {
      showError(null);
      setBusy(true, 'Uploading…');
      try {
        const created = await uploadAttachment({ projectId, taskId: task.id, file });
        if (signal.aborted) return;
        attachments = [...attachments, created];
        renderList();
        showSuccess(TOAST_MESSAGES.uploadCompleted);
      } catch (error) {
        if (!signal.aborted) showError(error.message);
      } finally {
        if (!signal.aborted) {
          setBusy(false);
          uploadButton.focus();
        }
      }
    }

    async function download(attachment, button) {
      showError(null);
      setBusy(true, 'Upload file');
      try {
        const url = await getAttachmentDownloadUrl(attachment);
        if (signal.aborted) return;
        // The signed link expires in about a minute and forces a download under the original name.
        const link = document.createElement('a');
        link.href = url;
        link.rel = 'noopener noreferrer';
        link.download = attachment.filename;
        link.click();
      } catch (error) {
        if (!signal.aborted) showError(error.message);
      } finally {
        if (!signal.aborted) {
          setBusy(false);
          button.focus();
        }
      }
    }

    async function remove(attachment, item) {
      showError(null);
      setBusy(true, 'Upload file');
      try {
        await removeAttachment(attachment.id);
        if (signal.aborted) return;
        attachments = attachments.filter((candidate) => candidate.id !== attachment.id);
        renderList();
      } catch (error) {
        if (signal.aborted) return;
        showError(error.message);
        // The file may already be gone (removed elsewhere); reload to show the real list.
        await load();
      } finally {
        if (!signal.aborted) {
          setBusy(false);
          if (item.isConnected) item.querySelector('[data-attachment-action="remove"]')?.focus();
          else uploadButton.focus();
        }
      }
    }

    function setConfirming(item, confirming) {
      item.querySelector('[data-attachment-confirm]').hidden = !confirming;
      item.querySelector('[data-attachment-buttons]').hidden = confirming;
      const target = confirming ? '[data-attachment-action="cancel-remove"]' : '[data-attachment-action="remove"]';
      item.querySelector(target)?.focus();
    }

    uploadButton.addEventListener('click', () => input.click(), { signal });
    input.addEventListener('change', () => {
      const [file] = input.files;
      input.value = ''; // lets the same file be picked again later
      if (file && !busy) upload(file);
    }, { signal });

    list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-attachment-action]');
      if (!button || busy) return;
      const item = button.closest('[data-attachment-id]');
      const attachment = attachments.find((candidate) => candidate.id === item?.dataset.attachmentId);
      if (!attachment) return;

      switch (button.dataset.attachmentAction) {
        case 'download': download(attachment, button); break;
        case 'remove': setConfirming(item, true); break;
        case 'cancel-remove': setConfirming(item, false); break;
        case 'confirm-remove': remove(attachment, item); break;
        default: break;
      }
    }, { signal });

    load();
  }
}
