import html from './admin-users.html?raw';
import { renderFragment, setText } from '../../utils/render.js';
import { formatDateTime } from '../../utils/dates.js';
import { listAdminUsers } from '../../services/admin-users-service.js';
import { createStates, describeLoadError, pageFromQuery, renderPager, totalPages } from './admin-common.js';
import { runUserDeletion, userLabel } from './admin-user-delete.js';

export const title = 'Admin · Users';

export function mount(container, ctx) {
  renderFragment(container, html);
  const root = container.querySelector('.page-admin-users');
  const show = createStates(root);
  const rows = root.querySelector('[data-rows]');
  const template = root.querySelector('[data-row-template]');
  const pager = root.querySelector('[data-pager]');
  let page = pageFromQuery(ctx.query);
  let requestId = 0;
  let dialog = null;
  let byId = new Map();

  function buildRow(user) {
    const row = template.content.firstElementChild.cloneNode(true);
    const id = encodeURIComponent(user.id);
    row.dataset.userId = user.id;
    setText(row, '[data-cell="name"]', user.displayName || '—');
    setText(row, '[data-cell="email"]', user.email || '—');
    const role = row.querySelector('[data-cell="role"]');
    role.textContent = user.role;
    role.classList.add(user.role === 'admin' ? 'text-bg-primary' : 'text-bg-secondary');
    setText(row, '[data-cell="created"]', user.createdAt ? formatDateTime(user.createdAt) : '—');
    setText(row, '[data-cell="signin"]', user.lastSignInAt ? formatDateTime(user.lastSignInAt) : 'Never');
    const view = row.querySelector('[data-action="view"]');
    view.href = `/admin/users/${id}`;
    view.setAttribute('aria-label', `View ${userLabel(user)}`);
    const edit = row.querySelector('[data-action="edit"]');
    edit.href = `/admin/users/${id}/edit`;
    edit.setAttribute('aria-label', `Edit ${userLabel(user)}`);
    row.querySelector('[data-action="delete"]').setAttribute('aria-label', `Delete ${userLabel(user)}`);
    return row;
  }

  async function load({ quiet = false } = {}) {
    const current = ++requestId;
    if (!quiet) show('loading');
    try {
      const result = await listAdminUsers({ page, signal: ctx.signal });
      if (current !== requestId || ctx.signal.aborted) return;

      if (result.rows.length === 0 && page > 1) {
        page = Math.min(page - 1, totalPages(result.total));
        const params = new URLSearchParams(location.search);
        if (page === 1) params.delete('page');
        else params.set('page', String(page));
        ctx.navigate(`${location.pathname}${params.size ? `?${params}` : ''}`, { replace: true });
        return;
      }

      byId = new Map(result.rows.map((user) => [user.id, user]));
      rows.replaceChildren(...result.rows.map(buildRow));
      renderPager(pager, { page, total: result.total });
      show(result.rows.length === 0 ? 'empty' : 'table');
    } catch (error) {
      if (current !== requestId || ctx.signal.aborted) return;
      setText(root, '[data-error-text]', describeLoadError(error));
      show('error');
    }
  }

  ctx.cleanup.listen(rows, 'click', async (event) => {
    const button = event.target.closest('[data-action="delete"]');
    if (!button || dialog) return;
    const user = byId.get(button.closest('tr')?.dataset.userId);
    if (!user) return;
    button.disabled = true;
    const deleted = await runUserDeletion(user, { signal: ctx.signal, onDialog: (d) => { dialog = d; } });
    dialog = null;
    if (ctx.signal.aborted) return;
    button.disabled = false;
    if (deleted) await load({ quiet: true });
    (button.isConnected ? button : root.querySelector('h1'))?.focus();
  });
  ctx.cleanup.listen(root.querySelector('[data-retry]'), 'click', () => load());
  ctx.cleanup.add(() => dialog?.destroy());
  load();
}
