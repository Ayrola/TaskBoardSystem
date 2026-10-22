import html from './projects.html?raw';
import './projects.css';
import { renderFragment } from '../../utils/render.js';

export const title = 'Projects';

export function mount(container) {
  renderFragment(container, html);
}
