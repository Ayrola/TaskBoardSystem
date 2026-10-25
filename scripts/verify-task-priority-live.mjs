// Explicit integration verification: one disposable classroom project, then cleanup.
import {createClient} from '@supabase/supabase-js';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
if(!process.argv.includes('--confirm-test-project'))throw Error('Pass --confirm-test-project to create and clean up a disposable project.');
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
const make=()=>createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const owner=make(),member=make(),outsider=make(),ok=({data,error})=>{if(error)throw error;return data;};let project,channel;
try{
 const users=await Promise.all([[owner,'steve@gmail.com'],[member,'maria@gmail.com'],[outsider,'peter@gmail.com']].map(async([c,email])=>ok(await c.auth.signInWithPassword({email,password:'pass123'})).user));
 project=ok(await owner.rpc('create_project_with_default_stages',{p_title:`Priority verification ${crypto.randomUUID()}`,p_description:'Disposable integration test'}));
 ok(await owner.from('project_members').insert({project_id:project,user_id:users[1].id}));
 const stages=ok(await member.from('project_stages').select('id').eq('project_id',project).order('position'));const stage=stages[0].id;
 const tasks=[];
 for(const priority of ['low','medium','high','urgent'])tasks.push(ok(await member.rpc('create_task_with_priority',{p_project_id:project,p_stage_id:stage,p_title:`Priority ${priority}`,p_priority:priority})));
 let rows=ok(await owner.from('tasks').select('id,title,priority,position').eq('project_id',project).order('position'));
 assert.deepEqual(rows.map(t=>t.priority),['low','medium','high','urgent']);assert.deepEqual(rows.map(t=>t.position),[0,1,2,3]);
 assert.ok((await member.from('tasks').update({priority:'critical'}).eq('id',tasks[0])).error);
 assert.equal(ok(await outsider.from('tasks').update({priority:'urgent'}).eq('id',tasks[0]).select('id')).length,0);
 assert.ok((await outsider.rpc('update_task_with_priority',{p_task_id:tasks[0],p_title:'Denied',p_description:null,p_stage_id:stage,p_due_at:null,p_priority:'urgent'})).error);
 await member.realtime.setAuth();let received;const notification=new Promise(resolve=>{received=resolve;});
 channel=member.channel(`project:${project}:board`,{config:{private:true}}).on('broadcast',{event:'project_changed'},message=>{if(message.payload.project_id===project)received();});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Realtime timeout')),15000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(timer);reject(Error(status));}});});
 ok(await owner.rpc('update_task_with_priority',{p_task_id:tasks[0],p_title:'Priority low',p_description:null,p_stage_id:stage,p_due_at:null,p_priority:'urgent'}));
 await Promise.race([notification,new Promise((_,reject)=>setTimeout(()=>reject(Error('Priority broadcast timeout')),10000))]);
 const events=ok(await member.from('task_activity').select('changes,event_type').eq('project_id',project));assert.ok(events.some(e=>e.changes.priority?.from==='low'&&e.changes.priority?.to==='urgent'));
 const dashboard=ok(await member.rpc('project_dashboard',{p_project_id:project}));assert.equal(dashboard.totals.urgent_open,2);assert.equal(dashboard.totals.high_open,1);assert.equal(dashboard.totals.overdue,0);
 const report=ok(await member.rpc('project_statistics_report',{p_project_id:project}));assert.equal(report.tasks.filter(t=>t.priority==='urgent').length,2);
 rows=ok(await owner.from('tasks').select('position').eq('project_id',project).order('position'));assert.deepEqual(rows.map(t=>t.position),[0,1,2,3]);
 console.log('PASS LIVE: owner/member priority writes, all four values, invalid/direct outsider denial, priority change activity and private Realtime notification, scoped dashboard/PDF counts, no deadline coupling and unchanged positions.');
}finally{
 if(channel)await member.removeChannel(channel);if(project){ok(await owner.from('projects').delete().eq('id',project));console.log('Disposable priority project cleaned up.');}
 for(const client of [owner,member,outsider])await client.removeAllChannels();
}
