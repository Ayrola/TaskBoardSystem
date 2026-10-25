import { openReportExportModal } from '../../components/report-export-modal/report-export-modal.js';
import Chart from 'chart.js/auto';
import { createSummaryCard } from '../../components/summary-card/summary-card.js';
import html from './dashboard.html?raw';
import './dashboard.css';
import { renderFragment, setText } from '../../utils/render.js';
import { getProjectDashboard } from '../../services/project-dashboard-service.js';
import { ProjectNotFoundError } from '../../services/projects-service.js';
import { displayTimezone } from '../../utils/deadlines.js';
import { activitySummary } from '../../utils/activity.js';

export const title = 'Dashboard';
export function mount(container, ctx) {
  renderFragment(container, html);
  const root = container.querySelector('.page-dashboard');
  const base = `/projects/${encodeURIComponent(ctx.project.id)}`;
  const content = root.querySelector('[data-content]');
  const loading = root.querySelector('[data-loading]');
  const errorBox = root.querySelector('[data-error]');
  const period = root.querySelector('[data-period]');
  const refresh = root.querySelector('[data-refresh]');
  const timezone = displayTimezone();
  let exportDialog = null;
  let snapshot = null, controller = null, generation = 0, charts = [], chartNavigationTimer = null;
  const percent = (count, total) => total ? Math.round(count / total * 1000) / 10 : 0;
  const boardLink = (filters = {}) => `${base}/tasks${Object.keys(filters).length ? `?${new URLSearchParams(filters)}` : ''}`;
  const taskLink = id => boardLink({ task: id });
  const text = (selector, value) => setText(root, selector, value);
  const dateTime = value => new Intl.DateTimeFormat(undefined, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  root.querySelector('[data-dashboard-link]').href = `${base}/dashboard`;
  root.querySelector('[data-board-link]').href = boardLink();
  root.querySelector('[data-deadlines-link]').href = `${base}/deadlines`;
  root.querySelector('[data-activity-link]').href = `${base}/activity`;
  const link = (label, href) => { const a = document.createElement('a'); a.textContent = label; a.href = href; return a; };
  const empty = (list, label) => { if (!list.children.length) { const li = document.createElement('li'); li.textContent = label; li.className = 'text-body-secondary'; list.append(li); } };
  function destroyCharts() { charts.forEach(chart => chart.destroy()); charts = []; }
  function renderCharts() {
    destroyCharts();
    if (!snapshot || content.hidden || ctx.signal.aborted) return;
    const styles = getComputedStyle(root);
    const colour = key => styles.getPropertyValue(key).trim();
    const ink = colour('--app-secondary'), grid = colour('--app-border'), accent = colour('--app-button-bg'), muted = colour('--app-muted');
    const options = {
      responsive: true, maintainAspectRatio: false, animation: false,
      color: ink, plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: muted, precision: 0 }, grid: { color: grid } }, y: { ticks: { color: ink }, grid: { display: false } } },
    };
    const { totals, stages, creation } = snapshot;
    root.querySelector('[data-stage-chart-wrap]').style.height = `${Math.max(180, Math.min(480, stages.length * 38 + 35))}px`;
    charts.push(new Chart(root.querySelector('[data-chart="stages"]'), {
      type: 'bar', data: { labels: stages.map(s => s.name), datasets: [{ data: stages.map(s => s.count), backgroundColor: stages.map(s => /^#[0-9a-f]{6}$/i.test(s.colour ?? '') ? s.colour : accent), borderRadius: 4, maxBarThickness: 18 }] },
      options: { ...options, indexAxis: 'y', scales: { ...options.scales, x: { ...options.scales.x, beginAtZero: true } },
        onClick: (_, items) => {
          if (!items.length) return;
          const destination = boardLink({ stage: stages[items[0].index].id });
          // Chart.js finishes its event render after this callback; navigate once that has returned.
          clearTimeout(chartNavigationTimer);
          chartNavigationTimer = setTimeout(() => { if (!ctx.signal.aborted) ctx.navigate(destination); }, 0);
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.raw} tasks · ${percent(c.raw, totals.total)}%` } } },
      },
    }));
    charts.push(new Chart(root.querySelector('[data-chart="completion"]'), {
      type: 'doughnut', data: { labels: totals.total ? ['Open', 'Completed'] : ['No tasks'], datasets: [{ data: totals.total ? [totals.open, totals.completed] : [1], backgroundColor: totals.total ? [colour('--app-muted'), accent] : [colour('--app-hover')], borderWidth: 0, hoverOffset: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, cutout: '78%', plugins: { legend: { display: false }, tooltip: { enabled: Boolean(totals.total) } } },
    }));
    charts.push(new Chart(root.querySelector('[data-chart="creation"]'), {
      type: 'line', data: { labels: creation.map(d => d.day), datasets: [{ label: 'Tasks created', data: creation.map(d => d.count), borderColor: accent, backgroundColor: accent, borderWidth: 2, pointRadius: creation.length > 30 ? 0 : 2, pointHitRadius: 10, tension: 0 }] },
      options: { ...options, scales: { x: { ...options.scales.x, ticks: { color: muted, maxTicksLimit: 7, maxRotation: 0 } }, y: { ...options.scales.y, beginAtZero: true, ticks: { color: muted, precision: 0 } } } },
    }));
  }
  function render(data) {
    const { totals, stages } = data;
    text('[data-project-name]', ctx.project.title);
    text('[data-refreshed]', `Last refreshed ${dateTime(data.as_of)} · ${timezone}`);
    text('[data-period-note]', `Period affects task creation and recent activity only. Showing last ${data.days} days.`);
    const completion = percent(totals.completed, totals.total);
    const cards = [
      ['Total tasks', totals.total, 'card-checklist', {}, 'All current tasks in this project, across every page.'],
      ['Open tasks', totals.open, 'circle', { status: 'open' }, 'Current tasks whose stage does not count as done.'],
      ['Completed tasks', totals.completed, 'check-circle', { status: 'completed' }, 'Current tasks in stages that count as done.'],
      ['Completion', `${completion}%`, 'pie-chart', { status: 'completed' }, 'Completed tasks divided by total current tasks. Zero tasks shows neutral 0%.'],
      ['Overdue open tasks', totals.overdue, 'calendar-x', { status: 'open', due: 'overdue' }, 'Open tasks with a deadline strictly before the snapshot time.'],
      ['Unassigned open tasks', totals.unassigned, 'person-dash', { status: 'open', assignment: 'unassigned' }, 'Open tasks with no task assignees.'],
    ];
    root.querySelector('[data-summary-cards]').replaceChildren(...cards.map(([label, value, icon, filters, definition]) => {
      const card = createSummaryCard({ label, value, icon, href: boardLink(filters) }); card.title = definition; card.setAttribute('aria-description', definition); return card;
    }));
    root.querySelector('[data-empty]').hidden = totals.total !== 0;
    const add = root.querySelector('[data-add-task]');
    add.href = boardLink(stages.length ? { add: '1' } : {});
    add.textContent = stages.length ? 'Add Task' : 'Open board to add a stage';
    const stageTable = root.querySelector('[data-stage-table]'); stageTable.replaceChildren();
    stages.forEach(stage => {
      const row = document.createElement('tr'), name = document.createElement('th'); name.scope = 'row';
      name.append(link(stage.name, boardLink({ stage: stage.id })));
      const count = document.createElement('td'); count.textContent = Number(stage.count).toLocaleString();
      const share = document.createElement('td'); share.textContent = `${percent(stage.count, totals.total)}%`;
      row.append(name, count, share); stageTable.append(row);
    });
    if (!stages.length) { const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 3; cell.textContent = 'No stages yet.'; row.append(cell); stageTable.append(row); }
    text('[data-chart-total]', Number(totals.total).toLocaleString());
    root.querySelector('[data-completion-key]').replaceChildren(link(`Open · ${totals.open}`, boardLink({ status: 'open' })), link(`Completed · ${totals.completed}`, boardLink({ status: 'completed' })));
    text('[data-completion-note]', totals.total ? `${completion}% of current tasks completed.` : 'No tasks yet. Completion is 0%; the ring is neutral.');
    text('[data-trend-period]', `Last ${data.days} days`);
    text('[data-trend-definition]', `Current tasks created per calendar day in ${timezone}, including today through this snapshot. Deleted tasks are excluded; missing days show zero.`);
    const creationTable = root.querySelector('[data-creation-table]'); creationTable.replaceChildren();
    data.creation.forEach(day => { const tr = document.createElement('tr'); const date = document.createElement('th'); date.scope = 'row'; date.textContent = day.day; const count = document.createElement('td'); count.textContent = day.count; tr.append(date, count); creationTable.append(tr); });
    const workload = root.querySelector('[data-workload]'); workload.replaceChildren();
    [...data.workload, { label: 'Unassigned', count: totals.unassigned, user_id: null }].forEach(person => {
      const li = document.createElement('li'); const a = link(person.label, boardLink(person.user_id ? { status: 'open', assignee: person.user_id } : { status: 'open', assignment: 'unassigned' }));
      const count = document.createElement('strong'); count.textContent = person.count; a.append(count);
      const progress = document.createElement('progress'); progress.max = Math.max(1, totals.open); progress.value = person.count; progress.setAttribute('aria-label', `${person.label}: ${person.count} open tasks`); li.append(a, progress); workload.append(li);
    });
    for (const bucket of ['overdue', 'upcoming']) {
      const list = root.querySelector(`[data-${bucket}]`); list.replaceChildren();
      data.deadlines[bucket].forEach(task => { const li = document.createElement('li'), time = document.createElement('time'); time.dateTime = task.due_at; time.textContent = `${dateTime(task.due_at)} · ${timezone}`; li.append(link(task.title, taskLink(task.id)), time); list.append(li); });
      empty(list, bucket === 'overdue' ? 'No overdue open tasks.' : 'No upcoming deadlines.');
    }
    const activity = root.querySelector('[data-activity]'); activity.replaceChildren();
    text('[data-activity-definition]', `Latest eight recorded task events in the last ${data.days} calendar days (${timezone}).`);
    data.activity.forEach(entry => {
      const li = document.createElement('li'), title = entry.task_exists ? link(entry.task_title, taskLink(entry.task_id)) : document.createElement('strong');
      title.textContent = entry.task_title;
      const summary = document.createElement('small'); summary.textContent = activitySummary(entry);
      const time = document.createElement('time'); time.dateTime = entry.created_at; time.textContent = dateTime(entry.created_at);
      li.append(title, summary, time); activity.append(li);
    });
    empty(activity, 'No recorded task activity in this period.');
    renderCharts();
  }
  async function load() {
    controller?.abort(); controller = new AbortController(); const activeController = controller;
    const abort = () => activeController.abort(); ctx.signal.addEventListener('abort', abort, { once: true });
    const current = ++generation;
    errorBox.hidden = true; root.setAttribute('aria-busy', 'true'); refresh.disabled = true;
    if (snapshot) text('[data-refreshed]', 'Refreshing… Displaying the last successful snapshot.');
    try {
      const data = await getProjectDashboard(ctx.project.id, { days: Number(period.value), timezone, signal: activeController.signal });
      if (current !== generation || ctx.signal.aborted || activeController.signal.aborted) return;
      snapshot = data; loading.hidden = true; content.hidden = false; render(data);
    } catch (error) {
      if (current !== generation || ctx.signal.aborted || activeController.signal.aborted) return;
      loading.hidden = true;
      if (error instanceof ProjectNotFoundError) { snapshot = null; content.hidden = true; destroyCharts(); }
      text('[data-error-text]', error instanceof ProjectNotFoundError ? 'Project not found or no longer accessible.' : error.message);
      errorBox.hidden = false;
      text('[data-refreshed]', snapshot ? `Refresh failed · showing ${dateTime(snapshot.as_of)} · ${timezone}` : 'No dashboard data loaded.');
    } finally {
      ctx.signal.removeEventListener('abort', abort);
      if (current === generation && !ctx.signal.aborted) { root.setAttribute('aria-busy', 'false'); refresh.disabled = false; }
    }
  }
  const observer = new MutationObserver(renderCharts);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });
  ctx.cleanup.add(() => { controller?.abort(); generation++; clearTimeout(chartNavigationTimer); observer.disconnect(); destroyCharts(); });
  ctx.cleanup.add(() => exportDialog?.destroy());
  ctx.cleanup.listen(root.querySelector('[data-export-pdf]'), 'click', async () => {
    if (exportDialog) return;
    exportDialog = openReportExportModal({ projectId: ctx.project.id, timezone, days: Number(period.value) });
    try { await exportDialog.result; } finally { exportDialog = null; }
  });
  ctx.cleanup.listen(refresh, 'click', load);
  ctx.cleanup.listen(root.querySelector('[data-retry]'), 'click', load);
  ctx.cleanup.listen(period, 'change', load);
  // The router already owns a debounced, permission-aware project Realtime subscription.
  ctx.onProjectRefresh(load);
  ctx.onReselect(load);
  text('[data-project-name]', ctx.project.title);
  load();
}
