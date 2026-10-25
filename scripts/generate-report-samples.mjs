import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {calculateReportMetrics,REPORT_SECTIONS} from '../src/reports/report-metrics.js';
import {buildPdfDocument} from '../src/reports/pdf-document.js';
import {renderPdfBuffer} from '../src/reports/pdf-engine.js';
import {reportFixture} from './fixtures/report-fixture.mjs';
const directory=process.env.REPORT_SAMPLE_DIR??'/tmp/taskboard-report-samples';mkdirSync(directory,{recursive:true});
const options={paper:'A4',sections:Object.keys(REPORT_SECTIONS)};
for(const [name,fixture] of [['empty',{count:0}],['all-open',{allOpen:true}],['all-completed',{allDone:true}],['custom-stages-and-risk',{}],['no-history',{history:false}],['large-bulgarian',{count:1205}],['cjk-and-bulgarian',{cjk:true}],['custom-weekly-period',{custom:true}],['missing-optionals',{missing:true}],['long-relations',{relations:true}],['priorities',{priorities:true}]]){
 const snapshot=reportFixture(fixture);
 if(fixture.custom){snapshot.meta.start_date='2026-01-01';snapshot.meta.start_at='2025-12-31T22:00:00Z';}
 if(fixture.missing){snapshot.labels=[];snapshot.people=[];snapshot.events=[];snapshot.tasks.forEach(t=>Object.assign(t,{assignee_ids:[],label_ids:[],due_at:null,completed_at:null}));}
 if(fixture.relations){snapshot.people=Array.from({length:30},(_,i)=>({user_id:`person-${i}`,name:`Член ${i} — Дълго име за проверка на пълния списък`}));snapshot.tasks[0].assignee_ids=snapshot.people.map(p=>p.user_id);}
 if(fixture.priorities)snapshot.tasks.forEach((t,i)=>t.priority=['low','medium','high','urgent'][i%4]);
 const metrics=calculateReportMetrics(snapshot);
 const buffer=await renderPdfBuffer(buildPdfDocument(metrics,options),fixture.cjk?{cjkFont:readFileSync(new URL('../public/fonts/NotoSansCJKsc-Regular.otf',import.meta.url))}:{});
 if(Buffer.from(buffer).subarray(0,5).toString()!=='%PDF-')throw Error('Invalid PDF');
 writeFileSync(`${directory}/${name}.pdf`,buffer);console.log(`${name}: ${buffer.length} bytes`);
}
console.log(`Samples: ${directory}`);
