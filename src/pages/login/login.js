import html from './login.html?raw';
import './login.css';
import { renderFragment } from '../../utils/render.js';

export const title = 'Log in';

export function mount(container) {
  renderFragment(container, html);
}
