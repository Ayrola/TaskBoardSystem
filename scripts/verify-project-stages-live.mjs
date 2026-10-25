// Explicit live integration check. Creates and removes one disposable project using existing classroom accounts.
// No account creation, email, service key, or existing project writes.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
if(!process.argv.includes('--confirm-test-project'))throw Error('Pass --confirm-test-project to create and clean up a disposable project.');
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
const make=()=>createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const owner=make(),member=make(),outsider=make();let project,channel;
const ok=({data,error})=>{if(error)throw error;return data;};
try {
 const users=await Promise.all([[owner,'steve@gmail.com'],[member,'maria@gmail.com'],[outsider,'peter@gmail.com']].map(async([client,email])=>ok(await client.auth.signInWithPassword({email,password:'pass123'})).user));
 project=ok(await owner.rpc('create_project_with_default_stages',{p_title:`Stage verification ${crypto.randomUUID()}`,p_description:'Disposable integration verification'}));
 ok(await owner.from('project_members').insert({project_id:project,user_id:users[1].id}));
 await member.realtime.setAuth();
 let notified;
 const notification=new Promise(resolve=>{notified=resolve;});
 channel=member.channel(`project:${project}:board`,{config:{private:true}}).on('broadcast',{event:'project_changed'},message=>{if(message.payload.project_id===project)notified();});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Realtime subscription timeout')),15000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(timer);reject(Error(status));}});});
 const ids=await Promise.all(['  Concurrent ordinary  ','Concurrent completion'].map(async(name,i)=>ok(await owner.rpc('create_project_stage',{p_project_id:project,p_name:name,p_is_done:i===1}))));
 await Promise.race([notification,new Promise((_,reject)=>setTimeout(()=>reject(Error('Stage broadcast timeout')),10000))]);
 const stages=ok(await owner.from('project_stages').select('*').eq('project_id',project).order('position'));
 assert.deepEqual(stages.map(s=>s.position),[0,1,2,3,4]);assert.equal(new Set(stages.map(s=>s.position)).size,5);assert.equal(stages.find(s=>s.id===ids[0]).name,'Concurrent ordinary');
 for(const name of ['', '   ','\t\n','CONCURRENT ORDINARY','x'.repeat(101)])assert.ok((await owner.rpc('create_project_stage',{p_project_id:project,p_name:name})).error);
 for(const client of [member,outsider]){
   assert.ok((await client.rpc('create_project_stage',{p_project_id:project,p_name:'Denied'})).error);
   assert.ok((await client.from('project_stages').insert({project_id:project,name:'Denied direct',position:99})).error);
 }
 const task=ok(await member.rpc('create_task',{p_project_id:project,p_stage_id:ids[0],p_title:'Disposable task'}));
 ok(await member.rpc('move_task_relative',{p_task_id:task,p_stage_id:ids[1],p_to_end:true}));
 assert.equal(ok(await member.from('tasks').select('done').eq('id',task).single()).done,true);
 const doneTask=ok(await member.rpc('create_task',{p_project_id:project,p_stage_id:ids[1],p_title:'Disposable completed task'}));
 assert.equal(ok(await member.from('tasks').select('done').eq('id',doneTask).single()).done,true);
 const counts=ok(await member.rpc('board_stage_counts',{p_project_id:project}));assert.equal(Number(counts.find(s=>s.stage_id===ids[1]).task_count),2);
 assert.equal(ok(await outsider.from('project_stages').select('id').eq('project_id',project)).length,0);
 console.log('PASS LIVE: two concurrent owner creations append unique positions; validation and case-insensitive uniqueness; member/outsider RPC and direct-insert denial; member create/move tasks and completion counts; private Realtime stage notification received by another authorized viewer.');
} finally {
 if(channel)await member.removeChannel(channel);
 if(project){ok(await owner.from('projects').delete().eq('id',project));console.log('Disposable test project cleaned up.');}
 for(const client of [owner,member,outsider])await client.removeAllChannels();
}
