// Read-only integration verification using existing classroom accounts. No tasks or projects are changed.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
const ok=({data,error})=>{if(error)throw error;return data;};
const sessions=[];
try {
 for(const email of ['steve@gmail.com','maria@gmail.com','peter@gmail.com']){
  const client=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const user=ok(await client.auth.signInWithPassword({email,password:'pass123'})).user;
  const projects=ok(await client.from('projects').select('id,owner_id').order('id'));
  sessions.push({client,user,projects});
 }
 let owners=0,members=0,outsiders=0;
 for(const {client,user,projects} of sessions){
  for(const project of [projects.find(p=>p.owner_id===user.id),projects.find(p=>p.owner_id!==user.id)].filter(Boolean)){
   const data=ok(await client.rpc('project_dashboard',{p_project_id:project.id,p_days:7,p_timezone:'Europe/Sofia'}));
   const counts=await Promise.all([undefined,false,true].map(done=>{let q=client.from('tasks').select('id',{count:'exact',head:true}).eq('project_id',project.id);return done===undefined?q:q.eq('done',done);}));
   counts.forEach(result=>{if(result.error)throw result.error;});
   assert.equal(data.totals.total,counts[0].count);assert.equal(data.totals.open,counts[1].count);assert.equal(data.totals.completed,counts[2].count);
   assert.equal(data.stages.reduce((n,s)=>n+s.count,0),data.totals.total);assert.equal(data.creation.length,7);
   if(project.owner_id===user.id)owners++;else members++;
  }
  const foreign=sessions.flatMap(s=>s.projects).find(p=>!projects.some(visible=>visible.id===p.id));
  if(foreign){const result=await client.rpc('project_dashboard',{p_project_id:foreign.id});assert.equal(result.error?.code,'P0002');outsiders++;}
 }
 assert.ok(owners>0&&members>0&&outsiders>0,'Existing fixtures must cover owner, member and outsider');
 console.log(`PASS LIVE READ-ONLY: ${owners} owner and ${members} member project dashboards match independent exact task counts; ${outsiders} outsider requests rejected; stage totals and trend windows verified. No task data changed.`);
} finally {for(const {client} of sessions)await client.removeAllChannels();}
