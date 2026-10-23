import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../public/theme.js',import.meta.url),'utf8');
function setup({dark=false,stored=null,blocked=false}={}) {
 const values=new Map(stored?[['taskboard:theme',stored]]:[]), events={}, media={matches:dark,addEventListener(_,fn){this.change=fn;}};
 const root={dataset:{},style:{}};const window={addEventListener(name,fn){events[name]=fn;}};
 runInNewContext(source,{window,document:{documentElement:root},matchMedia:()=>media,localStorage:{getItem(k){if(blocked)throw Error();return values.get(k)??null;},setItem(k,v){if(blocked)throw Error();values.set(k,v);},removeItem(k){if(blocked)throw Error();values.delete(k);}}});
 return {theme:window.TaskboardTheme,root,values,events,media};
}
for(const dark of [false,true]){const s=setup({dark});assert.equal(s.theme.get().preference,'system');assert.equal(s.root.dataset.bsTheme,dark?'dark':'light');assert.equal(s.values.size,0);}
const s=setup({dark:true});s.theme.set('light');assert.equal(s.values.get('taskboard:theme'),'light');s.media.matches=false;s.media.change();assert.equal(s.root.dataset.bsTheme,'light');s.theme.set('dark');assert.equal(s.root.style.colorScheme,'dark');s.theme.set('system');assert.equal(s.values.size,0);s.media.matches=true;s.media.change();assert.equal(s.root.dataset.bsTheme,'dark');
let calls=0;const stop=s.theme.subscribe(()=>calls++);stop();s.theme.set('light');assert.equal(calls,1);
s.events.storage({key:'taskboard:theme',newValue:'dark'});assert.equal(s.root.dataset.bsTheme,'dark');s.events.storage({key:null,newValue:null});assert.equal(s.theme.get().preference,'system');
assert.equal(setup({stored:'dark'}).root.dataset.bsTheme,'dark');assert.equal(setup({stored:'bad'}).theme.get().preference,'system');const unavailable=setup({blocked:true});unavailable.theme.set('dark');assert.equal(unavailable.root.dataset.bsTheme,'dark');
// Check semantic text against each surface in both palettes, including status text.
const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
function luminance(hex){const v=hex.match(/\w\w/g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;}
for(const palette of [css.split(':root, [data-bs-theme="light"] {')[1].split('}')[0],css.split('[data-bs-theme="dark"] {')[1].split('}')[0]]){const vars=Object.fromEntries([...palette.matchAll(/--(app-[\w-]+):\s*(#[\da-f]{6})/g)].map(m=>[m[1],m[2]]));for(const text of ['text','secondary','muted','link','success','warning','danger','info'])for(const bg of ['page','sidebar','column','card','elevated','selected','hover']){const a=luminance(vars['app-'+text].slice(1)),b=luminance(vars['app-'+bg].slice(1));assert((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${text} on ${bg} AA contrast`);}}
console.log('PASS: theme startup, preferences, system changes, storage fallback/sync, subscriber cleanup and semantic AA text contrast.');
