import html from './home.html?raw';
import './home.css';
import { renderFragment } from '../../utils/render.js';

export const title = 'Home';

export function mount(container) {
  renderFragment(container, html);
}
