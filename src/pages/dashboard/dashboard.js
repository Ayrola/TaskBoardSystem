import html from './dashboard.html?raw';
import './dashboard.css';
import { renderFragment } from '../../utils/render.js';

export const title = 'Dashboard';

export function mount(container) {
  renderFragment(container, html);
}
