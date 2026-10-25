import { listTaskAssignees, searchTaskAssignees } from '../../services/assignees-service.js';

export function mountAssigneePicker(element,{taskId,projectId,signal}) {
 const list=element.querySelector('[data-assignee-list]'),results=element.querySelector('[data-assignee-results]'),search=element.querySelector('[data-assignee-search]'),empty=element.querySelector('[data-assignee-empty]'),status=element.querySelector('[data-assignee-status]'),error=element.querySelector('[data-assignee-error]');
 let assigned=[],original=[],candidates=[],loaded=false,generation=0,timer;
 const ids=()=>assigned.map(user=>user.user_id).sort();
 const fail=failure=>{if(signal.aborted)return;error.textContent=failure.message;error.hidden=false;status.textContent='';};
 const row=(user,remove)=>{
  const item=document.createElement('li');item.className='list-group-item d-flex justify-content-between align-items-center gap-2';
  const label=document.createElement('span');label.className='text-break';label.textContent=user.label;
  const button=document.createElement('button');button.type='button';button.className=`btn btn-sm btn-outline-${remove?'danger':'primary'}`;button.textContent=remove?'Remove':'Assign';button.setAttribute('aria-label',`${remove?'Unassign':'Assign'} ${user.label}`);
  button.addEventListener('click',()=>{assigned=remove?assigned.filter(candidate=>candidate.user_id!==user.user_id):[...assigned,user];render();(remove?search:list.querySelector('button'))?.focus();},{signal});item.append(label,button);return item;
 };
 function render(){list.replaceChildren(...assigned.map(user=>row(user,true)));empty.hidden=assigned.length>0;empty.textContent=loaded?'Unassigned.':'Loading assignees…';const available=candidates.filter(user=>!assigned.some(selected=>selected.user_id===user.user_id));results.replaceChildren(...available.map(user=>row(user,false)));status.textContent=available.length?'':'No matching unassigned participants.';}
 async function find(){error.hidden=true;const request=++generation;results.replaceChildren();status.textContent='Searching…';try{const found=await searchTaskAssignees(projectId,search.value,{signal});if(signal.aborted||request!==generation)return;candidates=found;render();}catch(failure){if(request===generation)fail(failure);}}
 async function load(){error.hidden=true;search.disabled=true;try{assigned=taskId?await listTaskAssignees([taskId],{signal}):[];if(signal.aborted)return;original=ids();loaded=true;search.disabled=false;render();await find();}catch(failure){fail(failure);}}
 const ready=load();
 search.addEventListener('input',()=>{clearTimeout(timer);generation++;timer=setTimeout(find,250);},{signal});signal.addEventListener('abort',()=>{generation++;clearTimeout(timer);},{once:true});
 return {ready,retry:()=>loaded?Promise.resolve():load(),isLoaded:()=>loaded,getIds:ids,isDirty:()=>JSON.stringify(ids())!==JSON.stringify(original),validate:()=>{if(!loaded)throw Error('Load assignees before saving.');}};
}
