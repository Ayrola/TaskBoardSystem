// Synthetic data and network stubs for the isolated board browser checks.
(() => {
  const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  const user={id:id(1),email:'preview@example.test',aud:'authenticated',role:'authenticated',user_metadata:{},app_metadata:{}};
  const token='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.'+btoa(JSON.stringify({sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+86400}))+'.preview';
  localStorage.setItem(`sb-${window.__boardPreview.ref}-auth-token`,JSON.stringify({access_token:token,refresh_token:'preview',expires_at:Math.floor(Date.now()/1000)+86400,expires_in:86400,token_type:'bearer',user}));
  const stages=[{id:id(11),name:'Backlog',position:0,is_done:false},{id:id(12),name:'In progress',position:1,is_done:false},{id:id(13),name:'Review',position:2,is_done:false},{id:id(14),name:'Complete',position:3,is_done:true}];
  const names=['Design the onboarding flow','Improve dashboard performance','Review project permissions','Polish responsive navigation','Write release notes','Audit keyboard interaction','Simplify account settings','Prepare the next milestone'];
  const tasks=Array.from({length:58},(_,i)=>({id:id(100+i),project_id:id(10),stage_id:id(11),title:i===57?'Needle task beyond the first page':names[i%names.length]+(i>7?` ${i+1}`:''),description:i===0?'<p>Map the first-run experience and make every step feel clear.</p>':i===1?'<p>Long description with &amp; safe content. '+ 'A clear, readable preview. '.repeat(30)+'</p>':i%3===0?'<p>Ship a focused improvement with clear acceptance criteria.</p>':'',position:i,done:false,due_at:i===0?'2020-01-01T12:00:00Z':null,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),task_labels:i%4===0?[{project_labels:{id:id(31),name:'Product',colour:'#dce9ff'}}]:[],task_attachments:[{count:i===0?2:0}],task_comments:[{count:i===0?3:0}]}));
  tasks.push(...[0,1,2].map((i)=>({...tasks[i],id:id(200+i),stage_id:i===2?id(14):id(12),position:i===2?0:i,done:i===2,title:['Build the shared design system','Accessibility review','Launch project workspace'][i]})));
  const stored=sessionStorage.getItem('taskboard-browser-fixture');
  if(stored)tasks.splice(0,tasks.length,...JSON.parse(stored));
  const persist=()=>sessionStorage.setItem('taskboard-browser-fixture',JSON.stringify(tasks));
  window.__boardMock={tasks,stages,id,failSave:false,failMove:false,failBoard:false,denied:false,member:false,calls:[]};
  const nativeFetch=window.fetch;
  window.fetch=async(input,init={})=>{
    const raw=typeof input==='string'?input:input.url;
    if(new URL(raw,location.href).host!==window.__boardPreview.host) return nativeFetch(input,init);
    const url=new URL(raw);const path=url.pathname.split('/').at(-1); const body=init.body?JSON.parse(init.body):{};const mock=window.__boardMock;
    mock.calls.push({path,body,url:url.search});
    const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','Access-Control-Allow-Origin':'*'}});
    if(url.pathname.includes('/auth/')) return respond({user});
    if(path==='is_admin')return respond(false);
    if(path==='projects')return respond(mock.denied?null:{id:id(10),title:'Product workspace',description:'A focused place to plan, build, and ship thoughtful product improvements. '+ 'Keep work visible, reduce friction, and bring the team along. '.repeat(4),owner_id:mock.member?id(99):user.id});
    if(path==='project_stages')return respond(stages);
    if(path==='project_labels')return respond([{id:id(31),project_id:id(10),name:'Product',colour:'#dce9ff'}]);
    if(path==='board_stage_counts')return respond(stages.map(s=>({stage_id:s.id,task_count:tasks.filter(t=>t.stage_id===s.id).length})));
    if(path==='tasks'){
      if(mock.failBoard)return respond({message:'Preview API failure'},500);
      let list=tasks.filter(t=>!url.searchParams.get('stage_id')||t.stage_id===url.searchParams.get('stage_id').slice(3));
      if(url.searchParams.has('id'))return respond(tasks.find(t=>t.id===url.searchParams.get('id').slice(3))??null);
      const cursor=url.searchParams.get('or');if(cursor){const match=cursor.match(/position.gt.(\d+)/);if(match)list=list.filter(t=>t.position>Number(match[1]));}
      return respond(list.sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id)).slice(0,Number(url.searchParams.get('limit')??1000)));
    }
    if(path==='list_task_assignees')return respond(body.p_task_ids.filter(t=>t===id(100)||t===id(200)).map(task_id=>({task_id,user_id:id(1),label:'Alex Morgan'})));
    if(path==='task_checklist_progress')return respond(body.p_task_ids.map(task_id=>({task_id,total:task_id===id(100)?5:0,completed:task_id===id(100)?2:0})));
    if(path==='get_task_checklist')return respond({items:[],total:0,completed:0});
    if(path==='list_task_comments')return respond({rows:[],total:0});
    if(path==='search_task_assignees')return respond([]);
    if(path==='task_labels'||path==='task_attachments'||path==='attachment_cleanup_queue')return respond([]);
    if(path==='create_task_with_deadline'){
      if(mock.failSave)return respond({message:'Preview save failure'},500);
      const task={...tasks[0],id:id(500+tasks.length),stage_id:body.p_stage_id,title:body.p_title,description:body.p_description,due_at:body.p_due_at,task_labels:[],position:tasks.filter(t=>t.stage_id===body.p_stage_id).length};tasks.push(task);persist();return respond(task.id);
    }
    if(path==='update_task_with_deadline'||path==='update_task'){
      if(mock.failSave)return respond({message:'Preview save failure'},500);
      const task=tasks.find(t=>t.id===body.p_task_id);const source=task.stage_id;
      if(body.p_stage_id && body.p_stage_id!==source){task.position=tasks.filter(t=>t.stage_id===body.p_stage_id).length;task.stage_id=body.p_stage_id;tasks.filter(t=>t.stage_id===source).sort((a,b)=>a.position-b.position).forEach((t,i)=>t.position=i);}
      Object.assign(task,{title:body.p_title,description:body.p_description,done:stages.find(s=>s.id===task.stage_id).is_done,due_at:body.p_due_at===undefined?task.due_at:body.p_due_at});persist();return respond(null);
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
    send(data){try{const msg=JSON.parse(data);window.__lastSocketMessage=msg;if(Array.isArray(msg)&&['phx_join','heartbeat'].includes(msg[3]))setTimeout(()=>this.emit('message',new MessageEvent('message',{data:JSON.stringify([msg[0],msg[1],msg[2],'phx_reply',{status:'ok',response:{}}])})),10);}catch{}}
    close(){this.readyState=3;this.emit('close',new CloseEvent('close'));}
  };
})();
