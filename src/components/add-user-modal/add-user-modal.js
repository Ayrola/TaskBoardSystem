import html from './add-user-modal.html?raw';
import './add-user-modal.css';
import { mountModal } from '../../utils/modal-host.js';
import { SEARCH_MIN_LENGTH } from '../../services/members-service.js';

const DEBOUNCE_MS = 250;

// Searchable picker for adding one user. `search(query, signal)` resolves [{ userId, label }] and
// `onAdd(user)` performs the (async) insert; the dialog stays open and shows an inline error if it throws.
// `result` resolves true after a successful add, otherwise false.
export function openAddUserModal({ search, onAdd }) {
  const modal = mountModal(html, { backdrop: 'static', dismissedValue: false });
  const { element, signal } = modal;
  const form = element.querySelector('form');
  const input = element.querySelector('[data-search]');
  const list = element.querySelector('[data-results]');
  const status = element.querySelector('[data-status]');
  const searching = element.querySelector('[data-searching]');
  const errorBox = element.querySelector('[data-error]');
  const submit = element.querySelector('[data-submit]');
  const spinner = element.querySelector('[data-spinner]');
  const cancelButtons = element.querySelectorAll('[data-bs-dismiss]');

  let selected = null;
  let busy = false;
  let timer = 0;
  let searchId = 0;
  let controller = null;

  modal.setCanClose(() => !busy);
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    controller?.abort();
  });

  const setError = (message) => {
    errorBox.textContent = message ?? '';
    errorBox.hidden = !message;
  };

  const syncSubmit = () => { submit.disabled = busy || !selected; };

  function select(user, button) {
    selected = user;
    list.querySelectorAll('button').forEach((item) => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    setError(null);
    syncSubmit();
  }

  function renderResults(users, query) {
    selected = null;
    syncSubmit();
    list.replaceChildren(
      ...users.map((user) => {
        const item = document.createElement('li');
        item.className = 'list-group-item p-0';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'list-group-item-action border-0 w-100 text-start px-3 py-2 bg-transparent';
        button.setAttribute('aria-pressed', 'false');
        button.textContent = user.label;
        button.addEventListener('click', () => select(user, button), { signal });
        item.append(button);
        return item;
      }),
    );
    status.textContent =
      users.length === 0 ? `No users found for “${query}”.` : `${users.length} match${users.length === 1 ? '' : 'es'}.`;
  }

  async function runSearch() {
    const query = input.value.trim();
    const current = ++searchId;
    controller?.abort();

    if (query.length < SEARCH_MIN_LENGTH) {
      searching.hidden = true;
      renderResults([], query);
      status.textContent = '';
      return;
    }

    controller = new AbortController();
    searching.hidden = false;
    status.textContent = 'Searching…';
    try {
      const users = await search(query, controller.signal);
      if (current !== searchId || signal.aborted) return;
      renderResults(users, query);
    } catch (error) {
      if (current !== searchId || signal.aborted || error?.name === 'AbortError') return;
      renderResults([], query);
      status.textContent = '';
      setError(error?.message || 'Could not search users.');
    } finally {
      if (current === searchId) searching.hidden = true;
    }
  }

  input.addEventListener('input', () => {
    setError(null);
    clearTimeout(timer);
    timer = setTimeout(runSearch, DEBOUNCE_MS);
  }, { signal });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !selected) return;
    busy = true;
    syncSubmit();
    spinner.hidden = false;
    setError(null);
    cancelButtons.forEach((button) => { button.disabled = true; });
    try {
      await onAdd(selected);
      busy = false;
      modal.close(true);
    } catch (error) {
      busy = false;
      spinner.hidden = true;
      cancelButtons.forEach((button) => { button.disabled = false; });
      setError(error?.message || 'Could not add this user. Please try again.');
      syncSubmit();
      // A duplicate means the list is stale; refresh so the user drops out of the results.
      if (error?.name === 'DuplicateMemberError') runSearch();
    }
  }, { signal });

  element.addEventListener('shown.bs.modal', () => input.focus(), { signal });

  modal.show();
  return { result: modal.result, destroy: modal.destroy };
}
