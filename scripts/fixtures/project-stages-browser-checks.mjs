import assert from 'node:assert/strict';
export async function checkProjectStages({evaluate,send,wait,saveScreenshot,errors}) {
 const check=async(e,m)=>assert.equal(await evaluate(e),true,m);
 const click=s=>evaluate(`document.querySelector(${JSON.stringify(s)}).click()`);
 const value=(s,v)=>evaluate(`(()=>{const i=document.querySelector(${JSON.stringify(s)});i.value=${JSON.stringify(v)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const settled=()=>wait(`!document.querySelector('.modal') && document.querySelector('.page-tasks')?.getAttribute('aria-busy')==='false'`);
 const open=async()=>{await click('[data-add-stage]');await wait(`document.activeElement?.id==='add-stage-name'`);};
 const broadcast=()=>evaluate(`__mockSocket.emit('message',new MessageEvent('message',{data:JSON.stringify([null,null,'realtime:project:00000000-0000-0000-0000-000000000010:board','broadcast',{event:'project_changed',payload:{project_id:'00000000-0000-0000-0000-000000000010'},type:'broadcast'}])}))`);
 await check(`document.querySelector('[data-board]').lastElementChild.matches('[data-add-stage]')`,'Add Stage follows all columns');
 await open();await check(`!document.querySelector('#add-stage-done').checked`,'Ordinary stage by default');
 for(const name of ['','   ','bAcKLoG']){await value('#add-stage-name',name);await click('.add-stage-modal [data-submit]');await check(`!document.querySelector('.add-stage-modal [data-error]').hidden && !__boardMock.calls.some(c=>c.path==='create_project_stage')`,'Invalid name blocked');}
 await value('#add-stage-name','Cancelled');await click('.add-stage-modal .modal-footer [data-bs-dismiss]');await settled();await check(`__boardMock.stages.length===4`,'Cancel does not create');
 await value('[data-search]','Design');await wait(`document.querySelector('.page-tasks').getAttribute('aria-busy')==='false' && document.querySelectorAll('.task-card').length<53`);
 await evaluate(`document.querySelector('[data-board]').scrollLeft=160;window.__stageScroll=document.querySelector('[data-board]').scrollLeft;__boardMock.failStage=true;__boardMock.delayStage=150`);
 await open();await value('#add-stage-name','  Verification  ');
 await evaluate(`document.querySelector('.add-stage-modal [data-submit]').click();document.querySelector('.add-stage-modal [data-submit]').click()`);
 await wait(`document.querySelector('.add-stage-modal [data-error]')?.hidden===false && !document.querySelector('.add-stage-modal [data-submit]').disabled`);
 await check(`__boardMock.calls.filter(c=>c.path==='create_project_stage').length===1 && document.querySelector('#add-stage-name').value==='  Verification  '`,'Save failure preserves draft and blocks duplicate submissions');
 await evaluate(`__boardMock.failStage=false;__boardMock.duplicateStage=true`);await click('.add-stage-modal [data-submit]');await wait(`document.querySelector('.add-stage-modal [data-error]').textContent.includes('already exists')`);
 await evaluate(`__boardMock.duplicateStage=false`);await click('.add-stage-modal [data-submit]');await settled();
 await check(`__boardMock.stages.at(-1).name==='Verification' && !__boardMock.stages.at(-1).is_done && document.querySelectorAll('.board-column').length===5`,'Ordinary stage appended');
 await check(`document.querySelector('[data-search]').value==='Design' && Math.abs(document.querySelector('[data-board]').scrollLeft-__stageScroll)<2`,'Filters and horizontal scroll preserved');
 await click('[data-clear-filters]');await open();await value('#add-stage-name','Released');await click('#add-stage-done');
 for(const theme of ['light','dark']){
   await evaluate(`TaskboardTheme.set('${theme}')`);
   await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
   await new Promise(r=>setTimeout(r,150));
   await check(`(()=>{const b=document.querySelector('.add-stage-modal [data-submit]');const s=getComputedStyle(b);return s.backgroundColor!=='rgba(0, 0, 0, 0)' && s.backgroundColor!==s.color;})()`, 'Primary stage action has a visible theme background');
   await saveScreenshot(`add-stage-${theme}-mobile.png`);
   await check(`document.querySelector('.add-stage-modal .modal-content').getBoundingClientRect().width<=innerWidth && document.querySelector('.add-stage-modal .modal-footer').getBoundingClientRect().bottom<=innerHeight`,'Mobile modal fits viewport');
 }
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await click('.add-stage-modal [data-submit]');await settled();
 await evaluate(`window.__releaseId=__boardMock.stages.at(-1).id;window.__ordinaryId=__boardMock.stages.at(-2).id`);
 await evaluate(`document.querySelector('[data-stage-id="'+__releaseId+'"] [data-add]').click()`);
 await wait(`document.querySelector('#task-stage') && document.querySelector('.task-form-modal [data-submit]')?.disabled===false`);
 await check(`document.querySelector('#task-stage').value===__releaseId`,'Column Add Task preselects custom stage');
 await value('#task-title','Custom stage task');await click('.task-form-modal [data-submit]');await settled();
 await check(`__boardMock.tasks.find(t=>t.title==='Custom stage task')?.done===true && document.querySelector('[data-project-stats]').textContent.includes('2 completed')`,'Completion stage task and counts');
 await evaluate(`document.querySelector('[data-stage-id="'+__ordinaryId+'"] [data-add]').click()`);await wait(`document.querySelector('.task-form-modal [data-submit]')?.disabled===false`);
 await value('#task-title','Ordinary stage task');await click('.task-form-modal [data-submit]');await settled();
 await check(`__boardMock.tasks.find(t=>t.title==='Ordinary stage task')?.done===false`,'Ordinary stage task stays open');
 await evaluate(`document.querySelector('.task-card [data-task-menu-trigger]').click()`);await wait(`document.querySelector('[data-card-menu]:popover-open')`);await click('[data-card-menu]:popover-open [data-task-action="move"]');await wait(`document.querySelector('.move-task-modal.show')`);
 await check(`!!document.querySelector('[data-stage] option[value="'+__releaseId+'"]')`,'Custom stage in move menu');
 await value('[data-stage]',await evaluate('__releaseId'));await evaluate(`document.querySelector('[data-stage]').dispatchEvent(new Event('change',{bubbles:true}))`);await click('.move-task-modal button[type="submit"]');await settled();
 await check(`__boardMock.tasks.filter(t=>t.stage_id===__releaseId).every(t=>t.done) && document.querySelector('[data-project-stats]').textContent.includes('3 completed')`,'Moved task receives completion and updated count');
 // A stage added by another viewer refreshes through the existing broadcast, without touching an open edit.
 await click('.task-card [data-open-task]');await wait(`document.querySelector('#task-view-title-input') && document.querySelector('.task-view-modal [data-action="save"]')?.disabled===false`);
 await value('#task-view-title-input','Unsaved edit');await evaluate(`__boardMock.stages.push({id:__boardMock.id(8999),name:'Remote stage',position:6,is_done:false});sessionStorage.setItem('taskboard-stages-fixture',JSON.stringify(__boardMock.stages))`);await broadcast();
 await new Promise(r=>setTimeout(r,600));await check(`document.querySelector('#task-view-title-input').value==='Unsaved edit' && document.querySelectorAll('.board-column').length===6`,'Realtime preserves open edit and defers board refresh');
 await evaluate(`window.confirm=()=>true`);await click('.task-view-modal .modal-header [data-bs-dismiss]');await settled();await wait(`document.querySelectorAll('.board-column').length===7`);
 await send('Page.reload',{ignoreCache:true});await wait(`typeof window.__releaseId==='undefined' && document.querySelectorAll('.board-column').length===7 && document.querySelector('[data-live-status]').textContent==='Live updates connected'`);
 await check(`Array.from(document.querySelectorAll('[data-stage-name]')).map(e=>e.textContent).slice(-3).join(',')==='Verification,Released,Remote stage'`,'Custom order survives reload');
 await evaluate(`__boardMock.member=true`);await broadcast();await wait(`!document.querySelector('[data-add-stage]')`);
 await evaluate(`__boardMock.admin=true`);await broadcast();await wait(`!!document.querySelector('[data-add-stage]')`);
 await open();await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await settled();
 assert.deepEqual(errors,[]);console.log('PASS: stage dialog validation/cancel/retry/duplicate submission, ordinary/done creation, task forms and move menus, completion counts, reload/order, Realtime and unsaved edits, manager visibility, keyboard dismissal, light/dark mobile.');
}
