import Collapse from 'bootstrap/js/dist/collapse';
import html from './header.html?raw';
import './header.css';
import { renderFragment } from '../../utils/render.js';
import { createCleanup } from '../../utils/cleanup.js';
import { onRouteChange, navigate } from '../../router.js';
import { getSession, onSessionChange, signOut } from '../../services/auth-service.js';
import { showError } from '../../services/toast-service.js';

function isActive(href, path) {
  return path === href || path.startsWith(`${href}/`);
}

export function mountHeader(container) {
  const cleanup = createCleanup();
  renderFragment(container, html);

  const links = [...container.querySelectorAll('[data-nav]')];
  const menu = container.querySelector('#main-nav');
  const logout = container.querySelector('[data-logout]');
  let disposed = false;

  function updateActive(path) {
    for (const link of links) {
      const active = isActive(link.dataset.nav, path);
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    Collapse.getInstance(menu)?.hide();
  }

  function updateAuth(session) {
    const signedIn = Boolean(session);
    for (const element of container.querySelectorAll('[data-auth]')) {
      element.hidden = (element.dataset.auth === 'user') !== signedIn;
    }
  }

  async function onLogout() {
    logout.disabled = true;
    const { error } = await signOut();
    logout.disabled = false;
    if (error) {
      console.error('Logout failed', error.message);
      showError('Could not log out. Please try again.', { key: 'logout-failed' });
      return;
    }
    navigate('/');
  }

  updateActive(location.pathname);
  updateAuth(null);
  getSession().then((session) => {
    if (!disposed) updateAuth(session);
  });

  cleanup.add(onRouteChange(({ path }) => updateActive(path)));
  cleanup.add(onSessionChange(updateAuth));
  cleanup.listen(logout, 'click', onLogout);
  cleanup.add(() => Collapse.getInstance(menu)?.dispose());
  cleanup.add(() => {
    disposed = true;
    container.replaceChildren();
  });

  return () => cleanup.run();
}
