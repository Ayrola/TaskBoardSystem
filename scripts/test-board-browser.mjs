// No browser dependency: use an isolated local Chrome DevTools session and synthetic API data.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkBoardBrowser } from './fixtures/board-browser-checks.mjs';
import { checkThemeBrowser } from './fixtures/theme-browser-checks.mjs';
import { checkSidebarBrowser } from './fixtures/sidebar-browser-checks.mjs';
const debugUrl = new URL(process.env.BOARD_CDP_URL ?? 'http://127.0.0.1:9223');
const appUrl = new URL(process.env.BOARD_APP_URL ?? 'http://127.0.0.1:5173');
for (const url of [debugUrl, appUrl]) if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('Browser checks require local URLs.');
let env = '';
try { env = readFileSync(new URL('../.env', import.meta.url), 'utf8'); } catch { /* Environment variable may be supplied instead. */ }
const api = new URL(process.env.VITE_SUPABASE_URL ?? env.match(/^VITE_SUPABASE_URL\s*=\s*["']?([^\s"']+)/m)?.[1] ?? 'https://preview.supabase.co');
const outputDir = mkdtempSync(join(tmpdir(),'taskboard-browser-'));
const target = await (await fetch(new URL('/json/new?about:blank',debugUrl),{ method:'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
let next = 0;
const pending = new Map();
const errors = [];
socket.addEventListener('message',event=>{
  const data=JSON.parse(event.data);
  if(data.id){const callbacks=pending.get(data.id);pending.delete(data.id);data.error?callbacks?.[1](new Error(JSON.stringify(data.error))):callbacks?.[0](data.result);}
  if(data.method==='Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description??data.params.exceptionDetails.text);
});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,[resolve,reject]);socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{
  const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
  return result.result?.value;
};
const wait=async expression=>{
  for(let attempt=0;attempt<120;attempt++){
    if(await evaluate(expression))return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error(`Timed out waiting for browser state: ${expression}`);
};
const saveScreenshot=async name=>{
  const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  writeFileSync(join(outputDir,name),Buffer.from(screenshot.data,'base64'));
};
try {
  await send('Runtime.enable'); await send('Page.enable');
  if (process.env.BOARD_CHECK_THEME || process.env.BOARD_DARK || process.env.BOARD_LIGHT) await send('Storage.clearDataForOrigin',{origin:appUrl.origin,storageTypes:'local_storage'});
  if (process.env.BOARD_LIGHT) await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
  if (process.env.BOARD_CHECK_THEME || process.env.BOARD_DARK) await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__boardPreview=${JSON.stringify({host:api.host,ref:api.hostname.split('.')[0]})};\n${readFileSync(new URL('./fixtures/board-browser-mock.js',import.meta.url),'utf8')}`});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:new URL('/projects/00000000-0000-0000-0000-000000000010/tasks',appUrl).href});
  await wait(`document.querySelectorAll('.task-card').length===53 && document.querySelector('[data-live-status]').textContent==='Live updates connected'`);
  if(process.env.BOARD_LIGHT && await evaluate(`document.documentElement.dataset.bsTheme!=='light'`))throw Error('Expected light theme.');
  if(process.env.BOARD_DARK && await evaluate(`document.documentElement.dataset.bsTheme!=='dark'`))throw Error('Expected dark theme.');
  if(await evaluate(`document.documentElement.scrollWidth>innerWidth`))throw Error('Desktop page overflow.');
  await saveScreenshot('desktop.png');
  await (process.env.BOARD_CHECK_THEME ? checkThemeBrowser : process.env.BOARD_CHECK_SIDEBAR ? checkSidebarBrowser : checkBoardBrowser)({evaluate,send,wait,saveScreenshot,errors,debugUrl,appUrl});
  console.log(`Screenshots: ${outputDir}`);
} catch(error) {
  await saveScreenshot('failure.png').catch(()=>{});
  console.error(`Browser errors: ${errors.join('\n') || 'none'}. Screenshots: ${outputDir}`);
  throw error;
} finally {
  await fetch(new URL(`/json/close/${target.id}`,debugUrl)).catch(()=>{});
  socket.close();
}
