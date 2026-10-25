import html from './report-export-modal.html?raw';
import '../task-dialog.css';
import { mountModal } from '../../utils/modal-host.js';
import { REPORT_SECTIONS, dateInTimezone, addDays, validateReportOptions } from '../../reports/report-metrics.js';
export function openReportExportModal({projectId,timezone,days=30}) {
  let controller=null,busy=false;
  const modal=mountModal(html,{onRelease:()=>controller?.abort()});
  const {element,signal}=modal,form=element.querySelector('form'),error=element.querySelector('[data-error]'),download=element.querySelector('[data-download]');
  form.elements.period.value=String(days);
  const today=dateInTimezone(new Date(),timezone);form.elements.start.value=addDays(today,-29);form.elements.end.value=today;form.elements.end.max=today;form.elements.start.max=today;
  element.querySelector('[data-timezone]').textContent=`Timezone: ${timezone}. PDF stays on your device; it is not uploaded.`;
  for(const [key,title] of Object.entries(REPORT_SECTIONS)){
    const col=document.createElement('div');col.className='col-12 col-sm-6';const label=document.createElement('label');label.className='form-check';
    const input=document.createElement('input');input.className='form-check-input';input.type='checkbox';input.name='sections';input.value=key;input.checked=true;
    const text=document.createElement('span');text.className='form-check-label small';text.textContent=title;label.append(input,text);col.append(label);element.querySelector('[data-sections]').append(col);
  }
  modal.setCanClose(()=>!busy);
  const progress=({value,text})=>{element.querySelector('[data-progress-wrap]').hidden=false;element.querySelector('[data-progress]').value=value;element.querySelector('[data-progress-text]').textContent=text;};
  form.elements.period.addEventListener('change',()=>{element.querySelector('[data-custom]').hidden=form.elements.period.value!=='custom';},{signal});
  element.querySelector('[data-cancel]').addEventListener('click',()=>{if(busy){controller?.abort();progress({value:0,text:'Export cancelled. Your options are preserved.'});}else modal.close(false);},{signal});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;error.hidden=true;
    const options={period:form.elements.period.value,start:form.elements.start.value,end:form.elements.end.value,sections:[...form.querySelectorAll('input[name="sections"]:checked')].map(i=>i.value),paper:form.elements.paper.value,timezone};
    try{validateReportOptions(options);}catch(failure){error.textContent=failure.message;error.hidden=false;return;}
    controller?.abort();controller=new AbortController();busy=true;download.disabled=true;element.setAttribute('aria-busy','true');
    form.querySelectorAll('input,select,.btn-close').forEach(i=>{i.disabled=true;});element.querySelector('[data-cancel]').textContent='Cancel generation';progress({value:0,text:'Starting report…'});
    try{
      const {downloadProjectReport}=await import('../../reports/report-export.js');
      await downloadProjectReport(projectId,options,{signal:controller.signal,onProgress:progress});
    }catch(failure){if(!signal.aborted&&failure.name!=='AbortError'){error.textContent=failure.message;error.hidden=false;progress({value:0,text:'Export failed. Retry with the same options.'});}}
    finally{busy=false;download.disabled=false;element.setAttribute('aria-busy','false');form.querySelectorAll('input,select,.btn-close').forEach(i=>{i.disabled=false;});element.querySelector('[data-cancel]').textContent='Close';}
  },{signal});
  element.addEventListener('shown.bs.modal',()=>form.elements.period.focus(),{signal});
  modal.show();return{result:modal.result,destroy:modal.destroy};
}
