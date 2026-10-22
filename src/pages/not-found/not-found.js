import html from './not-found.html?raw';
import './not-found.css';
import { renderFragment, setText } from '../../utils/render.js';

export const title = 'Page not found';

export function mount(container, { path }) {
  renderFragment(container, html);
  setText(container, '[data-path]', path);
}
