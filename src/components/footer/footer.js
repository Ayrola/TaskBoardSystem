import html from './footer.html?raw';
import './footer.css';
import { renderFragment, setText } from '../../utils/render.js';

export function mountFooter(container) {
  renderFragment(container, html);
  setText(container, '[data-year]', new Date().getFullYear());
  return () => container.replaceChildren();
}
