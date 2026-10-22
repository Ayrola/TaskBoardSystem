import html from './dashboard.html?raw';
import './dashboard.css';
import { renderFragment, setText } from '../../utils/render.js';
import { getDashboardStats } from '../../services/dashboard-service.js';

export const title = 'Dashboard';

export function mount(container, ctx) {
  renderFragment(container, html);
  const root = container.querySelector('.page-dashboard');
  const panels = root.querySelectorAll('[data-state]');
  let requestId = 0;

  const show = (state) => {
    panels.forEach((panel) => { panel.hidden = panel.dataset.state !== state; });
    root.setAttribute('aria-busy', String(state === 'loading'));
  };

  async function load() {
    const current = ++requestId;
    show('loading');
    try {
      const stats = await getDashboardStats({ signal: ctx.signal });
      // Ignore results of superseded requests or a page that has been unmounted.
      if (current !== requestId || ctx.signal.aborted) return;

      for (const [key, value] of Object.entries(stats)) {
        setText(root, `[data-stat="${key}"]`, value.toLocaleString());
      }
      show(stats.projectCount === 0 ? 'empty' : 'stats');
    } catch (error) {
      if (current !== requestId || ctx.signal.aborted) return;
      setText(root, '[data-error-text]', error.message);
      show('error');
    }
  }

  ctx.cleanup.listen(root.querySelector('[data-retry]'), 'click', load);
  load();
}
