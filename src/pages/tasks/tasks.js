import html from './tasks.html?raw';
import './tasks.css';
import { renderFragment, setText } from '../../utils/render.js';

export const title = 'Tasks';

export function mount(container, { params }) {
  renderFragment(container, html);
  const id = encodeURIComponent(params.id);
  setText(container, '[data-project-id]', params.id);
  container.querySelector('[data-link="edit"]').href = `/projects/${id}/edit`;
  container.querySelector('[data-link="users"]').href = `/projects/${id}/users`;
}
