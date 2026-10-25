export const PRIORITIES=Object.freeze(['low','medium','high','urgent']);
export const PRIORITY_META=Object.freeze({low:{label:'Low',glyph:'↓',icon:'arrow-down',rank:1},medium:{label:'Medium',glyph:'◆',icon:'dash',rank:2},high:{label:'High',glyph:'↑',icon:'chevron-double-up',rank:3},urgent:{label:'Urgent',glyph:'‼',icon:'exclamation-triangle-fill',rank:4}});
export const isPriority=value=>PRIORITIES.includes(value);
export const taskPriority=value=>isPriority(value)?value:'medium';
export function requirePriority(value){if(!isPriority(value))throw new Error('Choose Low, Medium, High or Urgent priority.');return value;}
export function parsePriorities(value){const values=String(value??'').split(',');return PRIORITIES.filter(p=>values.includes(p));}
export function sortBoardTasks(tasks,sort){return sort==='priority'?[...tasks].sort((a,b)=>PRIORITY_META[taskPriority(b.priority)].rank-PRIORITY_META[taskPriority(a.priority)].rank||a.position-b.position||a.id.localeCompare(b.id)):tasks;}
