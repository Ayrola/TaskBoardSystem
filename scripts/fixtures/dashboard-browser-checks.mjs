import assert from 'node:assert/strict';
export async function checkDashboardBrowser({evaluate,send,wait,saveScreenshot,errors}) {
 const base='/projects/00000000-0000-0000-0000-000000000010';
 const check=async(e,m)=>assert.equal(await evaluate(e),true,m);
 const click=s=>evaluate(`document.querySelector(${JSON.stringify(s)}).click()`);
 const value=(s,v,event='change')=>evaluate(`(()=>{const i=document.querySelector(${JSON.stringify(s)});i.value=${JSON.stringify(v)};i.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
 const go=path=>evaluate(`(()=>{const a=document.createElement('a');a.href=${JSON.stringify(path)};document.body.append(a);a.click();a.remove();})()`);
 const ready=()=>wait(`document.querySelector('.page-dashboard')?.getAttribute('aria-busy')==='false' && document.querySelectorAll('.summary-card').length===8`);
 const boardReady=()=>wait(`document.querySelector('.page-tasks')?.getAttribute('aria-busy')==='false' && document.querySelector('[data-state="board"]')?.hidden===false`);
 const broadcast=()=>evaluate(`__mockSocket.emit('message',new MessageEvent('message',{data:JSON.stringify([null,null,'realtime:project:00000000-0000-0000-0000-000000000010:board','broadcast',{event:'project_changed',payload:{project_id:'00000000-0000-0000-0000-000000000010'},type:'broadcast'}])}))`);
 await evaluate(`__boardMock.formAssignees={[__boardMock.tasks[0].id]:[{user_id:__boardMock.id(1),label:'Alex Morgan'},{user_id:__boardMock.id(2),label:'Sam Reed'}]};__boardMock.tasks[1].due_at='2030-01-01T12:00:00Z';`);
 await click(`.app-sidebar a[href="${base}/dashboard"]`);await ready();
 await check(`document.querySelector('.app-sidebar a[aria-current="page"]').href.endsWith('/dashboard') && document.querySelector('[data-project-name]').textContent==='Product workspace'`,'Project name and active sidebar');
 await check(`document.querySelectorAll('canvas').length===4 && document.querySelectorAll('[data-stage-table] tr').length===4 && document.querySelectorAll('[data-creation-table] tr').length===30`,'Charts and accessible tables');
 await check(`document.querySelector('[data-summary-cards]').textContent.includes('61') && document.querySelector('[data-summary-cards]').textContent.includes('60') && document.querySelector('[data-summary-cards]').textContent.includes('1.6%')`,'Current totals include unloaded tasks');
 await check(`document.querySelectorAll('[data-workload] li').length===3 && document.querySelector('[data-overdue]').textContent.includes('Design the onboarding') && document.querySelector('[data-upcoming]').textContent.includes('Improve dashboard')`,'Multi-assignee workload and separate deadlines');
 await check(`__boardMock.calls.filter(c=>c.path==='project_dashboard').length===1`,'One request for all analytics');
 for(const days of [7,90,30]){await value('[data-period]',String(days));await ready();await check(`document.querySelectorAll('[data-creation-table] tr').length===${days} && document.querySelector('[data-summary-cards]').textContent.includes('61')`,'Only time-based widgets change period');}
 for(const theme of ['light','dark']){await evaluate(`TaskboardTheme.set('${theme}')`);await new Promise(r=>setTimeout(r,100));await saveScreenshot(`project-dashboard-${theme}-desktop.png`);}
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 for(const theme of ['light','dark']){await evaluate(`TaskboardTheme.set('${theme}')`);await new Promise(r=>setTimeout(r,100));await saveScreenshot(`project-dashboard-${theme}-mobile.png`);await check(`document.documentElement.scrollWidth<=innerWidth`,'Mobile layout has no horizontal overflow');}
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 for(const [query,visible] of [['status=open','Status: Open'],['status=completed','Status: Completed'],['status=open&due=overdue','Due: Overdue'],['status=open&assignment=unassigned','Assignment: Unassigned']]){
   await click(`.summary-card[href="${base}/tasks?${query}"]`);await boardReady();
   await check(`document.querySelector('[data-filter-chips]').textContent.includes(${JSON.stringify(visible)}) && !document.querySelector('[data-active-filters]').hidden`,'Card destination visibly applies filters');
   if(query==='status=completed')await check(`document.querySelectorAll('.task-card').length===1`,'Completed card results');
   if(query==='status=open&assignment=unassigned')await check(`document.querySelectorAll('.task-card').length===59`,'Unassigned open results');
   await go(`${base}/dashboard`);await ready();
 }
 await evaluate(`document.querySelector('[data-stage-table] a').focus()`);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await boardReady();await check(`document.querySelector('[data-filter-chips]').textContent.includes('Stage: Backlog') && document.querySelectorAll('.task-card').length===58`,'Stage link includes every task');
 await go(`${base}/dashboard`);await ready();
 await click('[data-workload] a');await boardReady();await check(`document.querySelector('[data-filter-chips]').textContent.includes('Alex Morgan') && document.querySelectorAll('.task-card').length===1`,'Person filter');
 await go(`${base}/dashboard`);await ready();
 // Exercise the canvas click as well as its keyboard-accessible table alternative.
 await evaluate(`window.__dashboardBeforeCharts=__boardMock.calls.length`);
 await evaluate(`document.querySelector('[data-chart="stages"]').scrollIntoView({block:'center',behavior:'instant'})`);await new Promise(r=>setTimeout(r,100));
 const point=await evaluate(`(()=>{const c=document.querySelector('[data-chart="stages"]'),r=c.getBoundingClientRect();return{x:r.x+r.width*.5,y:r.y+35};})()`);
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
 await boardReady();await go(`${base}/dashboard`);await ready();
 await evaluate(`__boardMock.failDashboard=true;__boardMock.delayDashboard=150`);await click('[data-refresh]');
 await check(`!document.querySelector('[data-content]').hidden`,'Background refresh keeps snapshot');
 await wait(`!document.querySelector('[data-error]').hidden`);await check(`document.querySelector('[data-refreshed]').textContent.includes('Refresh failed') && document.querySelectorAll('.summary-card').length===8`,'Background failure preserves last good data');
 await evaluate(`__boardMock.failDashboard=false;__boardMock.delayDashboard=0`);await click('[data-retry]');await ready();
 await value('[data-period]','7');await ready();
 await evaluate(`window.__dashboardRequestCount=__boardMock.calls.filter(c=>c.path==='project_dashboard').length;window.__dashboardHistoryLength=history.length`);
 await click(`.app-sidebar a[href="${base}/dashboard"]`);await ready();
 await check(`__boardMock.calls.filter(c=>c.path==='project_dashboard').length===__dashboardRequestCount+1 && document.querySelector('[data-period]').value==='7' && history.length===__dashboardHistoryLength`,'Reselecting Dashboard reloads data, preserves period and adds no history entry');
 await evaluate(`__boardMock.delayDashboard=200;window.__dashboardRequestCount=__boardMock.calls.filter(c=>c.path==='project_dashboard').length`);
 await click('[data-dashboard-link]');await click('[data-dashboard-link]');await ready();
 await check(`__boardMock.calls.filter(c=>c.path==='project_dashboard').length>=__dashboardRequestCount+2 && !document.querySelector('[data-content]').hidden`,'Repeated Dashboard clicks finish with populated data');
 await evaluate(`__boardMock.delayDashboard=0`);

 await evaluate(`__boardMock.tasks[0].done=true;__boardMock.tasks[0].stage_id=__boardMock.id(14)`);await broadcast();
 await wait(`document.querySelector('.summary-card[href$="status=completed"] .summary-card-value').textContent==='2'`);
 await check(`document.querySelector('[data-period]').value==='7'`,'Realtime preserves chosen period');
 await evaluate(`__boardMock.zeroDashboard=true`);await click('[data-refresh]');await ready();
 await check(`!document.querySelector('[data-empty]').hidden && document.querySelector('[data-completion-note]').textContent.includes('neutral') && document.querySelector('[data-chart-total]').textContent==='0'`,'Empty neutral state');
 await click('[data-add-task]');await wait(`document.querySelector('.task-form-modal.show') && document.querySelector('#task-title')`);await click('.task-form-modal .modal-header [data-bs-dismiss]');await boardReady();
 await evaluate(`__boardMock.zeroDashboard=false;__boardMock.tasks.forEach(t=>{t.done=true;t.stage_id=__boardMock.id(14)})`);await go(`${base}/dashboard`);await ready();await check(`document.querySelector('[data-summary-cards]').textContent.includes('100%')`,'All completed');
 await evaluate(`__boardMock.tasks.forEach(t=>{t.done=false;t.stage_id=__boardMock.id(11);t.due_at=null});__boardMock.formAssignees={};__boardMock.dashboardActivity=[]`);await click('[data-refresh]');await ready();
 await check(`document.querySelector('[data-completion-note]').textContent.includes('0%') && document.querySelector('[data-upcoming]').textContent.includes('No upcoming') && document.querySelector('[data-activity]').textContent.includes('No recorded')`,'All open and missing optional data');
 // Initial failure, retry, and direct URL reload.
 await go(`${base}/tasks`);await boardReady();await evaluate(`__boardMock.failDashboard=true`);await go(`${base}/dashboard`);await wait(`document.querySelector('[data-error]')?.hidden===false`);await check(`document.querySelector('[data-content]').hidden && document.querySelector('[data-loading]').hidden`,'Initial failure is distinct from empty');
 await evaluate(`__boardMock.failDashboard=false`);await click(`.app-sidebar a[href="${base}/dashboard"]`);await ready();
 await go(`${base}/tasks`);await boardReady();await evaluate(`__boardMock.denied=true`);await go(`${base}/dashboard`);
 await wait(`document.querySelector('main')?.textContent.includes('Project unavailable')`);
 await evaluate(`__boardMock.denied=false`);await go(`${base}/dashboard`);await ready();
 await check(`!document.querySelector('[data-content]').hidden`,'Reselecting Dashboard recovers after project context failed before page mount');
 await send('Page.reload',{ignoreCache:true});await wait(`typeof window.__dashboardBeforeCharts==='undefined' && document.querySelectorAll('.summary-card').length===8 && document.querySelector('.page-dashboard')?.getAttribute('aria-busy')==='false'`);
 await check(`document.querySelector('[data-dashboard-link]').getAttribute('aria-current')==='page'`,'Direct URL loading');
 await go('/dashboard');await ready();await check(`location.pathname==='${base}/dashboard'`,'Existing global dashboard entry preserved');
 await evaluate(`__boardMock.delayDashboard=400`);await click('[data-refresh]');await go(`${base}/tasks`);await boardReady();await new Promise(r=>setTimeout(r,500));await check(`!!document.querySelector('.page-tasks') && !document.querySelector('.page-dashboard')`,'Leaving page ignores delayed responses and releases charts');
 assert.deepEqual(errors,[]);console.log('PASS: scoped dashboard/charts/tables, all metric filters and stage/person navigation, periods, initial/background loading/errors/retry, empty/all-open/all-done/missing fields, multiple assignees/deadlines/activity, direct/global entry, Realtime after move, stale response cleanup, keyboard and desktop/mobile themes.');
}
