import { PRIORITIES, PRIORITY_META, taskPriority, isPriority } from '../../utils/priorities.js';
import { renderPriority } from '../task-priority/task-priority.js';
import { mountDeadlinePicker } from '../deadline-picker/deadline-picker.js';
import { createTaskDescriptionEditor } from '../task-description-editor.js';
import { browserTimezone, toLocalDeadlineInput, deadlineFromEditor } from '../../utils/deadlines.js';
import { validateTaskTitle, validateTaskStage } from '../../utils/validation.js';
import { sanitizeRichText, RICH_TEXT_MAX_LENGTH } from '../../utils/sanitize.js';

export function mountTaskFields(element, { mode, task, stages, stageId, signal }) {
 const title=element.querySelector('[data-task-title]'),stage=element.querySelector('[data-stage-input]'),deadline=element.querySelector('[data-deadline-input]');
 const priority=element.querySelector('[data-priority-input]');
 priority.replaceChildren(...PRIORITIES.map(value=>new Option(`${PRIORITY_META[value].glyph} ${PRIORITY_META[value].label}`,value)));
 priority.value=taskPriority(task?.priority);
 const updatePriority=()=>renderPriority(element.querySelector('[data-priority-indicator]'),priority.value);updatePriority();
 priority.addEventListener('change',()=>{error('priority','');updatePriority();},{signal});
 const originalStage=task?.stageId ?? stageId;
 title.value=task?.title??'';
 stage.replaceChildren(...stages.map(row=>new Option(row.name,row.id)));
 stage.value=stages.some(row=>row.id===originalStage)?originalStage:stages[0]?.id??'';
 deadline.value=toLocalDeadlineInput(task?.dueAt);
 element.querySelector('[data-deadline-help]').textContent=`Local time (${browserTimezone()}). Repeated times when clocks go back use the first occurrence; unchanged deadlines keep their original instant.`;
 const error=(name,message)=>{
  element.querySelector(`[data-${name}-error]`).textContent=message??'';
  const input={title,stage,deadline,priority,description:editor.root}[name];input.classList.toggle('is-invalid',Boolean(message));input.setAttribute('aria-invalid',String(Boolean(message)));
 };
 let editor=createTaskDescriptionEditor(element.querySelector('[data-description-editor]'),{value:task?.description??'',labelId:'task-view-description-label',errorId:'task-view-description-error'});
 const initial=JSON.stringify([title.value,stage.value,deadline.value,priority.value,editor.getSemanticHTML()]);
 const picker=mountDeadlinePicker(deadline,{signal,onChange:()=>error('deadline','')});
 const onChange=()=>error('description','');editor.on('text-change',onChange);
 title.addEventListener('input',()=>error('title',''),{signal});
 stage.addEventListener('change',()=>{error('stage','');element.querySelector('[data-stage-hint]').hidden=mode==='create'||stage.value===originalStage;},{signal});
 signal.addEventListener('abort',()=>{editor?.off('text-change',onChange);editor=null;},{once:true});
 return {
  focus:()=>title.focus(),
  isDirty:()=>JSON.stringify([title.value,stage.value,deadline.value,priority.value,editor?.getSemanticHTML()])!==initial,
  setDisabled(busy){title.readOnly=busy;stage.disabled=deadline.disabled=priority.disabled=busy;picker.setDisabled(busy);editor?.enable(!busy);},
  read(){
   const description=editor.getSemanticHTML().replace(/&nbsp;/g,' ');
   const errors={priority:isPriority(priority.value)?'':'Choose a valid priority.',title:validateTaskTitle(title.value),stage:validateTaskStage(stage.value)||(!stages.some(row=>row.id===stage.value)?'Choose an available stage.':''),description:sanitizeRichText(description).length>RICH_TEXT_MAX_LENGTH?'The description is too long.':''};
   let dueAt=null;errors.deadline=deadline.validity.badInput?'Enter a complete deadline date and time, or clear it.':'';
   try{dueAt=deadlineFromEditor(deadline.value,task?.dueAt);}catch(failure){errors.deadline=failure.message;}
   Object.entries(errors).forEach(([name,message])=>error(name,message));
   const first=['title','stage','priority','deadline','description'].find(name=>errors[name]);
   if(first){({title,stage,deadline,priority,description:editor.root}[first]).focus();return null;}
   return {title:title.value.trim(),description,stageId:stage.value,dueAt,priority:priority.value};
  },
 };
}
