import { createSummaryCard } from '../../components/summary-card/summary-card.js';
import html from './dashboard.html?raw';
import './dashboard.css';
import { renderFragment, setText } from '../../utils/render.js';
import { getDashboardStats } from '../../services/dashboard-service.js';

export const title = 'Dashboard';

export function mount(container, ctx) {
  renderFragment(container, html);
  const base = `/projects/${ctx.project.id}`;
  container.querySelector('[data-open-board]').href = `${base}/tasks`;
  const root = container.querySelector('.page-dashboard');
  const panels = root.querySelectorAll('[data-state]');
  let requestId = 0;

  const show = (state) => {
    panels.forEach((panel) => { panel.hidden = panel.dataset.state !== state; });
    root.setAttribute('aria-busy', String(state === 'loading'));
    root.querySelector('[data-empty]').hidden = true;
  };

  async function load() {
    const current = ++requestId;
    root.querySelector('h1').textContent = `${ctx.project.title} · Dashboard`;
    show('loading');
    try {
      const stats = await getDashboardStats({ projectId: ctx.project.id, signal: ctx.signal });
      // Ignore results of superseded requests or a page that has been unmounted.
      if (current !== requestId || ctx.signal.aborted) return;

      const cards = [
        ['Stages',stats.stageCount,'kanban',`${base}/tasks`],
        ['Total tasks',stats.totalTasks,'card-checklist',`${base}/task-list`],
        ['Open tasks',stats.openTasks,'circle',`${base}/task-list?status=open`],
        ['Done tasks',stats.doneTasks,'check-circle',`${base}/task-list?status=done`],
      ].map(([label,value,icon,href]) => {
        const slot=document.createElement('div');slot.className='col-6 col-lg-3';
        slot.append(createSummaryCard({label,value,icon,href}));return slot;
      });
      root.querySelector('[data-summary-cards]').replaceChildren(...cards);
      show('stats');
      root.querySelector('[data-empty]').hidden = stats.totalTasks !== 0;
    } catch (error) {
      if (current !== requestId || ctx.signal.aborted) return;
      setText(root, '[data-error-text]', error.message);
      show('error');
    }
  }

  ctx.cleanup.listen(root.querySelector('[data-retry]'), 'click', load);
  ctx.onProjectRefresh(load);
  load();
}
