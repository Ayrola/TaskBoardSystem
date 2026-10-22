import html from './users.html?raw';
import './users.css';
import { renderFragment, setText } from '../../utils/render.js';

export const title = 'Project users';

export function mount(container, { params }) {
  renderFragment(container, html);
  setText(container, '[data-project-id]', params.id);
  container.querySelector('[data-link="tasks"]').href = `/projects/${encodeURIComponent(params.id)}/tasks`;
}
