import html from './activity.html?raw';
import { renderFragment } from '../../utils/render.js';
import { formatDateTime } from '../../utils/dates.js';
import { activitySummary } from '../../utils/activity.js';
import { listTaskActivity, ACTIVITY_PAGE_SIZE } from '../../services/activity-service.js';
import { isUuid } from '../../utils/validation.js';
import { pageFromQuery, renderPager, totalPages } from '../../utils/pager.js';
export const title = 'Task activity';
export function mount(container, ctx) {
  renderFragment(container, html);
  const root = container.querySelector('[data-activity]');
  const form = root.querySelector('form');
  const results = root.querySelector('[data-results]');
  const errorBox = root.querySelector('[data-error]');
  const status = root.querySelector('[data-status]');
  const refresh = root.querySelector('[data-refresh]');
  const pager = root.querySelector('[data-pager]');
  const projectId = ctx.project.id;
  const taskId = ctx.query.task || null;
  const page = pageFromQuery(ctx.query);
  const snapshot = ctx.query.snapshot || null;
  let loading = false;
  form.elements.task.value = taskId ?? '';
  const node = (tag,text,className='') => { const element=document.createElement(tag); element.textContent=text; element.className=className; return element; };
  function fail(message) { errorBox.textContent=message; errorBox.hidden=false; status.textContent=''; }
  ctx.cleanup.listen(form,'submit',event=>{
    event.preventDefault();
    const task=form.elements.task.value.trim();
    if(task && !isUuid(task)) { fail('Enter a valid task ID or leave it empty.'); form.elements.task.focus(); return; }
    const query=new URLSearchParams();
    if(task) query.set('task',task);
    ctx.navigate(`/projects/${projectId}/activity${query.size ? `?${query}` : ''}`);
  });
  function build(entry) {
    const item=node('li','','list-group-item');
    const heading=node('div','','d-flex flex-wrap justify-content-between gap-2');
    const task=node(entry.task_exists?'a':'strong',entry.task_title,'fw-semibold text-break');
    if(entry.task_exists) task.href=`/projects/${entry.project_id}/tasks?task=${entry.task_id}`;
    const time=node('time',formatDateTime(entry.created_at),'small text-body-secondary'); time.dateTime=entry.created_at;
    heading.append(task,time);
    const detail=node('p',activitySummary(entry),'mb-1 mt-1 text-break');
    const meta=node('p',`${entry.project_title} · ${entry.actor_id ? `User ${entry.actor_id}` : 'System/database operation'}`,'small text-body-secondary text-break mb-1');
    const reference=node('small',`Task ${entry.task_id}${entry.task_exists?'':' · Task no longer exists'}`,'text-body-secondary text-break');
    item.append(heading,detail,meta,reference); return item;
  }
  async function load() {
    if(loading) return;
    loading=true; refresh.disabled=true; root.setAttribute('aria-busy','true');
    errorBox.hidden=true; status.textContent='Loading activity…'; results.replaceChildren(); pager.hidden=true;
    try {
      const data = await listTaskActivity({projectId,taskId,page,snapshot,signal:ctx.signal});
      if(ctx.signal.aborted) return;
      results.append(...data.rows.map(build));
      status.textContent=data.total?'':'No activity found for these filters.';
      if(page>totalPages(data.total,ACTIVITY_PAGE_SIZE)) {
        status.textContent='This page no longer has entries.';
        const query=new URLSearchParams(location.search); query.delete('page');
        const first=node('a','Return to the first page'); first.href=`/projects/${projectId}/activity${query.size?`?${query}`:''}`; results.append(first);
      } else {
        renderPager(pager,{page,total:data.total,pageSize:ACTIVITY_PAGE_SIZE});
        for (const link of pager.querySelectorAll('a')) {
          const url=new URL(link.href); url.searchParams.set('snapshot',data.snapshot);
          link.href=url.pathname+url.search;
        }
      }
    } catch(error) { if(!ctx.signal.aborted) fail(error.message); }
    finally { loading=false; if(!ctx.signal.aborted) { refresh.disabled=false; root.setAttribute('aria-busy','false'); } }
  }
  ctx.cleanup.listen(refresh,'click',()=>{
    if (snapshot || page > 1) {
      const query=new URLSearchParams(location.search); query.delete('snapshot'); query.delete('page');
      ctx.navigate(`/projects/${projectId}/activity${query.size?`?${query}`:''}`);
    } else load();
  });
  ctx.onProjectRefresh(load);
  load();
}
