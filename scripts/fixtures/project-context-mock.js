(() => {
 const mock=window.__boardMock,id=mock.id;
 const other={id:id(20),title:'Research lab',description:'A separate member project',owner_id:id(99),is_owner:false,can_manage:false};
 const first={id:id(10),title:'Product workspace',description:'Product plans',owner_id:mock.user.id,is_owner:true,can_manage:true};
 mock.contextProjects=[first,other];
 mock.otherStages=[{id:id(21),name:'Research',position:0,is_done:false}];
 mock.otherTasks=[{...mock.tasks[1],id:id(800),project_id:other.id,stage_id:id(21),title:'Research interviews',description:'Only in Research lab',due_at:'2020-01-01T12:00:00Z',position:0,task_labels:[]}];
 const respond=(data,headers={})=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json',...headers}});
 window.__contextFetch=async({url,path,body,init})=>{
  const projectId=url.searchParams.get('project_id')?.slice(3)??body.p_project_id;
  if(path==='projects'){
   const target=url.searchParams.get('id')?.slice(3);
   if(mock.delayProject===target)await new Promise(r=>setTimeout(r,500));
   return respond(mock.contextProjects.find(p=>p.id===target)??null);
  }
  if(path==='is_admin')return respond(mock.contextAdmin??false);
  if(path==='list_projects_page')return respond({total:mock.contextProjects.length,rows:mock.contextProjects.slice(body.p_offset,body.p_offset+body.p_limit)});
  if(path==='browse_projects_page')return respond({total:mock.contextProjects.length,accessible_total:mock.contextProjects.length,rows:mock.contextProjects.map(p=>({...p,open_tasks:0,done_tasks:0,stage_count:1,created_at:'2026-01-01T12:00:00Z'}))});
  if(path==='tasks' && init.method==='HEAD'){
   const list=[...mock.tasks,...mock.otherTasks].filter(t=>t.project_id===projectId&&(!url.searchParams.has('done')||t.done===(url.searchParams.get('done')==='eq.true')));
   return new Response(null,{status:200,headers:{'content-range':`0-0/${list.length}`}});
  }
  if(path==='project_stages'){
   const rows=projectId===other.id?mock.otherStages:mock.stages;
   if(init.method==='HEAD')return new Response(null,{status:200,headers:{'content-range':`0-0/${rows.length}`}});
   return respond(rows);
  }
  if(path==='board_stage_counts'&&projectId===other.id)return respond(mock.otherStages.map(s=>({stage_id:s.id,task_count:mock.otherTasks.filter(t=>t.stage_id===s.id).length})));
  if(path==='project_labels'){
   const labels=projectId===other.id?[{id:id(32),project_id:other.id,name:'Research only',colour:'#def4d8',task_labels:[{count:1}]}]:[{id:id(31),project_id:first.id,name:'Product',colour:'#dce9ff',task_labels:[{count:15}]}];
   if(mock.delayLabels===projectId)await new Promise(r=>setTimeout(r,500));
   const labelId=url.searchParams.get('id')?.slice(3);
   return respond(labelId?labels.find(l=>l.id===labelId)??null:mock.emptyLabels===projectId?[]:labels);
  }
  if(path==='tasks'&&(projectId===other.id||url.searchParams.get('select')?.includes('projects(title)'))){
   let rows=[...mock.tasks,...mock.otherTasks].filter(t=>t.project_id===projectId);
   if(url.searchParams.has('done'))rows=rows.filter(t=>t.done===(url.searchParams.get('done')==='eq.true'));
   if(url.searchParams.has('id'))return respond(rows.find(t=>t.id===url.searchParams.get('id').slice(3))??null);
   const total=rows.length,offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??50);
   rows=rows.slice(offset,offset+limit).map(t=>({...t,projects:{title:projectId===other.id?other.title:first.title},project_stages:{name:'Research'}}));
   return respond(rows,{'content-range':`${offset}-${offset+rows.length-1}/${total}`});
  }
  if(path==='label_tasks_page'){
   const isOther=body.p_label_id===id(32),rows=isOther?mock.otherTasks:mock.tasks.filter(t=>t.task_labels.length);
   return respond({rows:rows.slice(body.p_offset,body.p_offset+body.p_limit),total:rows.length});
  }
  if(path==='deadlines_page'){
   const now=Date.now(),start=Date.parse('2026-10-25T00:00:00Z'),end=Date.parse('2026-10-26T00:00:00Z');
   const rows=(projectId===other.id?mock.otherTasks:mock.tasks).filter(t=>t.due_at&&!t.done).filter(t=>body.p_bucket==='overdue'?Date.parse(t.due_at)<now:body.p_bucket==='today'?Date.parse(t.due_at)>=start&&Date.parse(t.due_at)<end:Date.parse(t.due_at)>=end).map(t=>({...t,project_title:projectId===other.id?other.title:first.title,overdue:Date.parse(t.due_at)<now}));
   return respond({rows:rows.slice(body.p_offset,body.p_offset+body.p_limit),total:rows.length,day_start:'2026-10-25T00:00:00Z',day_end:'2026-10-26T00:00:00Z'});
  }
  if(path==='task_activity_page'){
   const task=projectId===other.id?mock.otherTasks[0]:mock.tasks[0];
   const rows=mock.emptyActivity===projectId?[]:[{id:'1',project_id:projectId,project_title:projectId===other.id?other.title:first.title,task_id:task.id,task_title:task.title,task_exists:true,event_type:'created',actor_id:null,created_at:'2026-10-25T12:00:00Z',changes:{}}];
   return respond({rows:body.p_task_id&&body.p_task_id!==task.id?[]:rows,total:body.p_task_id&&body.p_task_id!==task.id?0:rows.length,snapshot_id:'1'});
  }
 };
})();
