import { REPORT_SECTIONS, dateInTimezone } from './report-metrics.js';
const blue='#334d99',ink='#203047',muted='#536175',line='#dde3eb';
export const needsCjkFont = value => /[\u2e80-\u9fff\uf900-\ufaff\uac00-\ud7af\u3040-\u30ff]/u.test(JSON.stringify(value));
export function applyFontFallback(node) {
  if(Array.isArray(node)){node.forEach(applyFontFallback);return node;}
  if(node&&typeof node==='object'){
    if(node.table?.body)node.table.body=node.table.body.map(row=>row.map(cell=>typeof cell==='string'||typeof cell==='number'?{text:String(cell)}:cell));
    if(typeof node.text==='string' && node.font!=='NotoCJK' && needsCjkFont(node.text))node.text=node.text.split(/([\u2e80-\u9fff\uf900-\ufaff\uac00-\ud7af\u3040-\u30ff]+)/u).filter(Boolean).map(text=>({text,...(needsCjkFont(text)?{font:'NotoCJK'}:{})}));
    Object.values(node).forEach(value=>{if(value&&typeof value==='object')applyFontFallback(value);});
  }
  return node;
}
export function buildPdfDocument(m, options) {
  const selected=new Set(options.sections),content=[],appendix=new Map();
  const formatted = value => value ? new Intl.DateTimeFormat('en-GB',{timeZone:m.meta.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : 'Not recorded';
  const para=(text,extra={})=>({text,margin:[0,0,0,9],...extra});
  const note=text=>para(text,{fontSize:8,color:muted});
  const heading=key=>({text:REPORT_SECTIONS[key],style:'h1',headlineLevel:1});
  const table=(headers,rows,widths,extra={})=>({table:{headerRows:1,keepWithHeaderRows:1,dontBreakRows:true,widths,body:[headers.map(text=>({text,bold:true,color:blue,fillColor:'#edf1f8'})),...rows]},layout:{hLineWidth:()=>0.5,vLineWidth:()=>0,hLineColor:()=>line,paddingLeft:()=>6,paddingRight:()=>6,paddingTop:()=>7,paddingBottom:()=>7},fontSize:8,margin:[0,0,0,14],...extra});
  const bounded=(task,kind)=>{
    const names=task[kind],joined=names.join(', ')|| (kind==='assignees'?'Unassigned':'Unlabelled');
    if(joined.length<=300)return joined;
    appendix.set(`${task.id}:${kind}`,{task,kind,names});
    return `${joined.slice(0,260)}…\nFull ${kind} in relation appendix (${names.length}).`;
  };
  const bars=(rows,total)=>table(['Category','Distribution','Tasks / share'],rows.map(row=>[
    row.name,{canvas:[{type:'rect',x:0,y:4,w:130,h:8,color:'#e9edf5'},{type:'rect',x:0,y:4,w:total?Math.max(0,Math.min(130,row.count/total*130)):0,h:8,color:blue}],margin:[0,3,0,0]},`${row.count} / ${row.percentage??(total?Math.round(row.count/total*1000)/10:0)}%`
  ]),['*',140,82]);
  content.push(para('TASKBOARD  /  PROJECT STATISTICS',{color:blue,fontSize:9,bold:true,characterSpacing:1}),para(m.project.title,{fontSize:24,bold:true,color:ink,margin:[0,5,0,12]}));
  content.push(note(`Reporting period: ${m.meta.start_date} to ${m.meta.end_date} (inclusive calendar dates)\nGenerated: ${formatted(m.meta.as_of)} · ${m.meta.timezone}`));
  content.push(para('Current metrics describe the project at generation time. The selected period applies only to creation and recorded activity/throughput. This report does not reconstruct past project snapshots.',{fontSize:9,color:muted,margin:[0,0,0,18]}));
  if(selected.has('overview')){
    content.push(heading('overview'),...((m.project.description||'No project description provided.').match(/[\s\S]{1,1000}/g)||[]).map(part=>para(part)));
    content.push(table(['Total tasks','Open','Completed','Completion'],[[m.totals.total,m.totals.open,m.totals.completed,`${m.totals.completion}%`]],['*','*','*','*']));
    content.push(para(`${m.stageCount} ${m.stageCount===1?'stage':'stages'} · ${m.people.length} ${m.people.length===1?'person':'people'} assigned to current tasks. This is an assignment summary, not the complete project membership roster.`));
    if(!m.totals.total)content.push(note('No current tasks. Progress is neutral; percentages are 0%.'));
  }
  if(selected.has('distribution')){
    content.push(heading('distribution'),note('All current retained tasks. Stage order follows the project configuration.'));
    if(m.stages.length)content.push(m.totals.total?bars(m.stages,m.totals.total):table(['Stage','Tasks','Share'],m.stages.map(s=>[s.name,0,'0%']),['*',80,80]));else content.push(para('No stages yet.'));
    content.push(para('Labels',{style:'h2'}),note('Multi-label tasks appear in each label category; category sums may exceed the number of unique tasks.'));
    content.push(m.totals.total?bars([...m.labels,{name:'Unlabelled',count:m.totals.unlabelled}],m.totals.total):para('No current tasks; no label distribution chart is drawn.'));
    content.push(note('Priority distribution is unavailable: this application does not store task priorities.'));
  }
  if(selected.has('deadlines')){
    content.push(heading('deadlines'),table(['Overdue open','Due soon','Open without deadline'],[[m.totals.overdue,m.totals.dueSoon,m.totals.noDeadline]],['*','*','*']),note(`Due soon: snapshot through, but excluding, ${formatted(m.meta.due_soon_before)} (next 168 hours). Completed tasks are excluded.`));
    if(m.overdue.length)content.push(table(['Overdue task','Stage','Assignees','Deadline'],m.overdue.map(t=>[t.title,t.stageName,bounded(t,'assignees'),formatted(t.due_at)]),['*',64,100,86]));else content.push(para('No overdue open work.'));
  }
  if(selected.has('workload')){
    content.push(heading('workload'),para(`${m.totals.assignedOpen} assigned open tasks · ${m.totals.unassignedOpen} unassigned open tasks.`),note('Each task is counted for every assigned person. These figures describe work allocation, not employee productivity. People are listed alphabetically.'));
    content.push(table(['Assignee','Open tasks','Completed tasks'],[...m.people.map(p=>[p.name,p.open,p.completed]),['Unassigned',m.totals.unassignedOpen,m.register.filter(t=>t.done&&!t.assignees.length).length]],['*',90,100]));
  }
  if(selected.has('activity')){
    content.push(heading('activity'),table(['Retained tasks created','Recorded creation events','Completion transitions','Stage transitions','Reopenings'],[[m.period.created,m.period.creationEvents,m.period.completionEvents,m.period.transitions,m.period.reopenings]],['*','*','*','*','*']));
    content.push(note('Retained task creation matches the dashboard definition. Recorded log events can include subsequently deleted tasks. Counts are observations in the selected period, not complete historical coverage.'));
    content.push(para(`${m.period.weekly?'Weekly':'Daily'} task creation and observed transitions`,{style:'h2'}),note('Zero means no retained creations or recorded transitions in that bucket.'));
    const max=Math.max(1,...m.period.trend.map(b=>b.created));
    content.push(table(['Period','Retained creations','Creation trend','Completion events','Stage transitions'],m.period.trend.map(b=>[m.period.weekly?`${b.day} – ${b.end}`:b.day,b.created,{canvas:[{type:'rect',x:0,y:3,w:Math.max(0,b.created/max*85),h:7,color:blue}]},b.completionEvents,b.transitions]),[m.period.weekly?90:65,70,'*',70,65]));
  }
  if(selected.has('flow')){
    content.push(heading('flow'),para(`Recorded completed-task throughput: ${m.period.throughput} distinct tasks.`),note('A task contributes at its first recorded false-to-true completion transition within the selected period. Further completions of that task in the period are excluded. A later reopening does not erase an observed completion. Tasks created already done are not completion transitions.'));
    if(m.period.throughput)content.push(table([m.period.weekly?'Week beginning':'Day','Distinct tasks completed'],m.period.trend.map(b=>[b.day,b.throughput]),['*',130]));else content.push(para('No completion transitions were recorded in this period. This does not prove that no work was completed before tracking existed.'));
    content.push(para('Cycle time, median and percentile: unavailable.',{bold:true}),note('There is no reliable work-start marker or agreed start-stage definition in the stored history. Creation-to-completion would mix waiting time with work and is not presented as cycle time. Historical backlog, burndown and velocity are unavailable.'));
  }
  if(selected.has('register')){
    content.push(heading('register'),note('All current retained tasks, ordered by creation timestamp then ID. Completion dates are recorded transitions only; currently reopened tasks show no current completion date.'));
    if(m.register.length)content.push(table(['Task / reference','Stage / state','Assignees','Labels','Dates'],m.register.map(t=>[
      {text:[{text:t.title,bold:true},`\n${t.id.slice(-8)}`]},`${t.stageName}\n${t.done?'Completed':'Open'}`,bounded(t,'assignees'),bounded(t,'labels'),`Created: ${formatted(t.created_at)}\nDue: ${t.due_at?formatted(t.due_at):'No deadline'}\nCompleted: ${formatted(t.completed_at)}`
    ]),['*',64,84,76,112],{fontSize:7.5}));else content.push(para('No retained tasks to list.'));
  }
  if(selected.has('findings')){content.push(heading('findings'),...m.findings.map(text=>para(`• ${text}`)));}
  if(appendix.size){content.push({text:'Relation appendix',style:'h1',headlineLevel:1},note('Full assignee/label lists for task cells abbreviated to keep each task row on one page.'));content.push(table(['Task reference','Relation','Name'],[...appendix.values()].flatMap(({task,kind,names})=>names.map(name=>[task.id.slice(-8),kind,name])),[90,70,'*']));}
  content.push({text:'Metric definitions and data coverage',style:'h1',headlineLevel:1,pageBreak:'before'},...m.definitions.map(note));
  // Keep each heading with its first short paragraph or summary table.
  // Long data tables remain independently paginated with repeated headings.
  const grouped=[];
  for(let i=0;i<content.length;i++){
    if((content[i].headlineLevel===1 || content[i].style==='h2') && content[i+1]){
      const headingNode=content[i],first=content[++i];
      const pageBreak=headingNode.pageBreak;delete headingNode.pageBreak;
      grouped.push({stack:[headingNode,first],unbreakable:true,...(pageBreak?{pageBreak}:{})});
    }else grouped.push(content[i]);
  }
  const doc={
    pageSize:options.paper,pageMargins:[36,40,36,42],info:{title:`${m.project.title} — Project statistics`,author:'Taskboard',subject:'Authenticated project statistics'},
    defaultStyle:{font:'Roboto',fontSize:9,color:ink,lineHeight:1.2},
    styles:{h1:{fontSize:15,bold:true,color:blue,margin:[0,18,0,10]},h2:{fontSize:11,bold:true,color:ink,margin:[0,8,0,8]}},
    content:grouped,
    footer:(page,pages)=>({columns:[{text:'Taskboard · Project statistics',alignment:'left'},{text:`Page ${page} of ${pages}`,alignment:'right'}],fontSize:8,color:muted,margin:[36,12,36,0]}),
    pageBreakBefore:(currentNode,nodeContainer)=>currentNode.headlineLevel===1 && nodeContainer.getFollowingNodesOnPage().length===0,
  };
  return applyFontFallback(doc);
}
