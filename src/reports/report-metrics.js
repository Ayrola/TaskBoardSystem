import { PRIORITIES, PRIORITY_META, taskPriority } from '../utils/priorities.js';
export const REPORT_SECTIONS = Object.freeze({ overview: 'Project Overview', distribution: 'Current Work Distribution', deadlines: 'Deadlines and Risk', workload: 'Workload', activity: 'Period Activity', flow: 'Flow Metrics and Limitations', register: 'Detailed Task Register', findings: 'Brief Findings' });
export const METRIC_DEFINITIONS = Object.freeze([
  'Current totals, stage/label distribution, deadlines, workload and the register describe retained tasks at generation time, not at the end of a past reporting period. Board filters never change report scope.',
  'Completed means tasks.done, which mirrors the selected stage’s is_done. Completion percentage is completed / retained tasks; empty projects show 0%.',
  'Period creation counts retained tasks by created_at. Deleted tasks are excluded from current counts and the register. Recorded creation/completion/stage events include deleted tasks while their project log is retained.',
  'Overdue means open with deadline before the snapshot. Due soon means open with deadline at or after the snapshot and before 168 hours later. NULL deadlines are counted separately.',
  'Priority is the saved Low/Medium/High/Urgent value; Medium is the default. Priority does not change deadlines, completion or overdue status.',
  'Labels and assignees are counted once per task per category. Multi-label and multi-assignee tasks contribute to each category; category sums may exceed unique tasks. Workload describes allocation, not employee productivity.',
  'Period boundaries are local midnight in the displayed timezone through the midnight after the inclusive end date, capped at generation time. Today is a partial day. Missing trend days are zero recorded observations.',
  'Completion events are recorded updated events with completed.from=false and completed.to=true. Reopenings are true-to-false transitions. Throughput counts distinct task IDs, using their first completion transition within the selected period; further completions are excluded. Reopened tasks still count as observed completions.',
  'Completion dates in the register are the latest recorded false-to-true completion while the task is currently done; otherwise they are unavailable. updated_at is never used as a completion date.',
  'History is limited to events actually captured after activity tracking was introduced; it is not a historical backlog or burndown. Cycle time is unavailable: no reliable work-start marker or agreed start-stage definition is stored.',
]);
export function dateInTimezone(value, timezone) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const field = name => parts.find(p => p.type === name).value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}
export function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value; }
export const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0,10);
export function validateReportOptions(options, now = new Date()) {
  if (!['7','30','90','custom'].includes(String(options.period))) throw new Error('Choose a reporting period.');
  if (!['A4','LETTER'].includes(options.paper)) throw new Error('Choose A4 or Letter paper.');
  if (!Array.isArray(options.sections) || !options.sections.length || options.sections.some(s => !REPORT_SECTIONS[s])) throw new Error('Select at least one report section.');
  if (typeof options.timezone !== 'string' || !options.timezone) throw new Error('Choose a valid timezone.');
  try { new Intl.DateTimeFormat('en', { timeZone: options.timezone }).format(now); } catch { throw new Error('Choose a valid timezone.'); }
  if (options.period === 'custom') {
    if (!validDate(options.start) || !validDate(options.end) || options.start > options.end || options.end > dateInTimezone(now, options.timezone) || (Date.parse(options.end)-Date.parse(options.start))/86400000 > 365) throw new Error('Choose 1–366 calendar days ending no later than today.');
  }
  return options;
}
export function calculateReportMetrics(data) {
  const { meta, project } = data;
  if (!project?.id || !meta?.as_of || !meta.start_date || !meta.end_date) throw new Error('Invalid report snapshot.');
  const tasks = data.tasks ?? [];
  if (tasks.some(t => t.project_id !== project.id) || new Set(tasks.map(t => t.id)).size !== tasks.length) throw new Error('Report contains invalid project task references.');
  const stages = new Map((data.stages ?? []).map(s => [s.id, { ...s, count: 0 }]));
  const labels = new Map((data.labels ?? []).map(l => [l.id, { ...l, count: 0 }]));
  const people = new Map((data.people ?? []).map(p => [p.user_id, { ...p, open: 0, completed: 0 }]));
  const now = Date.parse(meta.as_of), dueSoon = Date.parse(meta.due_soon_before);
  const start = Date.parse(meta.start_at), end = Date.parse(meta.end_exclusive);
  const inPeriod = value => Date.parse(value) >= start && Date.parse(value) < end;
  const pct = count => tasks.length ? Math.round(count / tasks.length * 1000)/10 : 0;
  const priorities=PRIORITIES.map(priority=>({priority,name:PRIORITY_META[priority].label,count:0,open:0}));
  const totals = { highOpen:0, urgentOpen:0, total: tasks.length, open: 0, completed: 0, overdue: 0, dueSoon: 0, noDeadline: 0, assignedOpen: 0, unassignedOpen: 0, unlabelled: 0 };
  const register = tasks.map(t => {
    const priority=taskPriority(t.priority),distribution=priorities.find(p=>p.priority===priority);distribution.count++;if(!t.done){distribution.open++;if(priority==='high')totals.highOpen++;if(priority==='urgent')totals.urgentOpen++;}
    const key = t.done ? 'completed' : 'open'; totals[key]++;
    if (!stages.has(t.stage_id)) stages.set(t.stage_id, { id: t.stage_id, name: 'Unavailable stage', position: Infinity, count: 0 });
    const stage = stages.get(t.stage_id); stage.count++;
    const assignmentIds = [...new Set(t.assignee_ids ?? [])];
    const labelIds = [...new Set(t.label_ids ?? [])];
    if (!labelIds.length) totals.unlabelled++;
    labelIds.forEach(id => { if (!labels.has(id)) labels.set(id,{id,name:'Unavailable label',count:0}); labels.get(id).count++; });
    assignmentIds.forEach(id => { if (!people.has(id)) people.set(id,{user_id:id,name:`Unavailable user ${id.slice(0,8)}`,open:0,completed:0}); people.get(id)[key]++; });
    const deadline = t.due_at ? Date.parse(t.due_at) : NaN;
    if (!t.done) {
      if (assignmentIds.length) totals.assignedOpen++; else totals.unassignedOpen++;
      if (!Number.isFinite(deadline)) totals.noDeadline++;
      else if (deadline < now) totals.overdue++;
      else if (deadline < dueSoon) totals.dueSoon++;
    }
    return { ...t, priority, priorityName:PRIORITY_META[priority].label, stageName: stage.name, assignees: assignmentIds.map(id => people.get(id).name), labels: labelIds.map(id => labels.get(id).name), overdue: !t.done && deadline < now, dueSoon: !t.done && deadline >= now && deadline < dueSoon, completed_at: t.done ? t.completed_at ?? null : null };
  });
  const periodDays = Math.round((Date.parse(meta.end_date)-Date.parse(meta.start_date))/86400000)+1;
  const weekly = periodDays > 90;
  const trend = [];
  const step = weekly ? 7 : 1;
  for (let offset=0; offset<periodDays; offset+=step) trend.push({ day: addDays(meta.start_date,offset), end: addDays(meta.start_date,Math.min(periodDays-1,offset+step-1)), created: 0, completionEvents: 0, throughput: 0, transitions: 0 });
  const bucket = timestamp => trend[Math.floor((Date.parse(dateInTimezone(timestamp,meta.timezone))-Date.parse(meta.start_date))/86400000/step)];
  tasks.filter(t=>inPeriod(t.created_at)).forEach(t=>{const b=bucket(t.created_at);if(b)b.created++;});
  const events = (data.events ?? []).filter(e=>inPeriod(e.created_at)).sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||(BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0));
  const completedIds = new Set(); let completionEvents=0,reopenings=0,transitions=0,creationEvents=0;
  events.forEach(e=>{
    const b=bucket(e.created_at);
    if(e.event_type==='created')creationEvents++;
    if(e.event_type==='updated' && e.completed?.from===false && e.completed?.to===true){completionEvents++;if(b)b.completionEvents++;if(!completedIds.has(e.task_id)){completedIds.add(e.task_id);if(b)b.throughput++;}}
    if(e.event_type==='updated' && e.completed?.from===true && e.completed?.to===false)reopenings++;
    if(e.event_type==='updated' && e.stage?.from_id && e.stage?.to_id && e.stage.from_id!==e.stage.to_id){transitions++;if(b)b.transitions++;}
  });
  const overdue = register.filter(t=>t.overdue).sort((a,b)=>Date.parse(a.due_at)-Date.parse(b.due_at)||a.id.localeCompare(b.id));
  const noun = count => count === 1 ? 'task' : 'tasks';
  const findings = tasks.length ? [`${totals.unassignedOpen} open ${noun(totals.unassignedOpen)} ${totals.unassignedOpen===1?'has':'have'} no assignee.`,`${totals.noDeadline} open ${noun(totals.noDeadline)} ${totals.noDeadline===1?'has':'have'} no deadline.`,`${totals.overdue} open ${noun(totals.overdue)} ${totals.overdue===1?'is':'are'} overdue; ${totals.dueSoon} ${totals.dueSoon===1?'is':'are'} due within the next 168 hours.`] : ['No current tasks exist in this project.'];
  const overdueByStage = new Map();overdue.forEach(t=>overdueByStage.set(t.stageName,(overdueByStage.get(t.stageName)??0)+1));
  [...overdueByStage].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).forEach(([name,count])=>findings.push(`${count} overdue ${noun(count)} ${count===1?'is':'are'} in ${name}.`));
  return { project, meta, priorities:priorities.map(p=>({...p,percentage:pct(p.count)})), totals: { ...totals, completion: pct(totals.completed) }, stageCount: data.stages?.length ?? 0, stages:[...stages.values()].sort((a,b)=>a.position-b.position||String(a.id).localeCompare(String(b.id))).map(s=>({...s,percentage:pct(s.count)})), labels:[...labels.values()].map(l=>({...l,percentage:pct(l.count)})), people:[...people.values()].filter(p=>p.open+p.completed>0).sort((a,b)=>a.name.localeCompare(b.name)||a.user_id.localeCompare(b.user_id)), register, overdue, period: { created:trend.reduce((n,b)=>n+b.created,0),creationEvents,completionEvents,reopenings,transitions,throughput:completedIds.size,weekly,trend,recordedEvents:events.length }, findings, definitions: METRIC_DEFINITIONS };
}
export function reportFilename(title, date) { return `${String(title ?? 'project').normalize('NFKC').replace(/[^\p{L}\p{N}\s_-]/gu,'').trim().replace(/[\s_]+/g,'-').slice(0,80)||'project'}-statistics-${date}.pdf`; }
