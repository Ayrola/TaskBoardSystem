import html from './task-view-modal.html?raw';
import './task-view-modal.css';
import { mountModal } from '../../utils/modal-host.js';
import { setText } from '../../utils/render.js';
import { richTextToFragment } from '../../utils/sanitize.js';
import { formatDateTime } from '../../utils/dates.js';
import { ATTACHMENT_ACCEPT, ATTACHMENT_HELP, ATTACHMENT_TYPES, formatFileSize } from '../../utils/files.js';
import {
  listAttachments,
  uploadAttachment,
  removeAttachment,
  getAttachmentDownloadUrl,
} from '../../services/attachments-service.js';
import { showSuccess, TOAST_MESSAGES } from '../../services/toast-service.js';

const FILE_ICONS = {
  Image: 'bi-file-earmark-image',
  PDF: 'bi-file-earmark-pdf',
  Word: 'bi-file-earmark-word',
  Excel: 'bi-file-earmark-spreadsheet',
  CSV: 'bi-file-earmark-spreadsheet',
  Text: 'bi-file-earmark-text',
};

// Task details with attachments. `result` resolves 'edit', 'delete', or null when simply closed.
// The description is sanitized and appended as DOM nodes; stored HTML is never assigned to innerHTML.
export function openTaskViewModal({ task, stage, projectId }) {
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

  const editButton = element.querySelector('[data-action="edit"]');
  const deleteButton = element.querySelector('[data-action="delete"]');
  editButton.addEventListener('click', () => modal.close('edit'), { signal });
  deleteButton.addEventListener('click', () => modal.close('delete'), { signal });
  element.addEventListener('shown.bs.modal', () => editButton.focus(), { signal });

  setupAttachments();

  modal.show();
  return { result: modal.result, destroy: modal.destroy };

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
    modal.setCanClose(() => !busy);

    const showError = (message) => {
      errorBox.textContent = message ?? '';
      errorBox.hidden = !message;
    };

    function setBusy(active, label = 'Upload file') {
      busy = active;
      spinner.hidden = !active;
      uploadIcon.hidden = active;
      uploadLabel.textContent = label;
      uploadButton.disabled = active;
      editButton.disabled = active;
      deleteButton.disabled = active;
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
