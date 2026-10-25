import Dropdown from 'bootstrap/js/dist/dropdown';
import html from './projects.html?raw';
import './projects.css';
import { renderFragment, setText } from '../../utils/render.js';
import { browseProjects, deleteProject, ProjectNotFoundError, PROJECTS_PAGE_SIZE } from '../../services/projects-service.js';
import { onProjectsChanged } from '../../services/project-events.js';
import { getAuthEpoch } from '../../services/auth-service.js';
import { pageFromQuery, renderPager, totalPages } from '../../utils/pager.js';
import { openConfirmDialog } from '../../components/confirm-dialog/confirm-dialog.js';
import { showSuccess, showInfo, TOAST_MESSAGES } from '../../services/toast-service.js';

export const title = 'Projects';
// UI preferences only; never retain project data or permissions across accounts.
let remembered = { epoch: -1, query: '' };
export function mount(container, ctx) {
  renderFragment(container, html);
  const root = container.querySelector('.page-projects');
  const panels = root.querySelectorAll('[data-state]');
  const rows = root.querySelector('[data-rows]');
  const template = root.querySelector('[data-card-template]');
  const pager = root.querySelector('[data-pager]');
  const form = root.querySelector('form');
  const epoch = getAuthEpoch();
  if (remembered.epoch !== epoch) remembered = { epoch, query: '' };
  const params = new URLSearchParams(location.search || remembered.query);
  form.elements.search.value = (params.get('search') ?? '').slice(0,200);
  form.elements.sort.value = ['name','updated','created'].includes(params.get('sort')) ? params.get('sort') : 'created';
  form.elements.role.value = ['owned','member'].includes(params.get('role')) ? params.get('role') : 'all';
  let page = pageFromQuery(Object.fromEntries(params));
  let requestId = 0, dialog = null, controller = null, timer;
  let projectsById = new Map();
  const show = (state) => {
    panels.forEach((panel) => { panel.hidden = panel.dataset.state !== state; });
    root.setAttribute('aria-busy', String(state === 'loading'));
  };
  function syncUrl() {
    const query = new URLSearchParams();
    if (form.elements.search.value.trim()) query.set('search',form.elements.search.value.trim());
    if (form.elements.sort.value !== 'created') query.set('sort',form.elements.sort.value);
    if (form.elements.role.value !== 'all') query.set('role',form.elements.role.value);
    if (page > 1) query.set('page',String(page));
    remembered = { epoch, query: query.toString() };
    history.replaceState(history.state,'',`/projects${query.size ? `?${query}` : ''}`);
    root.querySelector('form [data-clear-filters]').hidden = !query.has('search') && !query.has('role') && !query.has('sort');
  }
  function disposeMenus() { rows.querySelectorAll('[data-menu-trigger]').forEach((button) => Dropdown.getInstance(button)?.dispose()); }
  function buildRow(project) {
    const row = template.content.firstElementChild.cloneNode(true);
    const id = encodeURIComponent(project.id);
    row.dataset.projectId = project.id;
    setText(row,'[data-initials]',project.title.trim().split(/\s+/).slice(0,2).map(word=>[...word][0]).join('').toUpperCase());
    const titleLink = setText(row,'[data-title-link]',project.title); titleLink.href=`/projects/${id}/tasks`; titleLink.title=project.title;
    setText(row,'[data-description]',project.description); row.querySelector('[data-description]').title=project.description;
    setText(row,'[data-role]',project.isOwner ? 'Owned' : project.isMember ? 'Member' : 'Admin access');
    const total = project.openTasks + project.doneTasks;
    setText(row,'[data-task-total]',total ? `${total.toLocaleString()} ${total===1?'task':'tasks'}` : 'No tasks yet');
    setText(row,'[data-task-counts]',total ? `${project.openTasks.toLocaleString()} open · ${project.doneTasks.toLocaleString()} done` : '');
    const progress=row.querySelector('progress'); progress.value=total ? project.doneTasks/total*100 : 0;
    progress.setAttribute('aria-label',total ? `${project.doneTasks} of ${total} tasks completed` : 'No tasks yet');
    setText(row,'[data-stages]',`${project.stageCount.toLocaleString()} ${project.stageCount===1?'stage':'stages'}`);
    const updated = row.querySelector('[data-updated]');
    if (project.updatedAt && Number.isFinite(new Date(project.updatedAt).getTime())) {
      updated.textContent=`Updated ${new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(new Date(project.updatedAt))}`;
      updated.title=`Project metadata updated ${new Date(project.updatedAt).toLocaleString()}`;
    } else updated.hidden=true;
    row.querySelector('[data-action="tasks"]').href=`/projects/${id}/tasks`;
    row.querySelector('[data-action="tasks"]').setAttribute('aria-label',`Open board for ${project.title}`);
    row.querySelector('[data-action="edit"]').href=`/projects/${id}/edit`;
    row.querySelector('[data-action="users"]').href=`/projects/${id}/users`;
    row.querySelector('[data-menu-trigger]').setAttribute('aria-label',`Actions for ${project.title}`);
    row.querySelector('[data-action="delete"]').setAttribute('aria-label',`Delete ${project.title}`);
    row.querySelector('[data-menu]').hidden=!project.canManage;
    return row;
  }
  async function load({quiet=false}={}) {
    const current=++requestId;
    clearTimeout(timer);
    controller?.abort(); controller=new AbortController();
    if (!quiet) show('loading');
    pager.hidden=true;
    syncUrl();
    try {
      const result=await browseProjects({page, search:form.elements.search.value, sort:form.elements.sort.value, role:form.elements.role.value, signal:controller.signal});
      if (current!==requestId || ctx.signal.aborted) return;
      if (!result.rows.length && page>1) {page=totalPages(result.total,PROJECTS_PAGE_SIZE);return load();}
      projectsById=new Map(result.rows.map(project=>[project.id,project]));
      disposeMenus(); rows.replaceChildren(...result.rows.map(buildRow));
      setText(root,'[data-accessible-count]',`${result.accessibleTotal.toLocaleString()} accessible ${result.accessibleTotal===1?'project':'projects'}`);
      setText(root,'[data-result-count]',`${result.total.toLocaleString()} ${result.total===1?'result':'results'}`);
      renderPager(pager,{page,total:result.total,pageSize:PROJECTS_PAGE_SIZE});
      show(result.rows.length ? 'grid' : result.accessibleTotal===0 ? 'empty' : 'no-results');
    } catch(error) {
      if (current!==requestId || ctx.signal.aborted) return;
      disposeMenus(); rows.replaceChildren(); projectsById.clear();
      setText(root,'[data-error-text]',error.message);setText(root,'[data-accessible-count]','Project count unavailable');setText(root,'[data-result-count]','');show('error');
    }
  }
  async function confirmDelete(project, trigger) {
    dialog = openConfirmDialog({
      title: 'Delete project?',
      lead: `Are you sure you want to delete “${project.title}”?`,
      detail:
        'All stages, tasks and attachments in this project will also be permanently removed. This cannot be undone.',
      confirmLabel: 'Delete project',
      onConfirm: async () => {
        try {
          await deleteProject(project.id);
        } catch (error) {
          // Already gone (or no longer accessible): nothing left to delete, so refresh instead of failing.
          if (!(error instanceof ProjectNotFoundError)) throw error;
          showInfo('That project no longer exists.');
          return;
        }
        showSuccess(TOAST_MESSAGES.projectDeleted);
      },
    });

    const deleted = await dialog.result;
    dialog = null;
    if (ctx.signal.aborted) return;
    if (deleted) await load({ quiet: true });
    // Return focus to something sensible: the trigger if it still exists, otherwise the heading.
    const target = trigger.isConnected ? trigger : root.querySelector('h1');
    target?.focus();
  }

  function filtersChanged(debounce=false) {
    page=1;clearTimeout(timer);controller?.abort();requestId++;syncUrl();
    if (debounce) {show('loading');pager.hidden=true;timer=setTimeout(()=>load(),250);} else load();
  }
  ctx.cleanup.listen(form,'submit',event=>{event.preventDefault();clearTimeout(timer);page=1;load();});
  ctx.cleanup.listen(form.elements.search,'input',()=>filtersChanged(true));
  for (const name of ['sort','role']) ctx.cleanup.listen(form.elements[name],'change',()=>filtersChanged());
  ctx.cleanup.listen(root,'click',event=>{
    if (event.target.closest('[data-clear-filters]')) {form.reset();filtersChanged();form.elements.search.focus();}
    const button=event.target.closest('[data-action="delete"]');
    if (!button || dialog) return;
    const project=projectsById.get(button.closest('[data-project-id]')?.dataset.projectId);
    if (project) confirmDelete(project,button.closest('[data-project-id]').querySelector('[data-menu-trigger]'));
  });
  ctx.cleanup.listen(root.querySelector('[data-retry]'),'click',()=>load());
  ctx.cleanup.add(onProjectsChanged(()=>{if(!dialog)load({quiet:true});}));
  ctx.cleanup.add(()=>{requestId++;clearTimeout(timer);controller?.abort();disposeMenus();dialog?.destroy();});
  load();
}
