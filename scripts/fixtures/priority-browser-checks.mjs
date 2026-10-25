import assert from 'node:assert/strict';
export async function checkPriorityBrowser({evaluate,send,wait,saveScreenshot,errors}){
 const base='/projects/00000000-0000-0000-0000-000000000010',taskId='00000000-0000-0000-0000-000000000103';
 const check=async(e,m)=>assert.equal(await evaluate(e),true,m);
 const click=s=>evaluate(`document.querySelector(${JSON.stringify(s)}).click()`);
 const change=(s,v,type='change')=>evaluate(`(()=>{const i=document.querySelector(${JSON.stringify(s)});i.value=${JSON.stringify(v)};i.dispatchEvent(new Event(${JSON.stringify(type)},{bubbles:true}));})()`);
 const boardReady=()=>wait(`document.querySelector('.page-tasks')?.getAttribute('aria-busy')==='false' && document.querySelector('[data-state="board"]')?.hidden===false && !document.querySelector('.modal')`);
 const formReady=()=>wait(`document.querySelector('.modal.show [data-action="save"]')?.disabled===false && document.activeElement===document.querySelector('.modal.show [data-task-title]')`);
 const go=path=>evaluate(`(()=>{const a=document.createElement('a');a.href=${JSON.stringify(path)};document.body.append(a);a.click();a.remove();})()`);
 const broadcast=()=>evaluate(`__mockSocket.emit('message',new MessageEvent('message',{data:JSON.stringify([null,null,'realtime:project:00000000-0000-0000-0000-000000000010:board','broadcast',{event:'project_changed',payload:{project_id:'00000000-0000-0000-0000-000000000010'},type:'broadcast'}])}))`);
 await evaluate(`window.alert=window.confirm=window.prompt=()=>{throw Error('Native dialog must not be used');};__boardMock.tasks.forEach(t=>t.priority='medium');__boardMock.tasks[0].priority='low';__boardMock.tasks[2].priority='high';__boardMock.tasks[3].priority='urgent';__boardMock.tasks[57].priority='urgent';window.__manualPriorityPositions=JSON.stringify(__boardMock.tasks.map(t=>[t.id,t.position]));`);
 await broadcast();await wait(`document.querySelector('[data-task-id="00000000-0000-0000-0000-000000000100"] [data-task-priority]')?.dataset.priority==='low'`);
 await click('[data-toggle-filters]');await evaluate(`document.querySelector('[data-priority-filter][value="urgent"]').focus()`);await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});await wait(`document.querySelectorAll('.task-card').length===2 && document.querySelector('.page-tasks').getAttribute('aria-busy')==='false'`);
 await check(`document.querySelector('[data-filter-chips]').textContent.includes('Priority: Urgent') && [...document.querySelectorAll('.task-card')].some(c=>c.textContent.includes('Needle task'))`,'Priority filter drains unloaded pages');
 await click('[data-priority-filter][value="high"]');await wait(`document.querySelectorAll('.task-card').length===3`);
 await change('[data-filter="status"]','open');await change('[data-search]','Needle','input');await wait(`document.querySelectorAll('.task-card').length===1`);
 await click('[data-clear-priority="urgent"]');await wait(`document.querySelectorAll('.task-card').length===0`);await check(`document.querySelector('[data-priority-filter][value="high"]').checked && !document.querySelector('[data-priority-filter][value="urgent"]').checked`,'Remove one priority keeps other selections');
 await click('[data-clear-filters]');await change('[data-filter="sort"]','priority');await wait(`document.querySelectorAll('.task-card').length===61`);
 await check(`(()=>{const cards=[...document.querySelectorAll('[data-stage-id="00000000-0000-0000-0000-000000000011"] .task-card')];return cards[0].dataset.taskId===__boardMock.tasks[3].id && cards[1].dataset.taskId===__boardMock.tasks[57].id;})()`,'Priority sorting covers unloaded urgent work with manual-position ties');
 await check(`document.querySelector('[data-drag-notice]').textContent.includes('sorting') && __manualPriorityPositions===JSON.stringify(__boardMock.tasks.map(t=>[t.id,t.position])) && !__boardMock.calls.some(c=>c.path==='move_task_relative')`,'Display sort preserves saved order and explains paused dragging');
 await click('[data-clear-filters]');await check(`document.querySelector('[data-filter="sort"]').value==='' && document.querySelector('.task-card').dataset.taskId===__boardMock.tasks[0].id`,'Manual default restored');
 for(const priority of ['low','medium','high','urgent']){
  await click('[data-add-primary]');await formReady();await check(`document.querySelector('[data-priority-input]').value==='medium'`,'New tasks default Medium');
  await change('.modal.show [data-task-title]',`Priority ${priority}`,'input');await change('[data-priority-input]',priority);await click('.modal.show [data-action="save"]');await boardReady();
  await check(`__boardMock.tasks.find(t=>t.title==='Priority ${priority}')?.priority===${JSON.stringify(priority)}`,'Create saved selected priority');
 }
 for(const priority of ['low','medium','high','urgent']){
  await click(`[data-task-id="${taskId}"] [data-open-task]`);await formReady();
  await change('[data-priority-input]',priority);
  if(priority==='high'){
   await evaluate(`__boardMock.failSave=true`);await click('.modal.show [data-action="save"]');await wait(`document.querySelector('[data-save-error]')?.hidden===false`);
   await check(`document.querySelector('[data-priority-input]').value==='high' && __boardMock.tasks.find(t=>t.id==='${taskId}').priority==='medium' && document.querySelector('#toast-host').getBoundingClientRect().top<=20`,'Failed save keeps draft and uses top-right toast');await evaluate(`__boardMock.failSave=false`);
  }
  await click('.modal.show [data-action="save"]');await boardReady();await check(`__boardMock.tasks.find(t=>t.id==='${taskId}').priority===${JSON.stringify(priority)} && document.querySelector('[data-task-id="${taskId}"] [data-task-priority]').dataset.priority===${JSON.stringify(priority)}`,'Edit/card persisted priority');
 }
 await click(`[data-task-id="${taskId}"] [data-open-task]`);await formReady();await check(`document.querySelector('[data-priority-input]').value==='urgent'`,'Edit loads actual value');
 await change('[data-priority-input]','invalid');await click('.modal.show [data-action="save"]');await check(`document.querySelector('[data-priority-error]').textContent.includes('valid')`,'UI rejects invalid priority');await change('[data-priority-input]','low');
 await click('.modal.show .modal-header [data-bs-dismiss]');await wait(`!document.querySelector('[data-discard-confirm]').hidden`);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await check(`document.querySelector('[data-priority-input]').value==='low'`,'Keep editing preserves draft priority');
 await click('.modal.show .modal-header [data-bs-dismiss]');await click('[data-discard-changes]');await boardReady();await check(`__boardMock.tasks.find(t=>t.id==='${taskId}').priority==='urgent'`,'Discard preserves saved priority');
 await click(`[data-task-id="${taskId}"] [data-open-task]`);await formReady();await change('[data-priority-input]','medium');
 await go(`${base}/dashboard`);await wait(`!document.querySelector('[data-discard-confirm]').hidden`);await click('[data-keep-editing]');await check(`location.pathname.endsWith('/tasks')`,'Navigation can keep editing');
 await go(`${base}/dashboard`);await wait(`!document.querySelector('[data-discard-confirm]').hidden`);await click('[data-discard-changes]');
 await wait(`document.querySelectorAll('.summary-card').length===8 && document.querySelector('.page-dashboard').getAttribute('aria-busy')==='false'`);
 await check(`document.querySelectorAll('[data-priority-table] tr').length===4 && document.querySelectorAll('canvas').length===4 && document.querySelector('[data-priority-table]').textContent.includes('Urgent')`,'Dashboard priority distribution');
 await click(`.summary-card[href="${base}/tasks?status=open&priority=high"]`);await boardReady();await check(`document.querySelector('[data-filter-chips]').textContent.includes('Priority: High') && [...document.querySelectorAll('[data-task-priority]')].every(e=>e.dataset.priority==='high')`,'High open drill-down applies both filters');
 await click('[data-clear-filters]');
 await click(`[data-task-id="${taskId}"] [data-open-task]`);await formReady();await change('[data-priority-input]','low');await evaluate(`__boardMock.tasks[2].priority='urgent'`);await broadcast();await new Promise(r=>setTimeout(r,450));await check(`document.querySelector('[data-priority-input]').value==='low'`,'Realtime preserves unsaved priority');
 for(const theme of ['light','dark']){await evaluate(`TaskboardTheme.set('${theme}')`);await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await saveScreenshot(`priority-${theme}-mobile.png`);await check(`document.documentElement.scrollWidth<=innerWidth && document.querySelector('.modal-footer').getBoundingClientRect().bottom<=innerHeight`,'Priority editor fits mobile');}
 await click('.modal.show .modal-header [data-bs-dismiss]');await click('[data-discard-changes]');await boardReady();
 assert.deepEqual(errors,[]);console.log('PASS: all priority create/edit/default/invalid/failure/discard cases; native-free navigation confirmation; top-right notifications; multi-priority AND filters, full-page sorting without position writes, dashboard drill-down, Realtime draft preservation and mobile themes.');
}
