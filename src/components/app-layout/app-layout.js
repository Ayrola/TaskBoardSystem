import Offcanvas from 'bootstrap/js/dist/offcanvas';
import html from './app-layout.html?raw';
import '../taskboard-tokens.css';
import './app-layout.css';
import { onRouteStart, onRouteChange, navigate } from '../../router.js';
import { getCurrentSession, getAuthEpoch, onAuthChange, signOut } from '../../services/auth-service.js';
import { onProjectsChanged } from '../../services/project-events.js';
import { showError } from '../../services/toast-service.js';

export function mountAppLayout(container) {
  container.innerHTML = html;
  const sidebar = container.querySelector('.app-sidebar');
  const list = container.querySelector('.sidebar-projects');
  const search = container.querySelector('input');
  const opener = container.querySelector('[data-open-sidebar]');
  const collapse = container.querySelector('.sidebar-collapse');
  const media = matchMedia('(max-width: 767.98px)');
  const drawer = new Offcanvas(sidebar, { backdrop: true, keyboard: true, scroll: false });
  let projects = [], expanded = new Set(), activeId = null, active = false;
  let controller = null, generation = 0, loadedAt = 0, timer, disposed = false;
  let collapsed = false;
  try { collapsed = localStorage.getItem('taskboard:sidebar-collapsed') === 'true'; } catch { /* optional preference */ }
  function applyCollapse() {
    container.classList.toggle('sidebar-collapsed', collapsed);
    collapse.setAttribute('aria-expanded', String(!collapsed));
    collapse.setAttribute('aria-label', collapsed ? 'Expand navigation' : 'Collapse navigation');
    collapse.title = collapsed ? 'Expand navigation' : 'Collapse navigation';
  }
  applyCollapse();
  function closeDrawer() { drawer.hide(); }
  function element(tag, className, text) {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function link(path, title, icon) {
    const a = element('a', 'sidebar-link'); a.href = path; a.title = title; a.setAttribute('aria-label', title);
    if (icon) { const i = element('i', `bi bi-${icon}`); i.setAttribute('aria-hidden', 'true'); a.append(i); }
    a.append(element('span', 'rail-hide', title)); return a;
  }
  function markActive() {
    container.querySelectorAll('a[href]').forEach((a) => {
      if (new URL(a.href).pathname === location.pathname) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    list.querySelectorAll('.sidebar-project').forEach((node) => {
      node.classList.toggle('active', node.dataset.project === activeId);
      const open = expanded.has(node.dataset.project);
      node.querySelector('button').setAttribute('aria-expanded', String(open));
      node.querySelector('button').setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} navigation for ${node.querySelector('.sidebar-project-title').textContent}`);
      node.querySelector('button i').className = `bi bi-chevron-${open ? 'down' : 'right'}`;
      node.querySelector('.sidebar-subnav').hidden = !open;
    });
  }
  function renderProjects() {
    const focused = document.activeElement;
    const focusKey = list.contains(focused) ? focused?.dataset.focusKey : null;
    const fragment = document.createDocumentFragment();
    const needle = search.value.trim().toLocaleLowerCase();
    const matches = projects.filter((p) => p.title.toLocaleLowerCase().includes(needle));
    for (const project of matches) {
      const group = element('div', 'sidebar-project'); group.dataset.project = project.id;
      const row = element('div', 'sidebar-project-row');
      const a = link(`/projects/${project.id}/tasks`, project.title);
      a.dataset.focusKey = `${project.id}-link`;
      a.replaceChildren();
      const initials = project.title.trim().split(/\s+/).slice(0, 2).map((word) => [...word][0]).join('').toUpperCase() || 'P';
      const icon = element('span', 'sidebar-project-icon', initials); icon.setAttribute('aria-hidden', 'true');
      a.append(icon, element('span', 'sidebar-project-title rail-hide', project.title));
      if (project.isOwner) { const owner = element('i', 'bi bi-person-check rail-hide'); owner.title = 'Owned by you'; owner.setAttribute('aria-label', 'Owned by you'); a.append(owner); }
      const toggle = element('button', 'nav-icon-button'); toggle.type = 'button'; toggle.dataset.expand = project.id;
      toggle.dataset.focusKey = `${project.id}-toggle`;
      toggle.setAttribute('aria-label', `Expand navigation for ${project.title}`);
      toggle.setAttribute('aria-controls', `project-links-${project.id}`);
      const chevron = element('i', 'bi bi-chevron-right'); chevron.setAttribute('aria-hidden', 'true'); toggle.append(chevron);
      const sub = element('div', 'sidebar-subnav'); sub.id = `project-links-${project.id}`;
      sub.append(link(`/projects/${project.id}/tasks`, 'Board', 'kanban'));
      if (project.canManage) sub.append(link(`/projects/${project.id}/users`, 'Members', 'people'), link(`/projects/${project.id}/edit`, 'Project Settings', 'gear'));
      row.append(a, toggle); group.append(row, sub); fragment.append(group);
    }
    if (!matches.length) { const status = element('p', 'sidebar-status', needle ? 'No matching projects.' : 'No projects yet. Create your first project to get started.'); status.setAttribute('role', 'status'); fragment.append(status); }
    list.replaceChildren(fragment); markActive();
    if (focusKey) [...list.querySelectorAll('[data-focus-key]')].find((node) => node.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
  }
  async function refresh(force = false) {
    if (!active || disposed || (!force && (controller || Date.now() - loadedAt < 60000))) return;
    controller?.abort(); controller = new AbortController();
    const request = ++generation, epoch = getAuthEpoch();
    if (!loadedAt) { list.replaceChildren(element('p', 'sidebar-status', 'Loading projects…')); list.firstChild.setAttribute('role', 'status'); }
    list.setAttribute('aria-busy', 'true');
    try {
      const { listNavigationProjects } = await import('../../services/projects-service.js');
      if (request !== generation || epoch !== getAuthEpoch() || !active || disposed) return;
      const result = await listNavigationProjects({ signal: controller.signal });
      if (disposed || request !== generation || epoch !== getAuthEpoch() || !active) return;
      projects = result; loadedAt = Date.now(); renderProjects();
    } catch (error) {
      if (request !== generation || epoch !== getAuthEpoch() || !active || disposed) return;
      // Do not keep stale permissions or inaccessible project titles after a failed refresh.
      projects = []; loadedAt = 0;
      const message = element('p', 'sidebar-status', 'Projects could not be loaded.'); message.setAttribute('role', 'alert');
      const retry = element('button', 'sidebar-link', 'Retry loading projects'); retry.type = 'button'; retry.dataset.retry = '';
      list.replaceChildren(message, retry);
    } finally { if (request === generation) { controller = null; list.removeAttribute('aria-busy'); } }
  }
  function invalidate() { loadedAt = 0; clearTimeout(timer); timer = setTimeout(() => refresh(true), 100); }
  function routeStart({ access, params }) {
    active = Boolean(getCurrentSession() && ['private', 'admin'].includes(access));
    container.hidden = !active; document.body.classList.toggle('has-workspace', active);
    closeDrawer();
    activeId = params.id ?? null;
    if (activeId) expanded.add(activeId);
    markActive();
    if (active) {
      const user = getCurrentSession().user;
      container.querySelector('.sidebar-email').textContent = user.email ?? 'Signed in';
      container.querySelector('.sidebar-user').title = user.email ?? 'Signed in';
      container.querySelector('.sidebar-avatar').textContent = (user.email ?? 'U').slice(0, 2).toUpperCase();
      const epoch = getAuthEpoch();
      import('../../services/admin-service.js').then(({ isAdmin }) => isAdmin()).then((admin) => { if (!disposed && epoch === getAuthEpoch()) container.querySelector('[data-sidebar-admin]').hidden = !admin; }).catch(() => {});
      refresh();
    } else { controller?.abort(); generation++; controller = null; }
  }
  const stops = [onRouteStart(routeStart), onRouteChange(markActive), onProjectsChanged(invalidate), onAuthChange(({ userChanged }) => {
    if (!userChanged) return;
    controller?.abort(); controller = null; generation++; projects = []; loadedAt = 0; expanded.clear(); search.value = '';
    list.replaceChildren(); container.querySelector('[data-sidebar-admin]').hidden = true;
    container.querySelector('.sidebar-email').textContent = ''; container.querySelector('.sidebar-avatar').textContent = '';
    if (!getCurrentSession()) { active = false; container.hidden = true; document.body.classList.remove('has-workspace'); closeDrawer(); }
  })];
  const onSearch = () => { if (loadedAt) renderProjects(); };
  const onClick = async (event) => {
    if (event.target.closest('[data-open-sidebar]')) drawer.show(opener);
    if (event.target.closest('.sidebar-close')) closeDrawer();
    if (event.target.closest('.sidebar-collapse')) { collapsed = !collapsed; applyCollapse(); try { localStorage.setItem('taskboard:sidebar-collapsed', String(collapsed)); } catch { /* optional */ } window.dispatchEvent(new Event('resize')); }
    const toggle = event.target.closest('[data-expand]');
    if (toggle) { const id = toggle.dataset.expand; expanded.has(id) ? expanded.delete(id) : expanded.add(id); markActive(); }
    if (event.target.closest('[data-retry]')) refresh(true);
    const logout = event.target.closest('.sidebar-logout');
    if (logout) { logout.disabled = true; try { const { error } = await signOut(); if (error) showError('Could not log out. Please try again.'); else navigate('/'); } catch { showError('Could not log out. Please try again.'); } finally { logout.disabled = false; } }
  };
  const onShown = () => opener.setAttribute('aria-expanded', 'true');
  const onHidden = () => { opener.setAttribute('aria-expanded', 'false'); if (media.matches && active) opener.focus({ preventScroll: true }); };
  const onMedia = () => { if (!media.matches) closeDrawer(); };
  const onFocus = () => refresh();
  const onVisible = () => { if (!document.hidden) refresh(); };
  container.addEventListener('click', onClick); search.addEventListener('input', onSearch);
  sidebar.addEventListener('shown.bs.offcanvas', onShown); sidebar.addEventListener('hidden.bs.offcanvas', onHidden);
  media.addEventListener('change', onMedia); window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onVisible);
  const poll = setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  return () => {
    disposed = true; active = false; controller?.abort(); generation++; clearTimeout(timer); clearInterval(poll); stops.forEach((stop) => stop());
    container.removeEventListener('click', onClick); search.removeEventListener('input', onSearch);
    sidebar.removeEventListener('shown.bs.offcanvas', onShown); sidebar.removeEventListener('hidden.bs.offcanvas', onHidden);
    media.removeEventListener('change', onMedia); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisible);
    drawer.hide(); setTimeout(() => drawer.dispose(), 350); document.body.classList.remove('has-workspace'); container.replaceChildren();
  };
}
