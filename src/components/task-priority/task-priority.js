import {PRIORITY_META,taskPriority} from '../../utils/priorities.js';
import './task-priority.css';
export function renderPriority(element,value){
 const priority=taskPriority(value),meta=PRIORITY_META[priority];element.className='task-priority';element.dataset.priority=priority;
 const icon=document.createElement('i');icon.className=`bi bi-${meta.icon}`;icon.setAttribute('aria-hidden','true');
 element.replaceChildren(icon,document.createTextNode(meta.label));element.setAttribute('aria-label',`Priority: ${meta.label}`);element.title=`Priority: ${meta.label}`;
}
