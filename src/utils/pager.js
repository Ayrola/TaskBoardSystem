export const pageFromQuery = (query) => {
  const page = Number.parseInt(query.page, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
};

export const totalPages = (total, pageSize) => Math.max(1, Math.ceil(total / pageSize));

// Page links keep the other query parameters (such as a search) and are handled by the router.
export function renderPager(container, { page, total, pageSize }) {
  container.replaceChildren();
  const pages = totalPages(total, pageSize);
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  const summary = document.createElement('span');
  summary.className = 'text-body-secondary small';
  summary.textContent = total === 0 ? 'No results' : `Showing ${first}–${last} of ${total.toLocaleString()}`;

  const list = document.createElement('ul');
  list.className = 'pagination pagination-sm mb-0';
  const hrefFor = (target) => {
    const params = new URLSearchParams(location.search);
    if (target === 1) params.delete('page');
    else params.set('page', String(target));
    const query = params.toString();
    return `${location.pathname}${query ? `?${query}` : ''}`;
  };
  const item = (label, target, disabled, ariaLabel) => {
    const li = document.createElement('li');
    li.className = `page-item${disabled ? ' disabled' : ''}`;
    const a = document.createElement(disabled ? 'span' : 'a');
    a.className = 'page-link';
    a.textContent = label;
    a.setAttribute('aria-label', ariaLabel);
    if (disabled) a.setAttribute('aria-disabled', 'true');
    else a.href = hrefFor(target);
    li.append(a);
    return li;
  };
  const current = document.createElement('li');
  current.className = 'page-item active';
  const currentLabel = document.createElement('span');
  currentLabel.className = 'page-link';
  currentLabel.setAttribute('aria-current', 'page');
  currentLabel.textContent = `Page ${page} of ${pages}`;
  current.append(currentLabel);
  list.append(
    item('‹ Previous', page - 1, page <= 1, 'Previous page'),
    current,
    item('Next ›', page + 1, page >= pages, 'Next page'),
  );

  container.append(summary, list);
  container.hidden = total === 0;
}
