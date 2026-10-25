import { renderPriority } from '../task-priority/task-priority.js';
import html from './task-card.html?raw';
import './task-card.css';
import {htmlToExcerpt,setText} from '../../utils/render.js';
import {labelBadge} from '../../utils/labels.js';
import {renderTaskDeadline,displayTimezone} from '../../utils/deadlines.js';

const template=document.createElement('template');template.innerHTML=html;

export function renderCardDeadline(element,task) {
 renderTaskDeadline(element,task);
 element.classList.toggle('is-overdue',element.classList.contains('text-danger'));
 if(!task.dueAt)return;
 element.dateTime=task.dueAt;element.title=element.textContent;
 const date=new Intl.DateTimeFormat(undefined,{timeZone:displayTimezone(),month:'short',day:'numeric'}).format(new Date(task.dueAt));
 element.textContent=`${element.classList.contains('is-overdue')?'Overdue · ':'Due '}${date}`;
}
export function createTaskCard(task) {
 const card=template.content.firstElementChild.cloneNode(true);card.dataset.taskId=task.id;
 setText(card,'[data-task-title]',task.title);
 renderPriority(card.querySelector('[data-task-priority]'),task.priority);
 const labels=card.querySelector('[data-task-labels]'),items=task.labels??[];
 labels.setAttribute('role','group');labels.append(...items.slice(0,2).map(label=>{const chip=labelBadge(label);chip.classList.remove('text-wrap','text-break','rounded-pill');return chip;}));labels.hidden=!items.length;
 if(items.length>2){const overflow=document.createElement('span');overflow.className='task-label-overflow';overflow.setAttribute('role','img');overflow.textContent=`+${items.length-2}`;overflow.title=items.slice(2).map(label=>label.name).join(', ');overflow.setAttribute('aria-label',`${items.length-2} more labels: ${overflow.title}`);labels.append(overflow);}
 const excerpt=htmlToExcerpt(task.description,220);if(excerpt)setText(card,'[data-task-excerpt]',excerpt).hidden=false;
 card.querySelector('[data-card-done]').hidden=!task.done;
 renderCardDeadline(card.querySelector('[data-deadline]'),task);
 const showMeta=(selector,text,name)=>{const item=card.querySelector(selector);item.hidden=false;item.querySelector('span').textContent=text;item.setAttribute('aria-label',name);item.title=name;};
 if(task.checklist?.total)showMeta('[data-checklist-progress]',`${task.checklist.completed}/${task.checklist.total}`,`${task.checklist.completed} of ${task.checklist.total} checklist items complete`);
 if(task.attachmentCount)showMeta('[data-attachment-progress]',task.attachmentCount,`${task.attachmentCount} attachments`);
 if(task.commentCount)showMeta('[data-comment-progress]',task.commentCount,`${task.commentCount} comments`);
 card.querySelector('[data-indicators]').hidden=![...card.querySelectorAll('.task-meta-item')].some(item=>!item.hidden);
 const assignees=card.querySelector('[data-task-assignees]'),people=task.assignees??[];
 if(people.length){assignees.hidden=false;assignees.setAttribute('role','group');assignees.setAttribute('aria-label',`Assigned to ${people.map(person=>person.label).join(', ')}`);assignees.title=assignees.getAttribute('aria-label');
  for(const person of people.slice(0,2)){const avatar=document.createElement('span');avatar.className='task-avatar';const words=String(person.label??'').split('@')[0].trim().split(/[\s._-]+/).filter(Boolean);avatar.textContent=(words.length>1?words.slice(0,2).map(word=>[...word][0]).join(''):[...(words[0]??'')].slice(0,2).join('')).toUpperCase();avatar.title=person.label;avatar.setAttribute('aria-hidden','true');assignees.append(avatar);}
  if(people.length>2){const extra=document.createElement('span');extra.className='task-avatar task-avatar-overflow';extra.textContent=`+${people.length-2}`;extra.setAttribute('aria-hidden','true');assignees.append(extra);}
 }
 card.querySelector('[data-card-meta]').hidden=![...card.querySelector('[data-card-meta]').children].some(child=>!child.hidden);
 const menu=card.querySelector('[data-card-menu]');menu.id=`task-menu-${task.id}`;
 const trigger=card.querySelector('[data-task-menu-trigger]');trigger.setAttribute('popovertarget',menu.id);trigger.setAttribute('aria-label',`Actions for ${task.title}`);
 card.querySelector('[data-open-task]').setAttribute('aria-label',`Open task: ${task.title}`);
 for(const button of card.querySelectorAll('[data-task-action]'))button.setAttribute('aria-label',`${button.dataset.taskAction} task: ${task.title}`);
 return card;
}
