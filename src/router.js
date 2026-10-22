import { routes, notFoundRoute } from './routes.js';
import { createCleanup } from './utils/cleanup.js';

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

function unmountCurrent() {
  if (!current) return;
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
  const ctx = { params, query, path: url.pathname, notFound: Boolean(notFound), cleanup, navigate };
  current = { cleanup };

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
  render({ focus: false });

  return () => {
    document.removeEventListener('click', onClick);
    window.removeEventListener('popstate', onPopState);
    renderToken++;
    unmountCurrent();
    listeners.clear();
  };
}
