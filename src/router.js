import { routes, notFoundRoute } from './routes.js';
import { createCleanup } from './utils/cleanup.js';
import { initAuth, isAuthReady, getCurrentSession, onAuthChange } from './services/auth-service.js';

const APP_NAME = 'Taskboard';

const compiled = routes.map((route) => {
  const keys = [];
  const pattern = route.path.replace(/:([A-Za-z]+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { ...route, keys, regex: new RegExp(`^${pattern}$`) };
});

const listeners = new Set();
let outlet = null;
let current = null;
let renderToken = 0;
let renderedKey = null;

function normalize(pathname) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
}

export function resolve(pathname) {
  const path = normalize(pathname);
  for (const route of compiled) {
    const match = route.regex.exec(path);
    if (!match) continue;
    try {
      const params = Object.fromEntries(
        route.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]),
      );
      return { route, params };
    } catch {
      break; // malformed percent-encoding
    }
  }
  return { route: notFoundRoute, params: {}, notFound: true };
}

export function onRouteChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Accepts only same-origin, in-app paths to a real, non-guest route. Prevents open redirects.
export function safeReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  if (value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return null;
  let url;
  try {
    url = new URL(value, location.origin);
  } catch {
    return null;
  }
  if (url.origin !== location.origin) return null;
  const { route, notFound } = resolve(url.pathname);
  if (notFound || route.access === 'guest') return null;
  return url.pathname + url.search + url.hash;
}

function unmountCurrent() {
  if (!current) return;
  current.controller.abort(); // cancels pending page requests that listen to ctx.signal
  current.cleanup.run();
  outlet.replaceChildren();
  current = null;
}

function moveFocus() {
  const target = outlet.querySelector('h1') ?? outlet;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function showLoading() {
  const status = document.createElement('div');
  status.className = 'text-body-secondary';
  status.setAttribute('role', 'status');
  status.textContent = 'Loading…';
  outlet.replaceChildren(status);
}

function showError(message) {
  const alert = document.createElement('div');
  alert.className = 'alert alert-danger';
  alert.setAttribute('role', 'alert');
  alert.textContent = message;
  outlet.replaceChildren(alert);
}

async function render({ focus }) {
  const token = ++renderToken;
  const url = new URL(location.href);
  const { route, params, notFound } = resolve(url.pathname);
  const query = Object.fromEntries(url.searchParams);

  unmountCurrent();
  renderedKey = url.pathname + url.search;

  // Access is decided only after the stored session has been restored.
  if (!isAuthReady()) showLoading();
  await initAuth();
  if (token !== renderToken) return;

  const session = getCurrentSession();
  if (route.access === 'private' && !session) {
    const returnTo = encodeURIComponent(url.pathname + url.search);
    navigate(`/login?returnTo=${returnTo}`, { replace: true });
    return;
  }
  if (route.access === 'guest' && session) {
    navigate(safeReturnTo(url.searchParams.get('returnTo')) ?? '/dashboard', { replace: true });
    return;
  }

  let page;
  try {
    page = await route.load();
  } catch (error) {
    if (token !== renderToken) return;
    console.error(error);
    document.title = `Error · ${APP_NAME}`;
    showError('This page could not be loaded. Please try again.');
    return;
  }
  if (token !== renderToken) return; // a newer navigation superseded this one

  const cleanup = createCleanup();
  const controller = new AbortController();
  const ctx = {
    params,
    query,
    path: url.pathname,
    notFound: Boolean(notFound),
    user: session?.user ?? null,
    signal: controller.signal,
    cleanup,
    navigate,
  };
  current = { cleanup, controller };

  try {
    cleanup.add(await page.mount(outlet, ctx));
  } catch (error) {
    console.error(error);
    unmountCurrent();
    showError('Something went wrong while showing this page.');
  }
  if (token !== renderToken) return;

  const title = typeof page.title === 'function' ? page.title(ctx) : page.title;
  document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;

  if (focus) moveFocus();
  listeners.forEach((listener) => listener({ path: url.pathname, params, notFound: ctx.notFound }));
}

export function navigate(to, { replace = false } = {}) {
  const url = new URL(to, location.href);
  if (url.origin !== location.origin) {
    location.assign(url.href);
    return;
  }
  const target = url.pathname + url.search + url.hash;
  if (target === location.pathname + location.search + location.hash) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', target);
  render({ focus: true });
}

function onClick(event) {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (!(event.target instanceof Element)) return;

  const anchor = event.target.closest('a[href]');
  if (!anchor) return;
  if (anchor.target && anchor.target !== '_self') return;
  if (anchor.hasAttribute('download') || anchor.hasAttribute('data-external')) return;
  if (anchor.rel.split(/\s+/).includes('external')) return;

  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin) return;

  // In-page anchors (e.g. skip link) are handled natively by the browser.
  if (url.hash && url.pathname === location.pathname && url.search === location.search) return;

  event.preventDefault();
  navigate(url.pathname + url.search + url.hash);
}

function onPopState() {
  // Hash-only history entries do not change the rendered page.
  if (location.pathname + location.search === renderedKey) return;
  render({ focus: true });
}

export function startRouter(container) {
  outlet = container;
  document.addEventListener('click', onClick);
  window.addEventListener('popstate', onPopState);

  // A different user (or none) means the mounted page may hold the previous user's data:
  // leave private pages on sign-out, otherwise remount so everything is rebuilt and re-checked.
  const stopAuthWatch = onAuthChange(({ session, userChanged }) => {
    if (!userChanged) return;
    const { route } = resolve(location.pathname);
    if (!session && route.access === 'private') navigate('/', { replace: true });
    else render({ focus: false });
  });

  render({ focus: false });

  return () => {
    stopAuthWatch();
    document.removeEventListener('click', onClick);
    window.removeEventListener('popstate', onPopState);
    renderToken++;
    unmountCurrent();
    listeners.clear();
  };
}
