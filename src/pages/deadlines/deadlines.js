import html from './deadlines.html?raw';
import { renderFragment } from '../../utils/render.js';
import { displayTimezone, formatDeadline, saveDisplayTimezone, validTimezone, browserTimezone } from '../../utils/deadlines.js';
import { listDeadlines, DEADLINES_PAGE_SIZE } from '../../services/deadlines-service.js';
import { pageFromQuery, renderPager, totalPages } from '../../utils/pager.js';
export const title = 'Deadlines';
export function mount(container, ctx) {
  renderFragment(container, html);
  const root = container.querySelector('[data-deadlines]');
  const form = root.querySelector('form');
  const results = root.querySelector('[data-results]');
  const errorBox = root.querySelector('[data-error]');
  const retry = root.querySelector('[data-retry]');
  const status = root.querySelector('[data-status]');
  const pager = root.querySelector('[data-pager]');
  const bucket = ctx.query.bucket ?? 'overdue';
  const timezone = ctx.query.timezone ?? displayTimezone();
  const projectId = ctx.project.id;
  const page = pageFromQuery(ctx.query);
  let generation = 0;
  let loading = false;
  form.elements.bucket.value = bucket;
  form.elements.timezone.value = timezone;
  const zones = new Set([browserTimezone(), 'UTC', ...(Intl.supportedValuesOf?.('timeZone') ?? [])]);
  const options = [...zones].sort().map((zone) => { const option = document.createElement('option'); option.value = zone; return option; });
  root.querySelector('datalist').append(...options);
  function fail(message) {
    errorBox.textContent = message; errorBox.hidden = false; retry.hidden = false; status.textContent = '';
  }
  ctx.cleanup.listen(form, 'submit', (event) => {
    event.preventDefault();
    if (!validTimezone(form.elements.timezone.value)) {
      fail('Choose a valid IANA timezone, such as Europe/Sofia.'); form.elements.timezone.focus(); return;
    }
    saveDisplayTimezone(form.elements.timezone.value);
    const query = new URLSearchParams({ bucket: form.elements.bucket.value, timezone: form.elements.timezone.value });
    ctx.navigate(`/projects/${projectId}/deadlines?${query}`);
  });
  async function load() {
    if (loading) return;
    const current = ++generation; loading = true;
    root.setAttribute('aria-busy', 'true'); errorBox.hidden = true; retry.hidden = true;
    status.textContent = 'Loading deadlines…'; results.replaceChildren(); pager.hidden = true;
    try {
      const [result, counts] = await Promise.all([
        listDeadlines({ bucket, timezone, projectId, page, signal: ctx.signal }),
        Promise.all(['overdue', 'today', 'upcoming'].map(async selected => [selected, (await listDeadlines({ bucket: selected, timezone, projectId, countOnly: true, signal: ctx.signal })).total])),
      ]);
      if (ctx.signal.aborted || current !== generation) return;
      root.querySelector('[data-bucket-counts]').replaceChildren(...counts.map(([value, count]) => {
        const link = document.createElement('a'); link.className = `btn btn-sm ${value === bucket ? 'btn-primary' : 'btn-outline-secondary'}`;
        link.textContent = `${value[0].toUpperCase() + value.slice(1)} · ${count}`;
        link.href = `/projects/${projectId}/deadlines?${new URLSearchParams({ bucket: value, timezone })}`;
        if (value === bucket) link.setAttribute('aria-current', 'page');
        return link;
      }));
      root.querySelector('[data-zone-summary]').textContent = `Dates shown in ${timezone}. Today: ${formatDeadline(result.day_start, timezone)} to ${formatDeadline(result.day_end, timezone)} (end excluded).`;
      for (const task of result.rows) {
        const li = document.createElement('li'); li.className = 'list-group-item';
        const link = document.createElement('a'); link.textContent = task.title;
        link.href = `/projects/${task.project_id}/tasks?task=${task.id}`;
        const project = document.createElement('div'); project.className = 'small text-body-secondary'; project.textContent = task.project_title;
        const deadline = document.createElement('p'); deadline.className = 'small mb-0';
        const time = document.createElement('time'); time.dateTime = task.due_at; time.textContent = formatDeadline(task.due_at, timezone);
        deadline.append(time);
        if (task.overdue) { deadline.prepend('Overdue · '); deadline.classList.add('text-danger', 'fw-semibold'); }
        li.append(link, project, deadline); results.append(li);
      }
      status.textContent = result.total ? '' : 'No matching open tasks with deadlines.';
      if (page > totalPages(result.total, DEADLINES_PAGE_SIZE)) status.textContent = 'This page no longer has results. Use Previous to return to earlier results.';
      renderPager(pager, { page, total: result.total, pageSize: DEADLINES_PAGE_SIZE });
    } catch (error) { if (!ctx.signal.aborted && current === generation) fail(error.message); }
    finally { loading = false; if (!ctx.signal.aborted) root.setAttribute('aria-busy', 'false'); }
  }
  ctx.cleanup.listen(retry, 'click', load);
  const timer = setInterval(() => { if (!document.hidden) load(); }, 60000);
  ctx.cleanup.add(() => clearInterval(timer));
  ctx.cleanup.listen(document, 'visibilitychange', () => { if (!document.hidden) load(); });
  ctx.onProjectRefresh(load);
  load();
}
