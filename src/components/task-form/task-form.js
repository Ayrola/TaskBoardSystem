import '../task-dialog.css';
import { mountModal } from '../../utils/modal-host.js';
import { setText } from '../../utils/render.js';
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

import html from './task-form.html?raw';
import '../task-view-modal/task-view-modal.css';
import './task-form.css';
import { mountTaskFields } from './task-fields.js';
import { mountAssigneePicker } from './assignee-picker.js';
import { setupTaskChecklist } from '../task-view-modal/task-checklist.js';
import { setupTaskLabels } from '../task-view-modal/task-labels.js';

// One form owns create/edit drafts; only attachments and discussion are saved independently for existing tasks.
export function openTaskForm({ mode, task: suppliedTask, stage, stages, stageId, projectId, onSave, allowDelete = true }) {
  const creating=mode==='create';
  const task=suppliedTask??{};
  const modal=mountModal(html,{dismissedValue:null});
  const {element,signal}=modal;
  element.dataset.mode=mode;
  if(creating){
    element.classList.add('task-form-modal');
    const footer=element.querySelector('.modal-footer');footer.classList.remove('justify-content-between');footer.classList.add('justify-content-end');
    for(const [selector,id] of [['[data-task-title]','task-title'],['[data-stage-input]','task-stage'],['[data-deadline-input]','task-deadline']]){
      const input=element.querySelector(selector),previous=input.id;input.id=id;element.querySelector(`label[for="${previous}"]`)?.setAttribute('for',id);
    }
  }
  element.querySelector('#task-view-title').textContent=creating?'Create Task':'Task details';
  element.querySelector('[data-submit-label]').textContent=creating?'Create Task':'Save Changes';
  const saveButton=element.querySelector('[data-action="save"]'),deleteButton=element.querySelector('[data-action="delete"]');
  deleteButton.hidden=creating||!allowDelete;
  element.querySelector('[data-task-activity]').closest('p').hidden=creating;
  element.querySelector('.task-meta').hidden=creating;
  element.querySelector('[data-create-related]').hidden=!creating;
  for(const section of ['.attachments','.comments'])element.querySelector(section).hidden=creating;
  element.querySelector('[data-stage-badge]').hidden=true;
  element.querySelector('[data-done-badge]').hidden=true;
  if(!creating){element.querySelector('[data-task-activity]').href=`/projects/${projectId}/activity?task=${task.id}`;setText(element,'[data-created]',formatDateTime(task.createdAt));setText(element,'[data-updated]',formatDateTime(task.updatedAt));}
  const fields=mountTaskFields(element,{mode,task:suppliedTask,stages,stageId:stageId??stage?.id,signal});
  let saveBusy=false,checklistBusy=false,labelBusy=false,assignmentBusy=false,attachmentBusy=false,ready=false,finished=false;
  const requestId=crypto.randomUUID();
  const labels=setupTaskLabels(element,{taskId:task.id,projectId,signal,draftOnly:true,setBusy:busy=>{labelBusy=busy;}});
  const checklist=setupTaskChecklist(element,{taskId:task.id,signal,draftOnly:true,setBusy:busy=>{checklistBusy=busy;}});
  const assignees=mountAssigneePicker(element,{taskId:task.id,projectId,signal});
  function setSaving(busy){
    fields.setDisabled(busy);saveButton.disabled=busy||!ready;deleteButton.disabled=busy||!ready;
    element.querySelector('[data-save-spinner]').hidden=!busy;element.setAttribute('aria-busy',String(busy||!ready));
    element.querySelectorAll('[data-bs-dismiss]').forEach(button=>{button.disabled=busy;});
    element.querySelectorAll('.task-detail-main > section:not(.task-overview),.task-detail-sidebar').forEach(section=>{section.inert=busy;});
  }
  const dirty=()=>fields.isDirty()||labels.isDirty()||checklist.isDirty()||assignees.isDirty();
  const canLeave=()=>!(saveBusy||checklistBusy||labelBusy||assignmentBusy||attachmentBusy) && (finished||!dirty()||window.confirm('Discard unsaved task changes?'));
  modal.setCanClose(canLeave);
  window.addEventListener('beforeunload',event=>{if(!finished&&(saveBusy||dirty())){event.preventDefault();event.returnValue='';}},{signal});
  element.querySelector('[data-task-submit]').addEventListener('submit',async event=>{
    event.preventDefault();if(saveBusy||!ready||checklistBusy||labelBusy||attachmentBusy)return;
    const values=fields.read();if(!values)return;
    const errorBox=element.querySelector('[data-save-error]');errorBox.hidden=true;
    try{
      labels.validate();assignees.validate();checklist.validate();
      saveBusy=true;setSaving(true);
      await onSave({...values,labelIds:labels.getIds(),assigneeIds:assignees.getIds(),checklist:checklist.getItems(),expectedChecklist:creating?null:checklist.getOriginal(),requestId});
      if(!signal.aborted){finished=true;modal.close(creating?true:'saved');}
    }catch(error){if(!signal.aborted){errorBox.textContent=error.message||'Could not save the task. Please try again.';errorBox.hidden=false;errorBox.scrollIntoView({block:'nearest'});}}
    finally{saveBusy=false;if(!signal.aborted)setSaving(false);}
  },{signal});
  deleteButton.addEventListener('click',()=>{if(canLeave())modal.close('delete');},{signal});
  element.addEventListener('shown.bs.modal',()=>fields.focus(),{signal});
  if(!creating){setupAttachments();setupComments();}
  setSaving(false);
  const retry=element.querySelector('[data-properties-retry]');
  async function loadProperties(promises){
    retry.disabled=true;
    await Promise.all(promises);
    if(signal.aborted)return;
    ready=[labels,assignees,checklist].every(component=>component.isLoaded());
    element.querySelector('[data-properties-status]').textContent=ready?'':'Some task properties could not be loaded. Your draft is preserved.';
    element.querySelector('[data-properties-status]').hidden=ready;
    retry.hidden=ready;retry.disabled=false;setSaving(false);
  }
  retry.addEventListener('click',()=>loadProperties([labels.retry(),assignees.retry(),checklist.retry()]),{signal});
  loadProperties([labels.ready,assignees.ready,checklist.ready]);
  modal.show();
  return {result:modal.result,destroy:modal.destroy,canLeave};

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
      saveButton.disabled = !ready || saveBusy || active || assignmentBusy || labelBusy || checklistBusy;
      deleteButton.disabled = !ready || saveBusy || active || assignmentBusy || labelBusy || checklistBusy;
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
