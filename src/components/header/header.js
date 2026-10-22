import Collapse from 'bootstrap/js/dist/collapse';
import html from './header.html?raw';
import './header.css';
import { renderFragment } from '../../utils/render.js';
import { createCleanup } from '../../utils/cleanup.js';
import { onRouteChange } from '../../router.js';

function isActive(href, path) {
  if (href === '/') return path === '/';
  return path === href || path.startsWith(`${href}/`);
}

export function mountHeader(container) {
  const cleanup = createCleanup();
  renderFragment(container, html);

  const links = [...container.querySelectorAll('[data-nav]')];
  const menu = container.querySelector('#main-nav');

  function update(path) {
    for (const link of links) {
      const active = isActive(link.dataset.nav, path);
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    Collapse.getInstance(menu)?.hide();
  }

  update(location.pathname);
  cleanup.add(onRouteChange(({ path }) => update(path)));
  cleanup.add(() => Collapse.getInstance(menu)?.dispose());
  cleanup.add(() => container.replaceChildren());

  return () => cleanup.run();
}
