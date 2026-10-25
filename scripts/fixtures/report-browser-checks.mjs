import assert from 'node:assert/strict';
import { readdirSync,readFileSync } from 'node:fs';
export async function checkReportBrowser({evaluate,send,wait,saveScreenshot,errors,downloadDir}) {
 const check=async(e,m)=>assert.equal(await evaluate(e),true,m);
 const click=s=>evaluate(`document.querySelector(${JSON.stringify(s)}).click()`);
 const change=(s,v)=>evaluate(`(()=>{const i=document.querySelector(${JSON.stringify(s)});i.value=${JSON.stringify(v)};i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 const base='/projects/00000000-0000-0000-0000-000000000010';
 await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir,eventsEnabled:true});
 await click(`.app-sidebar a[href="${base}/dashboard"]`);await wait(`document.querySelector('.page-dashboard')?.getAttribute('aria-busy')==='false'`);
 await click('[data-export-pdf]');await wait(`document.activeElement?.id==='report-period'`);
 await check(`document.querySelector('#report-paper').value==='A4' && document.querySelectorAll('input[name="sections"]:checked').length===8`,'Default A4 and sections');
 await click('[data-cancel]');await wait(`!document.querySelector('.report-export-modal')`);await check(`!__boardMock.calls.some(c=>c.path==='project_statistics_report')`,'Cancel does not fetch or export');
 await click('[data-export-pdf]');await wait(`document.activeElement?.id==='report-period'`);
 await change('#report-period','custom');await change('#report-start','2026-10-25');await change('#report-end','2026-10-24');await click('[data-download]');
 await check(`!document.querySelector('.report-export-modal [data-error]').hidden && !__boardMock.calls.some(c=>c.path==='project_statistics_report')`,'Invalid custom range is blocked');
 await change('#report-start','2026-03-29');await change('#report-end','2026-03-29');
 await evaluate(`__boardMock.failReport=true;__boardMock.delayReport=200;document.querySelector('[data-download]').click();document.querySelector('[data-download]').click();`);
 await wait(`document.querySelector('.report-export-modal [data-error]')?.hidden===false && !document.querySelector('[data-download]').disabled`);
 await check(`__boardMock.calls.filter(c=>c.path==='project_statistics_report').length===1 && document.querySelector('#report-start').value==='2026-03-29'`,'Duplicate export prevented; failure preserves options');
 for(const theme of ['light','dark']){await evaluate(`TaskboardTheme.set('${theme}')`);await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await saveScreenshot(`report-options-${theme}-mobile.png`);await check(`document.querySelector('.report-export-modal .modal-footer').getBoundingClientRect().bottom<=innerHeight && document.documentElement.scrollWidth<=innerWidth`,'Report dialog fits mobile');}
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await evaluate(`__boardMock.failReport=false;__boardMock.delayReport=0;__boardMock.denyReportAccess=true`);await click('[data-download]');
 await wait(`document.querySelector('.report-export-modal [data-error]')?.textContent.includes('access changed')`);
 assert.equal(readdirSync(downloadDir).filter(f=>f.endsWith('.pdf')).length,0,'Revoked access blocks download');
 await evaluate(`__boardMock.denyReportAccess=false`);await click('[data-download]');
 await wait(`document.querySelector('.report-export-modal [data-progress-text]')?.textContent==='PDF downloaded.'`);
 let files=[];for(let n=0;n<50;n++){files=readdirSync(downloadDir).filter(f=>f.endsWith('.pdf'));if(files.length)break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(files.length,1);const bytes=readFileSync(`${downloadDir}/${files[0]}`);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>20000);assert.ok(files[0].startsWith('Проект-София-statistics-'));
 await check(`__boardMock.calls.filter(c=>c.path==='project_statistics_report').at(-1).body.p_project_id==='00000000-0000-0000-0000-000000000010' && __boardMock.calls.filter(c=>c.path==='project_statistics_report').at(-1).body.p_start==='2026-03-29'`,'Export has explicit project and custom period');
 await evaluate(`document.querySelectorAll('input[name="sections"]').forEach(i=>i.checked=['overview','findings'].includes(i.value));__boardMock.reportTitle='Section selection 工作计划';`);
 await change('#report-paper','LETTER');await click('[data-download]');await wait(`document.querySelector('[data-progress-text]').textContent==='PDF downloaded.' && !document.querySelector('[data-download]').disabled`);
 await click('[data-cancel]');await wait(`!document.querySelector('.report-export-modal')`);
 await click('[data-export-pdf]');await wait(`document.activeElement?.id==='report-period'`);await evaluate(`__boardMock.delayReport=1000`);await click('[data-download]');await click('[data-cancel]');
 await wait(`!document.querySelector('[data-download]').disabled && document.querySelector('[data-progress-text]').textContent.includes('cancelled')`);
 await click('[data-cancel]');await wait(`!document.querySelector('.report-export-modal')`);
 assert.deepEqual(errors,[]);console.log(`PASS: actual worker-generated PDF downloaded (${bytes.length} bytes), Unicode filename, export options/custom validation/sections, duplicate prevention, failure retry, late access denial, cancellation, project scope and mobile themes. PDF: ${downloadDir}/${files[0]}`);
}
