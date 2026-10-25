import html from './task-list.html?raw';
import './task-list.css';
import {renderFragment} from '../../utils/render.js';
import {pageFromQuery,renderPager} from '../../utils/pager.js';
import {listProjectTasks,TASK_LIST_PAGE_SIZE} from '../../services/task-list-service.js';
export const title='Tasks';
export function mount(container,ctx) {
 renderFragment(container,html);
 const root=container.querySelector('.page-task-list'),form=root.querySelector('form'),results=root.querySelector('[data-results]'),statusText=root.querySelector('[data-status]'),errorBox=root.querySelector('[data-error]'),pager=root.querySelector('[data-pager]');
 const status=ctx.query.status??'all',projectId=ctx.project.id,page=pageFromQuery(ctx.query);
 let loading=false;
 const base=`/projects/${projectId}/task-list`;
 root.querySelector('[data-clear]').href=base;
 root.querySelector('header a').href=`/projects/${projectId}/dashboard`;
 form.elements.status.value=['all','open','done'].includes(status)?status:'all';
 const filterSummary=root.querySelector('[data-filter-summary]');
 filterSummary.textContent=`Selected status: ${status==='all'?'All':status==='open'?'Open':status==='done'?'Done':'Invalid filter'}`;
 root.querySelector('[data-clear]').hidden=status==='all';
 ctx.cleanup.listen(form,'submit',event=>{
  event.preventDefault();if(loading)return;
  const query=new URLSearchParams();if(form.elements.status.value!=='all')query.set('status',form.elements.status.value);
  ctx.navigate(`${base}${query.size?`?${query}`:''}`);
 });
 async function load() {
  if(loading)return;loading=true;root.setAttribute('aria-busy','true');errorBox.hidden=true;pager.hidden=true;results.replaceChildren();statusText.textContent='Loading tasks…';form.querySelector('[data-apply]').disabled=true;
  try {
   const result=await listProjectTasks({status,projectId,page,signal:ctx.signal});if(ctx.signal.aborted)return;
   filterSummary.textContent=`Selected status: ${status==='all'?'All':status==='open'?'Open':'Done'} · ${ctx.project.title} · ${result.total.toLocaleString()} matching ${result.total===1?'task':'tasks'}`;
   for(const task of result.rows){
    const li=document.createElement('li');li.className='list-group-item';
    const content=document.createElement('div');content.className='task-list-content';
    const link=document.createElement('a');link.className='task-list-title';link.textContent=task.title;link.href=`/projects/${encodeURIComponent(task.project_id)}/tasks?task=${encodeURIComponent(task.id)}`;
    const context=document.createElement('div');context.className='task-list-context';context.textContent=[task.projects?.title,task.project_stages?.name].filter(Boolean).join(' · ');
    content.append(link,context);const state=document.createElement('span');state.className='task-list-state';state.textContent=task.done?'Done':'Open';li.append(content,state);results.append(li);
   }
   statusText.textContent=result.rows.length?'':result.total?`No tasks on this page. Use Previous to return to earlier results.`:`No matching ${status==='all'?'':status==='open'?'open ':'completed '}tasks. ${projectId?'Try clearing the filters.':'Tasks will appear here when you have access to them.'}`;
   renderPager(pager,{page,total:result.total,pageSize:TASK_LIST_PAGE_SIZE});
  }catch(error){if(!ctx.signal.aborted){root.querySelector('[data-error-text]').textContent=error.message;errorBox.hidden=false;statusText.textContent='';}}
  finally{loading=false;if(!ctx.signal.aborted){root.setAttribute('aria-busy','false');form.querySelector('[data-apply]').disabled=false;}}
 }
 ctx.cleanup.listen(root.querySelector('[data-retry]'),'click',load);ctx.onProjectRefresh(load);load();
}
