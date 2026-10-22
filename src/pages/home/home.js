import html from './home.html?raw';
import './home.css';
import { renderFragment } from '../../utils/render.js';
import { getSession, onSessionChange } from '../../services/auth-service.js';

export const title = 'Home';

// Public page: only the signed-in state is read, never any project data.
export function mount(container, { cleanup }) {
  renderFragment(container, html);
  let active = true;

  function showFor(session) {
    const signedIn = Boolean(session);
    for (const element of container.querySelectorAll('[data-auth]')) {
      element.hidden = (element.dataset.auth === 'user') !== signedIn;
    }
  }

  showFor(null);
  getSession().then((session) => {
    if (active) showFor(session);
  });
  cleanup.add(onSessionChange((session) => active && showFor(session)));
  cleanup.add(() => {
    active = false;
  });
}
