import assert from 'node:assert/strict';
import {calculateReportMetrics,REPORT_SECTIONS,validateReportOptions,dateInTimezone,reportFilename} from '../src/reports/report-metrics.js';
import {reportFixture} from './fixtures/report-fixture.mjs';
const normal=calculateReportMetrics(reportFixture());
assert.deepEqual(normal.totals,{total:8,open:5,completed:3,overdue:2,dueSoon:2,noDeadline:1,assignedOpen:3,unassignedOpen:2,unlabelled:4,completion:37.5});
assert.equal(normal.period.completionEvents,2);assert.equal(normal.period.throughput,1);assert.equal(normal.period.reopenings,1);assert.equal(normal.period.transitions,3);assert.equal(normal.period.creationEvents,1);assert.equal(normal.period.created,7);
assert.equal(normal.period.trend.length,7);assert.equal(normal.period.trend.find(d=>d.day==='2026-10-24').throughput,1);
assert.equal(normal.people[0].open+normal.people[1].open,6,'Multi-assignee work is explicit, not a unique-task total');
assert.equal(normal.labels.reduce((n,l)=>n+l.count,0),8);assert.equal(normal.totals.unlabelled,4);
assert.equal(calculateReportMetrics(reportFixture({count:1205})).totals.total,1205);
for(const option of [{count:0},{allDone:true},{allOpen:true},{history:false}]){
 const m=calculateReportMetrics(reportFixture(option));assert.ok(Number.isFinite(m.totals.completion));
 if(option.count===0){assert.equal(m.totals.completion,0);assert.equal(m.people.length,0);}
 if(option.allDone)assert.equal(m.totals.open,0);
 if(option.allOpen)assert.equal(m.totals.completed,0);
 if(option.history===false)assert.equal(m.period.completionEvents,0);
}
const duplicated=reportFixture();duplicated.tasks[1].assignee_ids.push(...duplicated.tasks[1].assignee_ids);assert.deepEqual(calculateReportMetrics(duplicated).totals,normal.totals);
const foreign=reportFixture();foreign.tasks[0].project_id='other';assert.throws(()=>calculateReportMetrics(foreign),/project/);
const options={period:'custom',paper:'A4',sections:Object.keys(REPORT_SECTIONS),timezone:'Europe/Sofia',start:'2026-10-25',end:'2026-10-25'};
assert.ok(validateReportOptions(options,new Date('2026-10-25T12:00:00Z')));
for(const changes of [{start:'2026-02-30'},{start:'2026-10-26'},{end:'2026-10-26'},{sections:[]},{timezone:'Bad/Zone'},{start:'2020-01-01'}])assert.throws(()=>validateReportOptions({...options,...changes},new Date('2026-10-25T12:00:00Z')));
assert.equal(dateInTimezone('2026-10-24T21:30:00Z','Europe/Sofia'),'2026-10-25');
assert.equal(dateInTimezone('2026-10-25T22:30:00Z','Europe/Sofia'),'2026-10-26','DST boundary uses actual IANA offset');
const weekly=reportFixture();weekly.meta.start_date='2026-01-01';weekly.meta.start_at='2025-12-31T22:00:00Z';assert.equal(calculateReportMetrics(weekly).period.weekly,true);
assert.ok(!reportFilename('../Проект / demo','2026-10-25').includes('/'));
console.log('PASS: retained/current metrics, 1205 tasks, assignment/label deduplication, custom stages, deadlines, history/reopen/repeated completion rules, project isolation, zero/all-open/all-done, date validation and DST boundaries.');
