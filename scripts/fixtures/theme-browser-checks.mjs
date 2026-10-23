import assert from 'node:assert/strict';
export async function checkThemeBrowser({evaluate,send,wait,saveScreenshot,errors,debugUrl,appUrl}) {
 const check=async(expression,message)=>assert.equal(await evaluate(expression),true,message);
 await check(`TaskboardTheme.get().preference==='system' && document.documentElement.dataset.bsTheme==='dark'`,'Fresh visit follows dark system');
 await check(`document.querySelector('head script').getAttribute('src')==='/theme.js'`,'Blocking theme bootstrap precedes application');
 await saveScreenshot('dark-desktop.png');
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
 await wait(`document.documentElement.dataset.bsTheme==='light'`);
 await saveScreenshot('light-desktop.png');
 await evaluate(`document.querySelector('.sidebar-account [data-theme-preference="dark"]').click()`);
 await check(`TaskboardTheme.get().preference==='dark' && localStorage.getItem('taskboard:theme')==='dark'`,'Explicit dark preference stored');
 await send('Page.reload',{ignoreCache:true});
 await wait(`document.querySelectorAll('.task-card').length===53`);
 await check(`document.documentElement.dataset.bsTheme==='dark' && document.querySelector('.sidebar-account [data-theme-preference="dark"]').getAttribute('aria-pressed')==='true'`,'Theme survives reload');
 await evaluate(`document.querySelector('.sidebar-collapse').click()`);
 await check(`document.querySelector('.sidebar-account [data-theme-preference="dark"]').getBoundingClientRect().width>30 && document.documentElement.scrollWidth<=innerWidth`,'Collapsed rail controls fit');
 await evaluate(`document.querySelector('.sidebar-collapse').click();document.querySelector('.task-card [data-open-task]').click()`);
 await wait(`!!document.querySelector('.task-view-modal.show .ql-editor') && document.activeElement.id==='task-view-title-input'`);
 await check(`getComputedStyle(document.querySelector('.ql-toolbar')).backgroundColor!=='rgb(255, 255, 255)' && getComputedStyle(document.querySelector('.ql-editor')).color==='rgb(231, 237, 245)'`,'Dark Quill editor surface and text');
 await saveScreenshot('dark-task-editor.png');
 await evaluate(`document.querySelector('.task-view-modal [data-bs-dismiss="modal"]').click()`);
 await wait(`!document.querySelector('.modal.show')`);
 // A real second tab writes localStorage; the first receives the browser's storage event.
 const target=await (await fetch(new URL('/json/new?'+encodeURIComponent(new URL('/theme.js',appUrl).href),debugUrl),{method:'PUT'})).json();
 const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
 let seq=0;const pending=new Map();socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){pending.get(data.id)?.(data.result);pending.delete(data.id);}});
 const other=(method,params)=>new Promise(resolve=>{const id=++seq;pending.set(id,resolve);socket.send(JSON.stringify({id,method,params}));});
 try {
  for(let i=0;i<40;i++){const state=await other('Runtime.evaluate',{expression:'location.origin',returnByValue:true});if(state.result?.value===appUrl.origin)break;await new Promise(r=>setTimeout(r,50));}
  await other('Runtime.evaluate',{expression:`localStorage.setItem('taskboard:theme','light')`});
  await wait(`document.documentElement.dataset.bsTheme==='light' && TaskboardTheme.get().preference==='light'`);
 } finally { socket.close();await fetch(new URL('/json/close/'+target.id,debugUrl)); }
 await evaluate(`TaskboardTheme.set('system')`);
 await check(`!localStorage.getItem('taskboard:theme')`,'System does not persist derived colour');
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
 await wait(`document.documentElement.dataset.bsTheme==='dark'`);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await evaluate(`document.querySelector('[data-open-sidebar]').click()`);
 await wait(`document.querySelector('.app-sidebar').classList.contains('show')`);
 await check(`document.querySelector('.sidebar-account .theme-selector').getBoundingClientRect().right<innerWidth`,'Mobile theme control fits');
 await saveScreenshot('dark-mobile.png');
 await evaluate(`document.querySelector('.sidebar-account [data-theme-preference="light"]').click()`);
 await saveScreenshot('light-mobile.png');
 await evaluate(`document.querySelector('.sidebar-account [data-theme-preference="dark"]').click();document.querySelector('.sidebar-logout').click()`);
 await wait(`location.pathname==='/' && document.querySelector('#navigation-shell').hidden`);
 await check(`document.documentElement.dataset.bsTheme==='dark' && document.querySelector('.footer-theme [data-theme-preference="dark"]').getAttribute('aria-pressed')==='true'`,'Logout retains theme and public selector');
 await saveScreenshot('dark-landing-mobile.png');
 await evaluate(`document.querySelector('.footer-theme [data-theme-preference="light"]').click()`);
 await saveScreenshot('light-landing-mobile.png');
 await evaluate(`document.querySelector('#header a[href="/login"]').click()`);
 await wait(`location.pathname==='/login' && !!document.querySelector('input[type="password"]')`);
 await check(`document.documentElement.dataset.bsTheme==='light'`,'Public navigation preserves light preference');
 await saveScreenshot('light-login-mobile.png');
 await evaluate(`document.querySelector('.footer-theme [data-theme-preference="dark"]').click()`);
 await saveScreenshot('dark-login-mobile.png');
 assert.deepEqual(errors,[]);
 console.log('PASS: fresh system dark/light, explicit selection, reload, real cross-tab sync, system changes, rail/mobile controls, Quill, public theme after logout; screenshots captured.');
}
