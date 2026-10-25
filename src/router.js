import { routes, notFoundRoute } from './routes.js';
import { createCleanup } from './utils/cleanup.js';
import { initAuth, isAuthReady, getCurrentSession, onAuthChange } from './services/auth-service.js';

import { legacyProjectQuery } from './utils/project-navigation.js';
import { onProjectsChanged } from './services/project-events.js';

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
const startListeners = new Set();
export function onRouteStart(listener) {
  startListeners.add(listener);
  return () => startListeners.delete(listener);
}
let outlet = null;
let current = null;
let pendingController = null;
let renderToken = 0;
let renderedKey = null;
// Set by a page with unsaved work; returns true to allow leaving.
let leaveGuard = null;

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
  leaveGuard = null;
  pendingController?.abort();
  pendingController = null;
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
  let { route, params, notFound } = resolve(url.pathname);
  const query = Object.fromEntries(url.searchParams);

  unmountCurrent();
  const controller = new AbortController();
  pendingController = controller;
  renderedKey = url.pathname + url.search;
  showLoading();

  // Access is decided only after the stored session has been restored.
  if (!isAuthReady()) showLoading();
  await initAuth();
  if (token !== renderToken) return;

  const session = getCurrentSession();
  if ((route.access === 'private' || route.access === 'admin') && !session) {
    const returnTo = encodeURIComponent(url.pathname + url.search);
    navigate(`/login?returnTo=${returnTo}`, { replace: true });
    return;
  }
  if (route.access === 'guest' && session) {
    navigate(safeReturnTo(url.searchParams.get('returnTo')) ?? '/dashboard', { replace: true });
    return;
  }

  // Admin routes look like unknown pages to everyone else. This is a convenience: the database still
  // authorizes every admin read and write.
  if (route.access === 'admin') {
    let admin = false;
    try {
      admin = await (await import('./services/admin-service.js')).isAdmin();
    } catch (error) {
      console.error(error);
    }
    if (token !== renderToken) return;
    if (!admin) {
      route = notFoundRoute;
      params = {};
      notFound = true;
    }
  }

  const announce = project => startListeners.forEach(listener => listener({ path: url.pathname, params: route.project ? params : {}, access: route.access, project }));
  announce(null);
  let project = null;
  try {
    const context = route.project || route.legacySection ? await import('./services/project-context.js') : null;
    if (token !== renderToken) return;
    if (route.legacySection) {
      project = await context.resolveProjectEntry(session.user.id, { requestedId: query.project, signal: controller.signal });
      if (token !== renderToken) return;
      const suffix = legacyProjectQuery(route.legacySection, url.searchParams, query.project ? query.project === project?.id : true);
      navigate(project ? `/projects/${project.id}/${route.legacySection}${suffix}` : '/projects', { replace: true });
      return;
    }
    if (route.project) {
      project = await context.loadProjectContext(params.id, { signal: controller.signal });
      if (token !== renderToken) return;
      context.rememberProject(session.user.id, project.id);
      announce(project);
    }
  } catch (error) {
    if (token !== renderToken || controller.signal.aborted) return;
    showProjectError(error);
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
  const refreshListeners = new Set();
  const reselectListeners = new Set();
  const ctx = {
    project,
    pageTitle: page.title,
    onReselect(listener) { reselectListeners.add(listener); cleanup.add(() => reselectListeners.delete(listener)); },
    onProjectRefresh(listener) { refreshListeners.add(listener); cleanup.add(() => refreshListeners.delete(listener)); },
    params,
    query,
    path: url.pathname,
    notFound: Boolean(notFound),
    user: session?.user ?? null,
    signal: controller.signal,
    cleanup,
    navigate,
    setLeaveGuard(guard) {
      leaveGuard = guard;
    },
  };
  current = { cleanup, controller, reselectListeners };

  try {
    cleanup.add(await page.mount(outlet, ctx));
  } catch (error) {
    if (token !== renderToken) return;
    console.error(error);
    unmountCurrent();
    showError('Something went wrong while showing this page.');
    return;
  }
  if (token !== renderToken) return;

  if (project) {
    const breadcrumb = document.createElement('nav'); breadcrumb.className = 'small text-body-secondary mb-3'; breadcrumb.setAttribute('aria-label', 'Project context');
    const projectsLink = document.createElement('a'); projectsLink.href = '/projects'; projectsLink.textContent = 'Projects';
    const name = document.createElement('span'); name.textContent = ` / ${project.title}`; breadcrumb.append(projectsLink, name); outlet.prepend(breadcrumb);
    watchProject(ctx, refreshListeners, token, name);
  }
  const title = typeof page.title === 'function' ? page.title(ctx) : page.title;
  document.title = title ? `${title}${project ? ` · ${project.title}` : ''} · ${APP_NAME}` : APP_NAME;

  if (focus) moveFocus();
  listeners.forEach((listener) => listener({ path: url.pathname, params, notFound: ctx.notFound }));
}


function showProjectError(error) {
  document.title = `Project unavailable · ${APP_NAME}`;
  showError(error?.name === 'ProjectNotFoundError' ? 'Project not found or no longer accessible.' : 'Could not verify project access. Please try again.');
  const projects = document.createElement('a'); projects.href = '/projects'; projects.className = 'btn btn-primary me-2'; projects.textContent = 'Choose an accessible project';
  const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn btn-outline-secondary'; retry.textContent = 'Retry'; retry.onclick = () => render({ focus: true });
  const heading = document.createElement('h1'); heading.className = 'h2'; heading.textContent = 'Project unavailable';
  outlet.prepend(heading);
  outlet.append(projects, retry);
  moveFocus();
}
async function watchProject(ctx, refreshListeners, token, name) {
  const { loadProjectContext } = await import('./services/project-context.js');
  if (ctx.signal.aborted || token !== renderToken) return;
  let checking = false, dirty = false, timer;
  const check = async () => {
    if (checking) { dirty = true; return; }
    if (ctx.signal.aborted || token !== renderToken) return;
    checking = true;
    try {
      const project = await loadProjectContext(ctx.project.id, { signal: ctx.signal });
      if (ctx.signal.aborted || token !== renderToken) return;
      ctx.project = project; name.textContent = ` / ${project.title}`;
      document.title = `${typeof ctx.pageTitle === 'function' ? ctx.pageTitle(ctx) : ctx.pageTitle ?? 'Project'} · ${project.title} · ${APP_NAME}`;
      startListeners.forEach(listener => listener({ path: ctx.path, params: ctx.params, access: 'private', project }));
      for (const refresh of refreshListeners) refresh();
    } catch (error) {
      if (ctx.signal.aborted || token !== renderToken) return;
      unmountCurrent(); showProjectError(error);
      startListeners.forEach(listener => listener({ path: ctx.path, params: ctx.params, access: 'private', project: null }));
    } finally { checking = false; if (dirty && !ctx.signal.aborted) { dirty = false; schedule(); } }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(check, 150); };
  ctx.cleanup.add(() => clearTimeout(timer));
  ctx.cleanup.add(onProjectsChanged(schedule));
  ctx.cleanup.listen(window, 'focus', schedule);
  const poll = setInterval(() => { if (!document.hidden) schedule(); }, 60000);
  ctx.cleanup.add(() => clearInterval(poll));
  // The board already owns its subscription and defers refreshes during drags and edits.
  if (!ctx.path.endsWith('/tasks')) {
    const { subscribeToBoard } = await import('./services/board-realtime.js');
    if (ctx.signal.aborted || token !== renderToken) return;
    const realtime = subscribeToBoard(ctx.project.id, { onNotify: schedule, onSubscribed: reconnect => { if (reconnect) schedule(); } });
    ctx.cleanup.add(() => realtime.unsubscribe());
  }
}

export function navigate(to, { replace = false } = {}) {
  const url = new URL(to, location.href);
  if (url.origin !== location.origin) {
    location.assign(url.href);
    return;
  }
  const target = url.pathname + url.search + url.hash;
  if (target === location.pathname + location.search + location.hash) {
    if (!resolve(url.pathname).route.refreshOnReselect) return;
    if (leaveGuard && !leaveGuard()) return;
    // Re-selecting Dashboard is an explicit refresh, including recovery from a failed mount.
    // Keep the current page/period when mounted, and avoid adding duplicate history entries.
    if (current?.reselectListeners.size) {
      for (const refresh of current.reselectListeners) refresh();
    } else {
      render({ focus: true });
    }
    return;
  }
  if (leaveGuard && !leaveGuard()) return;
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
  if (leaveGuard && !leaveGuard()) {
    // The browser already moved; put the current page's URL back.
    history.pushState({}, '', renderedKey);
    return;
  }
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
    leaveGuard = null; // the previous user's unsaved work is discarded, no prompt
    const { route } = resolve(location.pathname);
    if (!session && (route.access === 'private' || route.access === 'admin')) navigate('/', { replace: true });
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
    startListeners.clear();
  };
}
