import html from './users.html?raw';
import './users.css';
import { renderFragment, setText } from '../../utils/render.js';
import { formatDateTime } from '../../utils/dates.js';
import { getProject, ProjectNotFoundError } from '../../services/projects-service.js';
import {
  listMembers,
  searchUsers,
  addMember,
  removeMember,
} from '../../services/members-service.js';
import { openConfirmDialog } from '../../components/confirm-dialog/confirm-dialog.js';
import { openAddUserModal } from '../../components/add-user-modal/add-user-modal.js';
import { showSuccess, showInfo } from '../../services/toast-service.js';

export const title = 'Project users';

export function mount(container, ctx) {
  renderFragment(container, html);
  const root = container.querySelector('.page-users');
  const panels = root.querySelectorAll('[data-state]');
  const rows = root.querySelector('[data-rows]');
  const template = root.querySelector('[data-row-template]');
  const actions = root.querySelector('[data-actions]');
  const addButton = root.querySelector('[data-add]');
  const projectId = ctx.params.id;
  let loadId = 0;
  let project = null;
  let membersById = new Map();
  let overlay = null; // the add dialog or the remove confirmation; only one at a time

  const show = (state) => {
    panels.forEach((panel) => { panel.hidden = panel.dataset.state !== state; });
    actions.hidden = state !== 'table';
    root.setAttribute('aria-busy', String(state === 'loading'));
  };

  root.querySelector('[data-link="tasks"]').href = `/projects/${encodeURIComponent(projectId)}/tasks`;

  function buildRow(member) {
    const row = template.content.firstElementChild.cloneNode(true);
    row.dataset.userId = member.userId;
    setText(row, '[data-cell="label"]', member.label);
    const badge = setText(row, '[data-cell="role"]', member.isOwner ? 'Owner' : 'Member');
    badge.classList.add(member.isOwner ? 'text-bg-primary' : 'text-bg-secondary');
    setText(row, '[data-cell="added"]', member.isOwner ? '—' : formatDateTime(member.addedAt));

    const remove = row.querySelector('[data-action="remove"]');
    // The owner is not a membership row and cannot be removed or demoted from here.
    if (member.isOwner) remove.remove();
    else remove.setAttribute('aria-label', `Remove ${member.label}`);
    return row;
  }

  async function load({ quiet = false } = {}) {
    const current = ++loadId;
    if (!quiet) show('loading');
    try {
      const loaded = await getProject(projectId, { signal: ctx.signal });
      if (!loaded.canManage) throw new ProjectNotFoundError();
      const members = await listMembers(projectId, { signal: ctx.signal });
      if (current !== loadId || ctx.signal.aborted) return;

      project = loaded;
      membersById = new Map(members.map((member) => [member.userId, member]));
      setText(root, '[data-project-title]', project.title);
      rows.replaceChildren(...members.map(buildRow));
      root.querySelector('[data-no-members]').hidden = members.length > 1;
      document.title = `${project.title} · Users · Taskboard`;
      show('table');
    } catch (error) {
      if (current !== loadId || ctx.signal.aborted) return;
      if (error instanceof ProjectNotFoundError) {
        show('notfound');
      } else {
        setText(root, '[data-error-text]', error.message);
        show('error');
      }
    }
  }

  async function openAdd() {
    if (overlay || !project) return;
    overlay = openAddUserModal({
      search: (query, signal) => searchUsers(projectId, query, { signal }),
      onAdd: (user) => addMember(projectId, user.userId),
    });
    const added = await overlay.result;
    overlay = null;
    if (ctx.signal.aborted) return;
    if (added) {
      showSuccess('User added to the project.');
      await load({ quiet: true });
    }
    addButton.focus();
  }

  async function confirmRemove(member, trigger) {
    if (overlay) return;
    overlay = openConfirmDialog({
      title: 'Remove user?',
      lead: `Remove “${member.label}” from “${project.title}”?`,
      detail:
        'They will immediately lose access to this project, its tasks and attachments. Tasks they created stay in the project.',
      confirmLabel: 'Remove user',
      onConfirm: async () => {
        const removed = await removeMember(projectId, member.userId);
        if (!removed) showInfo('That user was already removed.');
      },
    });
    const confirmed = await overlay.result;
    overlay = null;
    if (ctx.signal.aborted) return;
    if (confirmed) {
      showSuccess('User removed from the project.');
      await load({ quiet: true });
    }
    (trigger.isConnected ? trigger : addButton).focus();
  }

  ctx.cleanup.listen(rows, 'click', (event) => {
    const button = event.target.closest('[data-action="remove"]');
    if (!button) return;
    const member = membersById.get(button.closest('tr')?.dataset.userId);
    if (member && !member.isOwner) confirmRemove(member, button);
  });
  ctx.cleanup.listen(addButton, 'click', openAdd);
  ctx.cleanup.listen(root.querySelector('[data-retry]'), 'click', () => load());
  ctx.cleanup.add(() => overlay?.destroy());
  load();
}
