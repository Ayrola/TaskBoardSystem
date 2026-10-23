import { mountThemeSelector } from '../theme-selector/theme-selector.js';
import html from './footer.html?raw';
import './footer.css';
import { renderFragment, setText } from '../../utils/render.js';

export function mountFooter(container) {
  renderFragment(container, html);
  setText(container, '[data-year]', new Date().getFullYear());
  const host = document.createElement('div'); host.className = 'footer-theme';
  container.querySelector('.container').append(host);
  const stopTheme = mountThemeSelector(host);
  return () => { stopTheme(); container.replaceChildren(); };
}
