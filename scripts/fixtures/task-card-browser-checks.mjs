import assert from 'node:assert/strict';
export async function checkTaskCardsBrowser({evaluate,send,wait,saveScreenshot,errors}) {
 const check=async(e,m)=>assert.equal(await evaluate(e),true,m);
 const change=(selector,value)=>evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await evaluate(`(()=>{const task=__boardMock.tasks[0];task.title='A clear title that can wrap naturally across several lines without awkward breaks';task.description='<script>window.__cardXss=true</script><p>A rich <strong>description</strong> with enough detail to wrap neatly. '+ 'Useful context for the team. '.repeat(14)+'</p>';task.task_labels=['Product','Design','Engineering','A very long label for testing'].map((name,i)=>({project_labels:{id:__boardMock.id(31+i),name,colour:['#dce9ff','#f8d7da','#def4d8','#28394c'][i]}}));__boardMock.cardAssignees=['Alex Morgan','Sam Lee','Robin Park','Taylor Quinn'].map((label,i)=>({task_id:task.id,user_id:__boardMock.id(900+i),label}));__boardMock.tasks[1].due_at='2030-04-05T12:00:00Z';__boardMock.tasks.find(t=>t.done).due_at='2020-01-01T12:00:00Z';window.__beforeCardRender=document.querySelector('.task-card');window.__mockSocket.emit('message',new MessageEvent('message',{data:JSON.stringify([null,null,'realtime:project:00000000-0000-0000-0000-000000000010:board','broadcast',{event:'project_changed',payload:{project_id:'00000000-0000-0000-0000-000000000010'},type:'broadcast'}])}));})()`);
 await wait(`!__beforeCardRender.isConnected && document.querySelectorAll('[data-task-id="00000000-0000-0000-0000-000000000100"] .project-label').length===2`);
 await check(`document.querySelector('[data-task-id="00000000-0000-0000-0000-000000000100"] .task-label-overflow').textContent==='+2'`,'Two labels and overflow');
 await check(`document.querySelectorAll('[data-task-id="00000000-0000-0000-0000-000000000100"] .task-avatar').length===3 && document.querySelector('.task-avatar-overflow').textContent==='+2'`,'Two assignees and overflow');
 await check(`!window.__cardXss && !document.querySelector('.task-card script')`,'Rich description becomes safe plain text');
 await check(`document.querySelector('[data-task-id="00000000-0000-0000-0000-000000000100"] [data-deadline]').classList.contains('is-overdue') && !document.querySelector('[data-stage-id="00000000-0000-0000-0000-000000000014"] [data-deadline]').classList.contains('is-overdue')`,'Only unfinished tasks appear overdue');
 await check(`!document.querySelector('[data-task-id="00000000-0000-0000-0000-000000000101"] [data-deadline]').classList.contains('is-overdue') && document.querySelector('[data-task-id="00000000-0000-0000-0000-000000000102"] [data-card-meta]').hidden`,'Upcoming deadline and empty metadata state');
 await evaluate(`document.querySelector('.task-card [data-open-task]').focus({preventScroll:true})`);
 await check(`!document.querySelector('[data-drag-handle]')`,'No obsolete drag grip');
 await check(`getComputedStyle(document.querySelector('.task-card')).borderRadius==='12px' && getComputedStyle(document.querySelector('.task-excerpt')).webkitLineClamp==='2'`,'Card radius and excerpt clamp');
 for(const theme of ['light','dark'])for(const density of ['comfortable','compact']){
  await evaluate(`TaskboardTheme.set('${theme}')`);await change('[data-card-density]',density);await new Promise(r=>setTimeout(r,200));await saveScreenshot(`cards-${theme}-${density}.png`);
 }
 await evaluate(`document.querySelector('[data-card-descriptions]').checked=false;document.querySelector('[data-card-descriptions]').dispatchEvent(new Event('change',{bubbles:true}))`);
 await check(`getComputedStyle(document.querySelector('.task-excerpt')).display==='none'`,'Description preference hides preview');
 await send('Page.reload',{ignoreCache:true});await wait(`document.querySelectorAll('.task-card').length===53`);
 await check(`document.querySelector('.page-tasks').dataset.density==='compact' && document.querySelector('.page-tasks').dataset.descriptions==='hide'`,'Display preferences survive reload');
 await evaluate(`document.querySelector('[data-card-descriptions]').checked=true;document.querySelector('[data-card-descriptions]').dispatchEvent(new Event('change',{bubbles:true}))`);await change('[data-card-density]','comfortable');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await check(`document.documentElement.scrollWidth<=innerWidth && !document.querySelector('[data-drag-handle]')`,'Mobile fits without a drag grip');
 await saveScreenshot('cards-mobile.png');
 await evaluate(`document.querySelector('.task-card-content').click()`);await wait(`document.querySelector('.task-view-modal.show') && document.activeElement.id==='task-view-title-input'`);
 assert.deepEqual(errors,[]);console.log('PASS: labels/assignee overflow, safe excerpts, overdue/completed states, both densities/themes, saved display preferences, mobile layout and main-content opening.');
}
