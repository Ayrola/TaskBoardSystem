import { fetchProjectReport, verifyReportAccess } from '../services/project-report-service.js';
import { dateInTimezone, reportFilename } from './report-metrics.js';
function workerPdf(snapshot,options,{signal,onProgress}) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./pdf-worker.js',import.meta.url),{type:'module'});
    const cleanup=()=>{worker.terminate();signal?.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(new DOMException('Export cancelled.','AbortError'));};
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{
      if(data.type==='progress')onProgress(data);
      if(data.type==='ready'){cleanup();resolve(data.buffer);}
      if(data.type==='error'){cleanup();reject(new Error(data.message));}
    };
    worker.onerror=()=>{cleanup();reject(new Error('The PDF generator could not start. Please try again.'));};
    if(signal?.aborted){abort();return;}
    worker.postMessage({snapshot,options});
  });
}
export async function downloadProjectReport(projectId,options,{signal,onProgress=()=>{}}={}) {
  let snapshot=null,buffer=null;
  try{
    signal?.throwIfAborted();onProgress({value:10,text:'Fetching a fresh project snapshot…'});
    snapshot=await fetchProjectReport(projectId,options,{signal});signal?.throwIfAborted();
    const filename=reportFilename(snapshot.project.title,dateInTimezone(snapshot.meta.as_of,options.timezone));
    buffer=await workerPdf(snapshot,options,{signal,onProgress});snapshot=null;signal?.throwIfAborted();
    if(new TextDecoder().decode(new Uint8Array(buffer,0,Math.min(5,buffer.byteLength)))!=='%PDF-')throw new Error('The generated file was not a valid PDF. Please retry.');
    onProgress({value:95,text:'Verifying project access before download…'});
    await verifyReportAccess(projectId,{signal});signal?.throwIfAborted();
    const url=URL.createObjectURL(new Blob([buffer],{type:'application/pdf'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.hidden=true;document.body.append(anchor);anchor.click();anchor.remove();
    let timer;
    const release=()=>{clearTimeout(timer);URL.revokeObjectURL(url);signal?.removeEventListener('abort',release);};
    signal?.addEventListener('abort',release,{once:true});timer=setTimeout(release,10000);
    onProgress({value:100,text:'PDF downloaded.'});
    return filename;
  }finally{snapshot=null;buffer=null;}
}
