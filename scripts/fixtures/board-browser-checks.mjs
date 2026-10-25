import { checkWholeCardDrag } from './task-card-drag-checks.mjs';
export async function checkBoardBrowser({ evaluate, send, wait, saveScreenshot, errors }) {
const assert=(value,message)=>{if(!value)throw new Error(message);};
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const change=(selector,value,event='input')=>evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
const settled=()=>wait(`document.querySelector('[data-state="board"]')?.hidden===false && document.querySelector('.page-tasks')?.getAttribute('aria-busy')==='false' && !document.querySelector('.modal')`);
// A partially loaded column must offer a real end-of-stage placement.
await click('.task-card [data-task-menu-trigger]');await wait(`!!document.querySelector('[data-card-menu]:popover-open')`);
await click('[data-card-menu]:popover-open [data-task-action="move"]');await wait(`document.querySelector('.move-task-modal.show')`);
assert(await evaluate(`!!document.querySelector('[data-position] option[value="end"]')`),'Partially loaded column offers the real end');
await change('[data-position]','end','change');await click('.move-task-modal button[type="submit"]');await settled();
assert(await evaluate(`window.__boardMock.calls.filter(c=>c.path==='move_task_relative').at(-1).body.p_to_end===true`),'Move must not interpret the last loaded row as column end');
await change('[data-search]','Needle');
await wait(`document.querySelectorAll('.task-card').length===1 && document.querySelector('[data-result-count]').textContent==='1 of 61 tasks'`);
assert(await evaluate(`document.querySelector('[data-task-title]').textContent.includes('Needle')`),'Search must include the unloaded task');
assert(await evaluate(`!document.querySelector('[data-drag-notice]').hidden`),'Filtered drag explanation');
await click('[data-clear-filters]');await wait(`document.querySelectorAll('.task-card').length===61`);
await change('[data-filter="status"]','completed','change');await wait(`document.querySelectorAll('.task-card').length===1`);
assert(await evaluate(`document.querySelector('[data-card-done]').hidden===false`),'Completed filter');
await click('[data-clear-filters]');
await change('[data-search]','does not exist');await wait(`document.querySelector('[data-no-results]').hidden===false`);
await click('[data-clear-filters]');
await click('[data-description-toggle]');assert(await evaluate(`document.querySelector('[data-project-description]').classList.contains('is-expanded')`),'Description expands');await click('[data-description-toggle]');
await click('.task-card [data-open-task]');await wait(`document.querySelector('.task-view-modal.show') && document.activeElement.matches('#task-view-title-input')`);
// Shared Today control updates only the deadline draft until Save.
await evaluate(`window.__todaySaveCount=__boardMock.calls.filter(c=>c.path==='update_task_with_deadline').length;document.querySelector('#task-view-deadline').value='2020-01-01T09:45';document.querySelector('.task-view-modal [data-deadline-today]').click()`);
assert(await evaluate(`(()=>{const d=new Date();const local=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');return document.querySelector('#task-view-deadline').value===local+'T09:45' && __boardMock.calls.filter(c=>c.path==='update_task_with_deadline').length===__todaySaveCount;})()`),'Today preserves time without saving');
await click('.task-view-modal [data-clear-deadline]');await click('.task-view-modal [data-deadline-today]');
assert(await evaluate(`document.querySelector('#task-view-deadline').value.endsWith('T17:00')`),'Empty deadline defaults to 17:00');
await click('.task-view-modal [data-bs-dismiss="modal"]');await settled();
assert(await evaluate(`__boardMock.calls.filter(c=>c.path==='update_task_with_deadline').length===__todaySaveCount`),'Cancel does not save Today');
await click('.task-card [data-open-task]');await wait(`document.activeElement.matches('#task-view-title-input')`);
await click('.task-view-modal [data-deadline-today]');await evaluate(`window.__todayExpected=document.querySelector('#task-view-deadline').value;window.__todayTitle=document.querySelector('#task-view-title-input').value`);
await click('.task-view-modal [data-action="save"]');await settled();
assert(await evaluate(`__boardMock.tasks.find(t=>t.title===__todayTitle).due_at===new Date(__todayExpected).toISOString()`),'Today persists through existing Save conversion');
await send('Page.reload',{ignoreCache:true});await wait(`document.querySelectorAll('.task-card').length===53`);
await click('.task-card [data-open-task]');await wait(`document.activeElement.matches('#task-view-title-input')`);
assert(await evaluate(`document.querySelector('#task-view-deadline').value.endsWith('T17:00')`),'Saved Today time survives reload');
assert(await evaluate(`document.querySelectorAll('.modal.show').length===1 && document.querySelector('.task-detail-sidebar')!==null`),'Grouped task view');
await saveScreenshot('task-details.png');
assert(await evaluate(`!document.querySelector('.task-view-modal [data-action="edit"]') && !!document.querySelector('.task-view-modal [data-action="save"]')`),'Save replaces Edit in task details');
await evaluate(`window.__boardMock.failSave=true`);await change('#task-view-title-input','A preserved edit');
await evaluate(`document.querySelector('.task-view-modal .ql-editor').textContent='An inline description edit';`);
await change('#task-view-stage','00000000-0000-0000-0000-000000000013','change');
await change('#task-view-deadline','2027-04-05T10:30');
await click('.task-view-modal [data-action="save"]');
await wait(`document.querySelector('.task-view-modal [data-save-error]')?.hidden===false`);
assert(await evaluate(`document.querySelector('#task-view-title-input').value==='A preserved edit' && document.querySelector('.task-view-modal .ql-editor').textContent.includes('inline description edit')`),'Failed saves preserve both inline values');
assert(await evaluate(`document.querySelector('#task-view-stage').value==='00000000-0000-0000-0000-000000000013' && document.querySelector('#task-view-deadline').value==='2027-04-05T10:30'`),'Failed save preserves stage and deadline');
await evaluate(`window.__boardMock.failSave=false`);await click('.task-view-modal [data-action="save"]');await settled();
assert(await evaluate(`[...document.querySelectorAll('[data-task-title]')].some(e=>e.textContent==='A preserved edit')`),'Saved inline edit visible');
assert(await evaluate(`(()=>{const call=window.__boardMock.calls.filter(c=>c.path==='update_task_with_deadline').at(-1);return call.body.p_stage_id==='00000000-0000-0000-0000-000000000013' && call.body.p_due_at===new Date('2027-04-05T10:30').toISOString() && call.body.p_description.includes('inline description edit');})()`),'Inline save sends stage, deadline, title and description together');
await evaluate(`[...document.querySelectorAll('.task-card')].find(card=>card.querySelector('[data-task-title]').textContent==='A preserved edit').querySelector('[data-open-task]').click()`);
await wait(`document.querySelector('.task-view-modal.show') && document.activeElement.matches('#task-view-title-input')`);
assert(await evaluate(`document.querySelector('#task-view-stage').value==='00000000-0000-0000-0000-000000000013' && document.querySelector('#task-view-deadline').value==='2027-04-05T10:30'`),'Stage and deadline restored when reopening');
await change('#task-view-stage','00000000-0000-0000-0000-000000000011','change');await click('.task-view-modal [data-clear-deadline]');
await click('.task-view-modal [data-action="save"]');await settled();
assert(await evaluate(`window.__boardMock.tasks.find(task=>task.title==='A preserved edit').due_at===null`),'Deadline can be cleared in the popup');
await change('[data-filter="status"]','open','change');
await click('[data-add-primary]');await wait(`document.querySelector('.task-form-modal.show') && document.activeElement.matches('#task-title')`);await click('.task-form-modal [data-deadline-today]');assert(await evaluate(`document.querySelector('#task-deadline').value.endsWith('T17:00') && document.querySelector('.task-form-modal.show')!==null`),'Create form Today updates draft without submitting');await change('#task-title','New board task');await click('.task-form-modal [data-submit]');await settled();
assert(await evaluate(`document.querySelector('[data-filter="status"]').value==='open'`),'Filters survive CRUD');
assert(await evaluate(`window.__boardMock.tasks.some(t=>t.title==='New board task')`),'Created task');
await click('[data-clear-filters]');
const openMenu=async title=>{await evaluate(`(()=>{const card=[...document.querySelectorAll('.task-card')].find(c=>c.querySelector('[data-task-title]').textContent===${JSON.stringify(title)});card.querySelector('[data-task-menu-trigger]').click();})()`);await wait(`!!document.querySelector('[data-card-menu]:popover-open')`);};
await openMenu('New board task');
assert(await evaluate(`document.activeElement.matches('[data-task-action="view"]')`),'Menu takes keyboard focus');
await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
assert(await evaluate(`document.activeElement.matches('[data-task-action="edit"]')`),'Menu supports arrow-key navigation');
await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
await wait(`!document.querySelector('[data-card-menu]:popover-open')`);await openMenu('New board task');
await click('[data-card-menu]:popover-open [data-task-action="move"]');await wait(`document.querySelector('.move-task-modal.show')`);
await change('[data-stage]','00000000-0000-0000-0000-000000000012','change');await click('.move-task-modal button[type="submit"]');await settled();
await wait(`window.__boardMock.tasks.find(t=>t.title==='New board task').stage_id==='00000000-0000-0000-0000-000000000012'`);
await openMenu('New board task');await click('[data-card-menu]:popover-open [data-task-action="move"]');await wait(`document.querySelector('.move-task-modal.show')`);
await evaluate(`window.__boardMock.failMove=true`);await change('[data-stage]','00000000-0000-0000-0000-000000000013','change');await click('.move-task-modal button[type="submit"]');await settled();
assert(await evaluate(`window.__boardMock.tasks.find(t=>t.title==='New board task').stage_id==='00000000-0000-0000-0000-000000000012'`),'Failed movement restored canonical state');
await evaluate(`window.__boardMock.failMove=false`);
await openMenu('New board task');await click('[data-card-menu]:popover-open [data-task-action="delete"]');await wait(`document.querySelector('.modal.show [data-dialog-confirm]') || document.querySelector('.confirm-dialog.show')`);


await click('.confirm-dialog [data-dialog-confirm]');await settled();
assert(await evaluate(`!window.__boardMock.tasks.some(t=>t.title==='New board task')`),'Deleted task');
const broadcast=async(event='project_changed')=>evaluate(`window.__mockSocket.emit('message',new MessageEvent('message',{data:JSON.stringify([null,null,'realtime:project:00000000-0000-0000-0000-000000000010:board','broadcast',{event:${JSON.stringify(event)},payload:{project_id:'00000000-0000-0000-0000-000000000010'},type:'broadcast'}])}))`);
// Real pointer events exercise Sortable's pointer drag path and the persisted relative placement service.
await evaluate(`document.querySelector('[data-board]').scrollIntoView({block:'start'});document.querySelector('[data-cards]').scrollTop=0`);
const coords=await evaluate(`(()=>{const from=document.querySelector('[data-stage-id="00000000-0000-0000-0000-000000000011"] [data-task-title]').getBoundingClientRect();const to=document.querySelector('[data-stage-id="00000000-0000-0000-0000-000000000013"] [data-cards]').getBoundingClientRect();return {x:from.x+from.width/2,y:from.y+from.height/2,tx:to.x+to.width/2,ty:to.y+80,id:document.querySelector('[data-stage-id="00000000-0000-0000-0000-000000000011"] .task-card').dataset.taskId}})()`);
await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:coords.x,y:coords.y});
await send('Input.dispatchMouseEvent',{type:'mousePressed',x:coords.x,y:coords.y,button:'left',buttons:1,clickCount:1});
for(let i=1;i<=24;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:coords.x+(coords.tx-coords.x)*i/24,y:coords.y+(coords.ty-coords.y)*i/24,button:'left',buttons:1});await new Promise(r=>setTimeout(r,25));}
await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:coords.tx,y:coords.ty,button:'left',buttons:0,clickCount:1});
await wait(`window.__boardMock.tasks.find(t=>t.id==='${coords.id}').stage_id==='00000000-0000-0000-0000-000000000013'`);await settled();
console.log('Pointer drag persisted.');
await broadcast();await settled();
assert(await evaluate(`document.querySelector('[data-stage-id="00000000-0000-0000-0000-000000000013"] .task-card')?.dataset.taskId==='${coords.id}'`),'Move survives authoritative reload');
// Reorder within a column using the same trusted pointer drag path.
const reorder=await evaluate(`(()=>{const cards=[...document.querySelector('[data-stage-id="00000000-0000-0000-0000-000000000011"] [data-cards]').children];const a=cards[0].querySelector('[data-task-title]').getBoundingClientRect();const b=cards[1].getBoundingClientRect();return {id:cards[0].dataset.taskId,after:cards[1].dataset.taskId,x:a.x+a.width/2,y:a.y+a.height/2,tx:b.x+b.width/2,ty:b.bottom-8}})()`);
await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:reorder.x,y:reorder.y});await send('Input.dispatchMouseEvent',{type:'mousePressed',x:reorder.x,y:reorder.y,button:'left',buttons:1,clickCount:1});
for(let i=1;i<=20;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:reorder.x+(reorder.tx-reorder.x)*i/20,y:reorder.y+(reorder.ty-reorder.y)*i/20,button:'left',buttons:1});await new Promise(r=>setTimeout(r,25));}
await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:reorder.tx,y:reorder.ty,button:'left',buttons:0,clickCount:1});
await wait(`window.__boardMock.calls.filter(c=>c.path==='move_task_relative').at(-1)?.body.p_after_task_id==='${reorder.after}'`);await settled();
await evaluate(`document.querySelectorAll('.toast .btn-close').forEach(button=>button.click())`);
const cardDrag = await checkWholeCardDrag({evaluate,send,wait,protectedIds:[coords.id,reorder.id,reorder.after]});
// A real page reload rereads the persisted mock backend, including moved/reordered tasks.
await send('Page.reload'); await new Promise(resolve=>setTimeout(resolve,400));
await wait(`document.querySelector('[data-state="board"]')?.hidden===false && document.querySelector('[data-live-status]')?.textContent==='Live updates connected'`);
assert(await evaluate(`window.__boardMock.tasks.find(t=>t.id==='${coords.id}').stage_id==='00000000-0000-0000-0000-000000000013'`),'Moved stage persists across page reload');
assert(await evaluate(`window.__boardMock.tasks.find(t=>t.id==='${reorder.id}').position>window.__boardMock.tasks.find(t=>t.id==='${reorder.after}').position`),'Reordering persists across page reload');
assert(await evaluate(`window.__boardMock.tasks.find(t=>t.id==='${cardDrag.completedId}').done===true`),'Handle-move completion survives reload');
// Mobile, long titles, optional metadata and safe rendering.
await evaluate(`window.__boardMock.tasks[1].title='An exceptionally long task title '+ 'with clear words '.repeat(15);window.__boardMock.tasks[1].description='<script>window.__xss=true</script><p>Visible description</p>';scrollTo(0,0)`);await broadcast();await settled();
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await new Promise(r=>setTimeout(r,300));
assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),'Mobile page must not overflow horizontally');
assert(await evaluate(`window.__xss!==true`),'Task text safely rendered');
await saveScreenshot('mobile.png');
await click('[data-toggle-filters]');assert(await evaluate(`document.querySelector('[data-filter-controls]').classList.contains('is-open')`),'Mobile filter controls expand');await click('[data-toggle-filters]');
await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
const touchTarget=await evaluate(`(()=>{const r=document.querySelector('.task-card [data-task-title]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+Math.min(r.height/2,20)}})()`);
await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touchTarget]});
await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
await wait(`document.querySelector('.task-view-modal.show') && document.activeElement.matches('#task-view-title-input')`);
assert(await evaluate(`(()=>{const r=document.querySelector('.task-view-modal .modal-content').getBoundingClientRect();return r.width<=innerWidth&&r.height<=innerHeight;})()`),'Mobile dialog inside viewport');
await saveScreenshot('mobile-details.png');
await click('.task-view-modal [data-bs-dismiss="modal"]');await settled();
// Realtime refresh and existing permission hints.
await evaluate(`window.__boardMock.member=true`);await broadcast();await wait(`document.querySelector('[data-link="edit"]').hidden===true`);
assert(await evaluate(`document.querySelector('[data-link="users"]').hidden && !document.querySelector('[data-add-primary]').hidden`),'Member actions respect permissions');
await evaluate(`window.__boardMock.tasks.splice(0)`);await broadcast();await wait(`document.querySelector('[data-empty-project]').hidden===false`);
assert(await evaluate(`document.querySelectorAll('.task-card').length===0 && document.querySelectorAll('.board-column').length===4`),'Empty project keeps real stages');
await evaluate(`window.__boardMock.failBoard=true`);await broadcast();await wait(`document.querySelector('[data-state="error"]').hidden===false`);
await evaluate(`window.__boardMock.failBoard=false`);await click('[data-retry]');await settled();
// Access loss while editing destroys the open modal and clears the board.
await click('[data-add-primary]');await wait(`document.querySelector('.task-form-modal.show')`);
await evaluate(`window.__boardMock.denied=true`);await broadcast('access_changed');
await wait(`document.querySelector('[data-state="notfound"]').hidden===false && !document.querySelector('.modal')`);
assert(errors.length===0,'No uncaught browser errors: '+errors.join('\n'));
console.log('PASS: full-board search, status/clear/no matches, description expansion, grouped dialogs/focus, failed and successful saves, filter retention, add/edit/delete, keyboard move/failure restoration, whole-card drag, authoritative reload, desktop/mobile overflow, safe long text, mobile controls/dialogs, Realtime, permission hints, empty board, API failure/retry and access loss.');

}
