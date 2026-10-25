import assert from 'node:assert/strict';
export async function checkWholeCardDrag({evaluate,send,wait,protectedIds}) {
 const count=()=>evaluate(`__boardMock.calls.filter(c=>c.path==='move_task_relative').length`);
 const settled=()=>wait(`document.querySelector('.page-tasks')?.getAttribute('aria-busy')==='false' && !document.querySelector('.board.is-saving')`);
 const pointerDrag=async(points)=>{
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.x,y:points.y});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:points.x,y:points.y,button:'left',buttons:1,clickCount:1});
  let grabOffset;
  for(let i=1;i<=24;i++){
   const x=points.x+(points.tx-points.x)*i/24,y=points.y+(points.ty-points.y)*i/24;
   await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'left',buttons:1});
   const preview=await evaluate(`(()=>{const el=document.querySelector('.task-drag-preview');if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,transition:getComputedStyle(el).transitionDuration}})()`);
   // Sortable appends its clone asynchronously after the first movement.
   if(preview && i>=2){
    assert.equal(preview.transition,'0s','Drag preview must not animate pointer movement');
    const offset={x:x-preview.x,y:y-preview.y};
    if(grabOffset)assert.ok(Math.abs(offset.x-grabOffset.x)<4 && Math.abs(offset.y-grabOffset.y)<4,`Preview stays attached to the pointer: step ${i}, initial ${JSON.stringify(grabOffset)}, current ${JSON.stringify(offset)}`);
    else grabOffset=offset;
   }
   await new Promise(r=>setTimeout(r,20));
  }
  assert.ok(grabOffset,'Visible drag preview follows the pointer');
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:points.tx,y:points.ty,button:'left',buttons:0,clickCount:1});
 };
 const coordinates=(kind,stage)=>evaluate(`(()=>{const blocked=${JSON.stringify(protectedIds)};const card=[...document.querySelectorAll('[data-stage-id="00000000-0000-0000-0000-000000000011"] .task-card')].find(c=>!blocked.includes(c.dataset.taskId) && ${kind==='description'?"!c.querySelector('[data-task-excerpt]').hidden":"true"});card.scrollIntoView({block:'nearest'});const r=(${kind==='description'?"card.querySelector('[data-task-excerpt]')":"card"}).getBoundingClientRect(),to=document.querySelector('[data-stage-id="${stage}"] [data-cards]').getBoundingClientRect();return {id:card.dataset.taskId,x:r.x+${kind==='description'?'r.width/2':'8'},y:r.y+${kind==='description'?'r.height/2':'8'},tx:to.x+to.width/2,ty:to.y+80}})()`);
 assert.equal(await evaluate(`!document.querySelector('[data-drag-handle]')`),true,'No dedicated grip remains');
 let before=await count();const description=await coordinates('description','00000000-0000-0000-0000-000000000014');await pointerDrag(description);
 await wait(`__boardMock.calls.filter(c=>c.path==='move_task_relative').length>${before}`);await settled();
 assert.equal(await evaluate(`__boardMock.tasks.find(t=>t.id==='${description.id}').done`),true,'Description drag updates completion');
 assert.equal(await evaluate(`!document.querySelector('.modal.show')`),true,'Drag release never opens details');
 await evaluate(`window.__beforeRealtimeCard=document.querySelector('.task-card');window.__mockSocket.emit('message',new MessageEvent('message',{data:JSON.stringify([null,null,'realtime:project:00000000-0000-0000-0000-000000000010:board','broadcast',{event:'project_changed',payload:{project_id:'00000000-0000-0000-0000-000000000010'},type:'broadcast'}])}))`);
 await wait(`!__beforeRealtimeCard.isConnected && document.querySelector('.page-tasks')?.getAttribute('aria-busy')==='false'`);
 before=await count();const background=await coordinates('background','00000000-0000-0000-0000-000000000012');await pointerDrag(background);
 await wait(`__boardMock.calls.filter(c=>c.path==='move_task_relative').length>${before}`);await settled();
 assert.equal(await count(),before+1,'One mutation per background drag after rerenders');
 // The next fresh click must work even if no click was emitted by native drag release.
 const r=await evaluate(`(()=>{const r=document.querySelector('[data-task-id="${background.id}"] [data-task-title]').getBoundingClientRect();return{x:r.x+10,y:r.y+Math.min(10,r.height/2)}})()`);
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'left',buttons:1,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+2,y:r.y+1,button:'left',buttons:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'left',buttons:0,clickCount:1});
 await wait(`document.querySelector('.task-view-modal.show') && document.activeElement.id==='task-view-title-input'`);
 await evaluate(`window.__closingCard=document.querySelector('.task-card');document.querySelector('.task-view-modal [data-bs-dismiss="modal"]').click()`);await wait(`!document.querySelector('.modal') && !__closingCard.isConnected && document.querySelector('.page-tasks')?.getAttribute('aria-busy')==='false'`);
 // Controls are excluded without preventDefault, including controls added by a future card component.
 await evaluate(`(()=>{const card=document.querySelector('[data-stage-id="00000000-0000-0000-0000-000000000011"] .task-card');const label=document.createElement('label');label.dataset.testControl='';label.textContent='Check';const input=document.createElement('input');input.type='checkbox';label.append(input);card.append(label);})()`);
 const control=await evaluate(`(()=>{const label=document.querySelector('[data-test-control]');label.scrollIntoView({block:'nearest'});const r=label.getBoundingClientRect();return {x:r.x+4,y:r.y+r.height/2}})()`);before=await count();
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...control,button:'left',buttons:1,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...control,button:'left',buttons:0,clickCount:1});
 assert.equal(await evaluate(`document.querySelector('[data-test-control] input').checked && !document.querySelector('.modal.show')`),true,'Label/checkbox click preserved');assert.equal(await count(),before);
 await evaluate(`(()=>{const link=document.createElement('a');link.href='#card-control-check';link.textContent='Attachment link';link.dataset.testLink='';document.querySelector('[data-test-control]').parentElement.append(link);})()`);
 const linkPoint=await evaluate(`(()=>{const link=document.querySelector('[data-test-link]');link.scrollIntoView({block:'nearest'});const r=link.getBoundingClientRect();return{x:r.x+8,y:r.y+r.height/2}})()`);
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...linkPoint,button:'left',buttons:1,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...linkPoint,button:'left',buttons:0,clickCount:1});
 assert.equal(await evaluate(`location.hash==='#card-control-check' && !document.querySelector('.modal.show')`),true,'Native link navigation preserved');assert.equal(await count(),before,'Link click never drags');
 await evaluate(`document.querySelector('[data-test-link]').remove();history.replaceState(history.state,'',location.pathname+location.search)`);
 await evaluate(`document.querySelector('[data-test-control]').remove();__boardMock.failMove=true;window.__beforeDragOrder=__boardMock.tasks.map(t=>[t.id,t.stage_id,t.position]);window.__beforeDragDOM=[...document.querySelectorAll('[data-cards]')].map(list=>[list.closest('[data-stage-id]').dataset.stageId,[...list.querySelectorAll('.task-card')].map(card=>card.dataset.taskId)])`);
 before=await count();const failure=await coordinates('background','00000000-0000-0000-0000-000000000012');await pointerDrag(failure);await wait(`__boardMock.calls.filter(c=>c.path==='move_task_relative').length>${before}`);await settled();
 assert.equal(await evaluate(`JSON.stringify(__beforeDragOrder)===JSON.stringify(__boardMock.tasks.map(t=>[t.id,t.stage_id,t.position]))`),true,'Failed drag restores authoritative order');assert.equal(await evaluate(`JSON.stringify(__beforeDragDOM)===JSON.stringify([...document.querySelectorAll('[data-cards]')].map(list=>[list.closest('[data-stage-id]').dataset.stageId,[...list.querySelectorAll('.task-card')].map(card=>card.dataset.taskId)]))`),true,'Failed drag restores visible column order');await evaluate(`__boardMock.failMove=false`);
 // Touch scroll cancels the hold; a deliberate hold then moves a card through Sortable's fallback path.
 await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 await evaluate(`document.querySelector('[data-board]').scrollIntoView({block:'start'});document.querySelector('[data-stage-id="00000000-0000-0000-0000-000000000011"] [data-cards]').scrollTop=0`);
 let touch=await evaluate(`(()=>{const list=document.querySelector('[data-stage-id="00000000-0000-0000-0000-000000000011"] [data-cards]');const r=list.getBoundingClientRect();return {x:r.x+100,y:r.y+140}})()`);before=await count();
 await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});
 await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touch.x,y:touch.y-45}]});
 await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touch.x,y:touch.y-90}]});
 await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await wait(`document.querySelector('[data-stage-id="00000000-0000-0000-0000-000000000011"] [data-cards]').scrollTop>0`);
 assert.equal(await count(),before,'Touch scrolling never saves a move');
 await new Promise(r=>setTimeout(r,600));
 await evaluate(`document.querySelector('[data-stage-id="00000000-0000-0000-0000-000000000011"] [data-cards]').scrollTop=0`);
 touch=await coordinates('background','00000000-0000-0000-0000-000000000011');touch.ty-=65;before=await count();
 await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touch.x,y:touch.y}]});await new Promise(r=>setTimeout(r,220));
 for(let i=1;i<=20;i++){await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touch.x+(touch.tx-touch.x)*i/20,y:touch.y+(touch.ty-touch.y)*i/20}]});await new Promise(r=>setTimeout(r,20));}
 await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await wait(`__boardMock.calls.filter(c=>c.path==='move_task_relative').length>${before}`);await settled();
 assert.equal(await evaluate(`!document.querySelector('.modal.show')`),true,'Touch drag release never opens details');
 await evaluate(`document.querySelector('[data-stage-id="00000000-0000-0000-0000-000000000011"] [data-cards]').scrollTop=0`);
 const nextTap=await evaluate(`(()=>{const r=document.querySelector('[data-stage-id="00000000-0000-0000-0000-000000000011"] [data-task-title]').getBoundingClientRect();return {x:r.x+10,y:r.y+10}})()`);
 await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[nextTap]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await wait(`document.querySelector('.task-view-modal.show') && document.activeElement.id==='task-view-title-input'`);
 await evaluate(`window.__closingCard=document.querySelector('.task-card');document.querySelector('.task-view-modal [data-bs-dismiss="modal"]').click()`);await wait(`!document.querySelector('.modal') && !__closingCard.isConnected && document.querySelector('.page-tasks')?.getAttribute('aria-busy')==='false'`);
 await send('Emulation.setTouchEmulationEnabled',{enabled:false});
 console.log('PASS: whole-card drag, completion, click-after-drag, checkbox/label exclusions, no duplicate saves after rerender and failed-drag recovery, touch scroll and touch-hold reorder.');
 return {completedId:description.id};
}
