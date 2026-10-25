const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export function reportFixture({count=8,allDone=false,allOpen=false,cjk=false,history=true}={}) {
 const project={id:id(10),title:cjk?'Проект София · 工作计划':'Проект София — Taskboard',description:'Статистика на проекта. A report with selectable Bulgarian, English, café and Ελληνικά text.'};
 const meta={as_of:'2026-10-25T12:00:00Z',timezone:'Europe/Sofia',start_date:'2026-10-19',end_date:'2026-10-25',start_at:'2026-10-18T21:00:00Z',end_exclusive:'2026-10-25T12:00:00Z',due_soon_before:'2026-11-01T12:00:00Z'};
 const stages=[{id:id(11),name:'Преглед / Custom review',position:3,is_done:false},{id:id(12),name:'Приключено / Accepted',position:9,is_done:true}];
 const labels=[{id:id(31),name:'Клиент',colour:'#0044aa'},{id:id(32),name:'Product',colour:'#449900'}];
 const people=[{user_id:id(1),name:'Ивелина'},{user_id:id(2),name:'Alex'}];
 const tasks=Array.from({length:count},(_,i)=>{
 const done=allDone||(!allOpen&&i%3===0);
 return {id:id(100+i),project_id:project.id,stage_id:stages[done?1:0].id,title:i===0?'Дълго заглавие: '+ 'Проверка на достъпността и четимостта на таблицата. '.repeat(3):`Задача ${i+1} — Build accessible project reports`,done,position:i,created_at:i===0?'2026-01-01T12:00:00Z':'2026-10-21T09:00:00Z',due_at:i%4===0?null:i%4===1?'2026-10-20T09:00:00Z':'2026-10-26T09:00:00Z',completed_at:history&&done&&i===0?'2026-10-24T12:00:00Z':null,assignee_ids:i%3===1?[id(1),id(2)]:[],label_ids:i%2===0?[id(31),id(32)]:[]};
 });
 const events=history&&count?[{id:'1',task_id:tasks[0].id,event_type:'updated',created_at:'2026-10-24T10:00:00Z',completed:{from:false,to:true},stage:{from_id:id(11),to_id:id(12)}},{id:'2',task_id:tasks[0].id,event_type:'updated',created_at:'2026-10-24T11:00:00Z',completed:{from:true,to:false},stage:{from_id:id(12),to_id:id(11)}},{id:'3',task_id:tasks[0].id,event_type:'updated',created_at:'2026-10-24T12:00:00Z',completed:{from:false,to:true},stage:{from_id:id(11),to_id:id(12)}},{id:'4',task_id:id(9999),event_type:'created',created_at:'2026-10-24T13:00:00Z',completed:false}]:[];
 return {project,meta,stages,labels,people,tasks,events};
}
