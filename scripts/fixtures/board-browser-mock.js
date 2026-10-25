// Synthetic data and network stubs for the isolated board browser checks.
(() => {
  const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  const user={id:id(1),email:'preview@example.test',aud:'authenticated',role:'authenticated',user_metadata:{},app_metadata:{}};
  const token='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.'+btoa(JSON.stringify({sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+86400}))+'.preview';
  localStorage.setItem(`sb-${window.__boardPreview.ref}-auth-token`,JSON.stringify({access_token:token,refresh_token:'preview',expires_at:Math.floor(Date.now()/1000)+86400,expires_in:86400,token_type:'bearer',user}));
  const stages=[{id:id(11),name:'Backlog',position:0,is_done:false},{id:id(12),name:'In progress',position:1,is_done:false},{id:id(13),name:'Review',position:2,is_done:false},{id:id(14),name:'Complete',position:3,is_done:true}];
  const storedStages=sessionStorage.getItem('taskboard-stages-fixture');
  if(storedStages)stages.splice(0,stages.length,...JSON.parse(storedStages));
  const names=['Design the onboarding flow','Improve dashboard performance','Review project permissions','Polish responsive navigation','Write release notes','Audit keyboard interaction','Simplify account settings','Prepare the next milestone'];
  const tasks=Array.from({length:58},(_,i)=>({id:id(100+i),project_id:id(10),stage_id:id(11),title:i===57?'Needle task beyond the first page':names[i%names.length]+(i>7?` ${i+1}`:''),description:i===0?'<p>Map the first-run experience and make every step feel clear.</p>':i===1?'<p>Long description with &amp; safe content. '+ 'A clear, readable preview. '.repeat(30)+'</p>':i%3===0?'<p>Ship a focused improvement with clear acceptance criteria.</p>':'',position:i,done:false,priority:'medium',due_at:i===0?'2020-01-01T12:00:00Z':null,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),task_labels:i%4===0?[{project_labels:{id:id(31),name:'Product',colour:'#dce9ff'}}]:[],task_attachments:[{count:i===0?2:0}],task_comments:[{count:i===0?3:0}]}));
  tasks.push(...[0,1,2].map((i)=>({...tasks[i],id:id(200+i),stage_id:i===2?id(14):id(12),position:i===2?0:i,done:i===2,title:['Build the shared design system','Accessibility review','Launch project workspace'][i]})));
  const stored=sessionStorage.getItem('taskboard-browser-fixture');
  if(stored)tasks.splice(0,tasks.length,...JSON.parse(stored));
  const persist=()=>sessionStorage.setItem('taskboard-browser-fixture',JSON.stringify(tasks));
  window.__boardMock={tasks,stages,id,user,failSave:false,failMove:false,failBoard:false,denied:false,member:false,calls:[]};
  Object.assign(window.__boardMock,JSON.parse(sessionStorage.getItem('taskboard-form-fixture')??'{}'));
  const persistForm=()=>sessionStorage.setItem('taskboard-form-fixture',JSON.stringify({formLabels:window.__boardMock.formLabels??{},formAssignees:window.__boardMock.formAssignees??{},formChecklists:window.__boardMock.formChecklists??{},formReceipts:window.__boardMock.formReceipts??{}}));
  const nativeFetch=window.fetch;
  window.fetch=async(input,init={})=>{
    const raw=typeof input==='string'?input:input.url;
    if(new URL(raw,location.href).host!==window.__boardPreview.host) return nativeFetch(input,init);
    const url=new URL(raw);const path=url.pathname.split('/').at(-1); const body=init.body?JSON.parse(init.body):{};const mock=window.__boardMock;
    mock.calls.push({path,body,url:url.search});
    const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','Access-Control-Allow-Origin':'*'}});
    if (window.__contextFetch) { const response = await window.__contextFetch({ url, path, body, init }); if (response) return response; }
    if(url.pathname.includes('/auth/')) return respond(path==='user'?user:{user});
    if (init.method === 'HEAD' && ['tasks','project_stages'].includes(path)) {
      if(mock.failDashboard)return respond({message:'Preview failure'},500);
      if(mock.delayDashboard)await new Promise(r=>setTimeout(r,mock.delayDashboard));
      const count=mock.zeroDashboard?0:path==='project_stages'?stages.length:tasks.filter(t=>t.project_id===url.searchParams.get('project_id')?.slice(3)&&(!url.searchParams.has('done')||t.done===(url.searchParams.get('done')==='eq.true'))).length;
      return new Response(null,{status:200,headers:{'content-range':`0-0/${count}`}});
    }
    if(path==='get_dashboard_stats'){if(mock.failDashboard)return respond({message:'Preview failure'},500);if(mock.delayDashboard)await new Promise(r=>setTimeout(r,mock.delayDashboard));return respond({project_count:mock.zeroDashboard?0:1,total_tasks:mock.zeroDashboard?0:tasks.length,open_tasks:mock.zeroDashboard?0:tasks.filter(t=>!t.done).length,done_tasks:mock.zeroDashboard?0:tasks.filter(t=>t.done).length});}
    if(path==='projects' && url.searchParams.get('select')==='id,title')return respond(mock.zeroDashboard?[]:[{id:id(10),title:'Product workspace'}]);
    if(path==='tasks' && url.searchParams.get('select')?.includes('projects(title)')){
      if(mock.failTaskList)return respond({message:'Preview failure'},500);
      let list=mock.zeroDashboard?[]:tasks.filter(t=>(!url.searchParams.has('done')||t.done===(url.searchParams.get('done')==='eq.true'))&&(!url.searchParams.has('project_id')||t.project_id===url.searchParams.get('project_id').slice(3)));
      const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??20),total=list.length;
      return new Response(JSON.stringify(list.slice(offset,offset+limit).map(t=>({...t,projects:{title:'Product workspace'},project_stages:{name:stages.find(s=>s.id===t.stage_id).name}}))),{status:200,headers:{'content-type':'application/json','content-range':`${offset}-${Math.min(offset+limit,total)-1}/${total}`}});
    }
    if(path==='can_access_project')return respond(mock.denyReportAccess?false:true);
    if(path==='project_statistics_report'){
      if(mock.delayReport)await new Promise(r=>setTimeout(r,mock.delayReport));
      if(mock.failReport)return respond({message:'Preview report failure'},500);
      if(mock.denyReport)return respond({code:'P0002',message:'Project not found'},404);
      const now=new Date(),today=new Intl.DateTimeFormat('en-CA',{timeZone:body.p_timezone}).format(now);
      const start=body.p_start??new Date(Date.parse(today+'T12:00:00Z')-(body.p_days-1)*86400000).toISOString().slice(0,10);
      const end=body.p_end??today;
      return respond({project:{id:mock.mismatchReport?id(20):body.p_project_id,title:mock.reportTitle??'Проект София',description:'Статистика на проекта — Client-side PDF report.'},meta:{as_of:now.toISOString(),timezone:body.p_timezone,start_date:start,end_date:end,start_at:start+'T00:00:00Z',end_exclusive:now.toISOString(),due_soon_before:new Date(now.getTime()+168*3600000).toISOString()},stages,labels:[{id:id(31),name:'Product',colour:'#4488aa'}],people:[{user_id:id(1),name:'Ивелина'}],tasks:(mock.zeroReport?[]:tasks).map(t=>({...t,assignee_ids:[],label_ids:t.task_labels.map(l=>l.project_labels.id),completed_at:null})),events:[]});
    }
    if(path==='project_dashboard'){
      if(mock.delayDashboard)await new Promise(r=>setTimeout(r,mock.delayDashboard));
      if(mock.failDashboard)return respond({message:'Preview dashboard failure'},500);
      if(mock.denied)return respond({code:'P0002',message:'Project not found'},404);
      const all=body.p_project_id===id(20)?mock.otherTasks??[]:tasks;
      const projectStages=body.p_project_id===id(20)?mock.otherStages??[]:stages;
      const list=mock.zeroDashboard?[]:all;
      const now=new Date(),open=list.filter(t=>!t.done);
      const assignments=t=>mock.formAssignees?.[t.id]??[];
      const people=new Map();for(const task of open)for(const person of assignments(task)){const row=people.get(person.user_id)??{user_id:person.user_id,label:person.label??'Unavailable person',count:0};row.count++;people.set(person.user_id,row);}
      const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:body.p_timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
      const today=day(now),midnight=new Date(today+'T12:00:00Z');
      const creation=Array.from({length:body.p_days},(_,i)=>{const d=new Date(midnight);d.setUTCDate(d.getUTCDate()-body.p_days+1+i);const key=d.toISOString().slice(0,10);return {day:key,count:list.filter(t=>day(new Date(t.created_at))===key&&Date.parse(t.created_at)<=now).length};});
      const due=open.filter(t=>t.due_at).sort((a,b)=>a.due_at.localeCompare(b.due_at)||a.id.localeCompare(b.id));
      return respond({as_of:now.toISOString(),timezone:body.p_timezone,days:body.p_days,totals:{total:list.length,open:open.length,completed:list.length-open.length,high_open:open.filter(t=>t.priority==='high').length,urgent_open:open.filter(t=>t.priority==='urgent').length,overdue:open.filter(t=>t.due_at&&new Date(t.due_at)<now).length,unassigned:open.filter(t=>!assignments(t).length).length},priorities:['low','medium','high','urgent'].map(priority=>({priority,count:list.filter(t=>(t.priority??'medium')===priority).length,open_count:open.filter(t=>(t.priority??'medium')===priority).length})),stages:projectStages.map(s=>({...s,count:list.filter(t=>t.stage_id===s.id).length})),creation,workload:[...people.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label)),deadlines:{overdue:due.filter(t=>new Date(t.due_at)<now).slice(0,5),upcoming:due.filter(t=>new Date(t.due_at)>=now).slice(0,5)},activity:mock.zeroDashboard?[]:mock.dashboardActivity??[{id:'1',task_id:list[0]?.id,task_title:list[0]?.title??'Deleted task',task_exists:!!list[0],event_type:'created',changes:{},created_at:now.toISOString()}]});
    }
    if(path==='is_admin')return respond(mock.admin??false);
    if(path==='browse_projects_page'){
      if(mock.failProjects)return respond({message:'Preview failure'},500);
      const all=mock.projectBrowserProjects??[{id:id(10),title:'Product workspace',description:'A focused workspace',stage_count:4,open_tasks:60,done_tasks:1,is_owner:!mock.member,is_member:mock.member,can_manage:!mock.member,created_at:'2026-10-01T12:00:00Z',updated_at:'2026-10-23T12:00:00Z'}];
      const needle=(body.p_search??'').toLowerCase();
      const filtered=all.filter(p=>(p.title.toLowerCase().includes(needle)||(p.description??'').toLowerCase().includes(needle))&&(!body.p_role||body.p_role==='all'||body.p_role==='owned'&&p.is_owner||body.p_role==='member'&&p.is_member));
      filtered.sort((a,b)=>body.p_sort==='name'?a.title.toLowerCase().localeCompare(b.title.toLowerCase())||a.id.localeCompare(b.id):String(b[body.p_sort==='updated'?'updated_at':'created_at']).localeCompare(String(a[body.p_sort==='updated'?'updated_at':'created_at']))||a.id.localeCompare(b.id));
      return respond({accessible_total:all.length,total:filtered.length,rows:filtered.slice(body.p_offset,body.p_offset+body.p_limit)});
    }
    if(path==='list_projects_page'){ if(mock.failProjects)return respond({message:'Preview project failure'},500); const rows=mock.navigationProjects??[{id:id(10),title:'Product workspace',is_owner:!mock.member,can_manage:!mock.member}];return respond({total:rows.length,rows:rows.slice(body.p_offset,body.p_offset+body.p_limit)}); }
    if(path==='create_project_with_default_stages' && mock.projectBrowserProjects){const project={id:id(9000),title:body.p_title,description:body.p_description,stage_count:3,open_tasks:0,done_tasks:0,is_owner:true,is_member:false,can_manage:true,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};mock.projectBrowserProjects.push(project);return respond(project.id);}
    if(path==='projects' && init.method==='PATCH' && mock.projectBrowserProjects){const target=url.searchParams.get('id')?.slice(3);const project=mock.projectBrowserProjects.find(p=>p.id===target);if(project)Object.assign(project,body,{updated_at:new Date().toISOString()});return respond(project?[{id:project.id}]:[]);}
    if(path==='projects' && init.method==='DELETE' && mock.projectBrowserProjects){const target=url.searchParams.get('id')?.slice(3);const removed=mock.projectBrowserProjects.filter(p=>p.id===target);mock.projectBrowserProjects=mock.projectBrowserProjects.filter(p=>p.id!==target);return respond(removed.map(p=>({id:p.id})));}
    if(path==='projects' && mock.projectBrowserProjects){const target=url.searchParams.get('id')?.slice(3);const p=mock.projectBrowserProjects.find(p=>p.id===target);return respond(p?{...p,owner_id:p.is_owner?user.id:id(99)}:null);}
    if(path==='projects')return respond(mock.denied?null:{id:id(10),title:'Product workspace',description:'A focused place to plan, build, and ship thoughtful product improvements. '+ 'Keep work visible, reduce friction, and bring the team along. '.repeat(4),owner_id:mock.member?id(99):user.id});
    if(path==='create_project_stage'){
      if(mock.delayStage)await new Promise(r=>setTimeout(r,mock.delayStage));
      if(mock.failStage)return respond({message:'Preview failure'},500);
      if(mock.duplicateStage)return respond({code:'23505',message:'Duplicate name'},409);
      if(mock.member&&!mock.admin)return respond({code:'42501',message:'Denied'},403);
      const stage={id:id(8000+stages.length),name:body.p_name.trim(),position:Math.max(-1,...stages.map(s=>s.position))+1,is_done:body.p_is_done};
      stages.push(stage);sessionStorage.setItem('taskboard-stages-fixture',JSON.stringify(stages));return respond(stage.id);
    }
    if(path==='project_stages')return respond(stages);
    if(path==='project_labels'&&mock.failLabelLoad)return respond({message:'Preview label load failure'},500);
    if(path==='project_labels')return respond([{id:id(31),project_id:id(10),name:'Product',colour:'#dce9ff'}]);
    if(path==='board_stage_counts')return respond(stages.map(s=>({stage_id:s.id,task_count:tasks.filter(t=>t.stage_id===s.id).length})));
    if(path==='tasks'){
      if(mock.failBoard)return respond({message:'Preview API failure'},500);
      let list=tasks.filter(t=>!url.searchParams.get('stage_id')||t.stage_id===url.searchParams.get('stage_id').slice(3));
      if(url.searchParams.has('id'))return respond(tasks.find(t=>t.id===url.searchParams.get('id').slice(3))??null);
      const cursor=url.searchParams.get('or');if(cursor){const match=cursor.match(/position.gt.(\d+)/);if(match)list=list.filter(t=>t.position>Number(match[1]));}
      return respond(list.sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id)).slice(0,Number(url.searchParams.get('limit')??1000)));
    }
    if(path==='list_task_assignees' && body.p_task_ids.some(id=>mock.formAssignees?.[id]))return respond(body.p_task_ids.flatMap(id=>mock.formAssignees?.[id]??[]));
    if(path==='list_task_assignees' && mock.cardAssignees)return respond(mock.cardAssignees.filter(a=>body.p_task_ids.includes(a.task_id)));
    if(path==='list_task_assignees')return respond(body.p_task_ids.filter(t=>t===id(100)||t===id(200)).map(task_id=>({task_id,user_id:id(1),label:'Alex Morgan'})));
    if(path==='task_checklist_progress')return respond(body.p_task_ids.map(task_id=>({task_id,total:task_id===id(100)?5:0,completed:task_id===id(100)?2:0})));
    if(path==='get_task_checklist'){const items=mock.formChecklists?.[body.p_task_id]??[];return respond({items,total:items.length,completed:items.filter(i=>i.completed).length});}
    if(path==='list_task_comments')return respond({rows:[],total:0});
    if(path==='search_task_assignees')return respond(mock.formParticipants??[]);
    if(path==='task_labels'){const taskId=url.searchParams.get('task_id')?.slice(3);return respond((mock.formLabels?.[taskId]??tasks.find(t=>t.id===taskId)?.task_labels?.map(row=>row.project_labels.id)??[]).map(label_id=>({label_id})));}
    if(path==='task_labels'||path==='task_attachments'||path==='attachment_cleanup_queue')return respond([]);
    if(path==='save_task_form'){
      if(mock.failSave)return respond({message:'Preview save failure'},500);
      if(mock.failRelated)return respond({message:'Invalid project participant',code:'23514'},400);
      if(mock.delaySave)await new Promise(r=>setTimeout(r,mock.delaySave));
      mock.formReceipts??={};const receipt=mock.formReceipts[body.p_request_id];if(!body.p_task_id&&receipt)return respond(receipt);
      const values=body.p_values;let task=body.p_task_id?tasks.find(t=>t.id===body.p_task_id):null;
      if(!task){task={...tasks[0],id:id(500+tasks.length),project_id:body.p_project_id,stage_id:values.stage_id,position:tasks.filter(t=>t.stage_id===values.stage_id).length};tasks.push(task);}
      const source=task.stage_id;if(source!==values.stage_id){task.position=tasks.filter(t=>t.stage_id===values.stage_id).length;tasks.filter(t=>t.stage_id===source&&t.id!==task.id).forEach((t,i)=>t.position=i);}
      Object.assign(task,{priority:values.priority??task.priority??'medium',title:values.title,description:values.description,stage_id:values.stage_id,due_at:values.due_at,done:stages.find(s=>s.id===values.stage_id).is_done,task_labels:values.label_ids.map(label=>({project_labels:{id:label,name:'Product',colour:'#dce9ff'}}))});
      (mock.formLabels??={})[task.id]=values.label_ids;(mock.formAssignees??={})[task.id]=values.assignee_ids.map(user_id=>({task_id:task.id,user_id,label:'Alex Morgan'}));
      (mock.formChecklists??={})[task.id]=values.checklist.map((item,i)=>({...item,id:item.id??id(7000+i),position:i}));
      if(!body.p_task_id)mock.formReceipts[body.p_request_id]=task.id;
      persist();persistForm();
      if(mock.commitThenFail){mock.commitThenFail=false;return respond({message:'Lost response'},500);}return respond(task.id);
    }
    if(path==='create_task_with_deadline'||path==='create_task_with_priority'){
      if(mock.failSave)return respond({message:'Preview save failure'},500);
      const task={...tasks[0],id:id(500+tasks.length),stage_id:body.p_stage_id,title:body.p_title,description:body.p_description,priority:body.p_priority??'medium',due_at:body.p_due_at,task_labels:[],position:tasks.filter(t=>t.stage_id===body.p_stage_id).length};tasks.push(task);persist();return respond(task.id);
    }
    if(path==='update_task_with_deadline'||path==='update_task'||path==='update_task_with_priority'){
      if(mock.failSave)return respond({message:'Preview save failure'},500);
      const task=tasks.find(t=>t.id===body.p_task_id);const source=task.stage_id;
      if(body.p_stage_id && body.p_stage_id!==source){task.position=tasks.filter(t=>t.stage_id===body.p_stage_id).length;task.stage_id=body.p_stage_id;tasks.filter(t=>t.stage_id===source).sort((a,b)=>a.position-b.position).forEach((t,i)=>t.position=i);}
      Object.assign(task,{priority:body.p_priority??task.priority??'medium',title:body.p_title,description:body.p_description,done:stages.find(s=>s.id===task.stage_id).is_done,due_at:body.p_due_at===undefined?task.due_at:body.p_due_at});persist();return respond(null);
    }
    if(path==='delete_task'){const index=tasks.findIndex(t=>t.id===body.p_task_id);tasks.splice(index,1);persist();return respond(body.p_task_id);}
    if(path==='move_task_relative'){
      if(mock.failMove)return respond({message:'Preview move failure'},500);
      const task=tasks.find(t=>t.id===body.p_task_id);const source=task.stage_id;
      const others=tasks.filter(t=>t.stage_id===body.p_stage_id&&t.id!==task.id).sort((a,b)=>a.position-b.position);
      const index=body.p_to_end?others.length:body.p_after_task_id?others.findIndex(t=>t.id===body.p_after_task_id)+1:0;
      task.stage_id=body.p_stage_id;task.done=stages.find(s=>s.id===body.p_stage_id).is_done;others.splice(index,0,task);others.forEach((t,i)=>t.position=i);
      tasks.filter(t=>t.stage_id===source&&t.id!==task.id).sort((a,b)=>a.position-b.position).forEach((t,i)=>t.position=i);
      persist();
      return respond({task_id:task.id,stage_id:task.stage_id,source_stage_id:source,position:task.position,done:task.done,changed:true,source_count:tasks.filter(t=>t.stage_id===source).length,dest_count:others.length});
    }
    return respond([]);
  };
  const NativeSocket=window.WebSocket;
  window.WebSocket=class extends EventTarget {
    static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
    constructor(url,protocols){super();if(new URL(url).host!==window.__boardPreview.host)return new NativeSocket(url,protocols);this.url=url;this.readyState=0;window.__mockSocket=this;setTimeout(()=>{this.readyState=1;this.emit('open',new Event('open'));},20);}
    emit(name,event){this.dispatchEvent(event);this['on'+name]?.(event);}
    send(data){try{const msg=JSON.parse(data);window.__lastSocketMessage=msg;(window.__boardMock.socketMessages??=[]).push(msg);if(Array.isArray(msg)&&['phx_join','heartbeat'].includes(msg[3]))setTimeout(()=>this.emit('message',new MessageEvent('message',{data:JSON.stringify([msg[0],msg[1],msg[2],'phx_reply',{status:'ok',response:{}}])})),10);}catch{}}
    close(){this.readyState=3;this.emit('close',new CloseEvent('close'));}
  };
})();
