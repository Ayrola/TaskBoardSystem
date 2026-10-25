import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const a='00000000-0000-0000-0000-000000000010',b='00000000-0000-0000-0000-000000000020';
const storage=new Map(),calls=[];
let projects=new Map([[a,{id:a,title:'Alpha',canManage:true}],[b,{id:b,title:'Beta',canManage:false}]]),fallback=[{id:a}],blockedStorage=false,delay;
class ProjectNotFoundError extends Error {}
const context=createContext({ localStorage:{getItem:key=>{if(blockedStorage)throw Error('Storage blocked');return storage.get(key)??null;},setItem:(key,value)=>{if(blockedStorage)throw Error('Storage blocked');storage.set(key,value);}} });
const backend=new SyntheticModule(['getProject','listProjects','ProjectNotFoundError'],function(){
 this.setExport('ProjectNotFoundError',ProjectNotFoundError);
 this.setExport('getProject',async id=>{calls.push(id);if(delay)await delay;if(!projects.has(id))throw new ProjectNotFoundError();return projects.get(id);});
 this.setExport('listProjects',async()=>({rows:fallback}));
},{context});
const validation=new SyntheticModule(['isUuid'],function(){this.setExport('isUuid',value=>typeof value==='string'&&/^[0-9a-f-]{36}$/.test(value));},{context});
const module=new SourceTextModule(await readFile(new URL('../src/services/project-context.js',import.meta.url),'utf8'),{context});
await module.link(specifier=>specifier.includes('projects-service')?backend:validation);await module.evaluate();
const {rememberProject,resolveProjectEntry,loadProjectContext}=module.namespace;
rememberProject('alice',b);assert.equal((await resolveProjectEntry('alice')).id,b);
assert.equal((await resolveProjectEntry('bob')).id,a,'Preferences are isolated per user');
assert.equal((await resolveProjectEntry('alice',{requestedId:a})).id,a,'Explicit accessible project beats preference');
projects.delete(b);assert.equal((await resolveProjectEntry('alice')).id,a,'Removed last project falls back through backend access');
projects.clear();fallback=[];assert.equal(await resolveProjectEntry('alice'),null,'Zero projects is explicit');
projects.set(a,{id:a,title:'Alpha',canManage:true});fallback=[{id:a}];blockedStorage=true;
assert.doesNotThrow(()=>rememberProject('alice',a));assert.equal((await resolveProjectEntry('alice')).id,a,'Unavailable storage does not block entry');blockedStorage=false;
let release;delay=new Promise(resolve=>{release=resolve;});const controller=new AbortController();
const pending=loadProjectContext(a,{signal:controller.signal});controller.abort();release();await assert.rejects(pending,error=>error.name==='AbortError','Delayed previous context is discarded after abort');delay=null;
const project=await loadProjectContext(a);assert.equal(Object.isFrozen(project),true);assert.equal(Object.isFrozen(project.permissions),true);assert.equal(project.permissions.manage,true);
assert.ok(calls.includes(a)&&calls.includes(b),'Every preferred project is checked by the backend');
console.log('PASS: per-user preference, explicit deep-link precedence, inaccessible fallback, zero projects, blocked storage and aborted context isolation.');
