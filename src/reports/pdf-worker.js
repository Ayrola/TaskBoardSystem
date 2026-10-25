import { calculateReportMetrics } from './report-metrics.js';
import { buildPdfDocument, needsCjkFont } from './pdf-document.js';
import { renderPdfBuffer } from './pdf-engine.js';
self.onmessage=async({data})=>{
  try{
    self.postMessage({type:'progress',value:35,text:'Calculating project metrics…'});
    const metrics=calculateReportMetrics(data.snapshot);
    let cjkFont;
    if(needsCjkFont(metrics)){
      self.postMessage({type:'progress',value:45,text:'Loading embedded CJK font…'});
      const response=await fetch(new URL(`${import.meta.env.BASE_URL}fonts/NotoSansCJKsc-Regular.otf`,self.location.origin));
      if(!response.ok)throw new Error('Could not load the report font.');cjkFont=await response.arrayBuffer();
    }
    self.postMessage({type:'progress',value:60,text:'Laying out report pages and embedding fonts…'});
    const buffer=await renderPdfBuffer(buildPdfDocument(metrics,data.options),{cjkFont});
    const bytes=new Uint8Array(buffer);const output=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    self.postMessage({type:'ready',buffer:output},[output]);
  }catch(error){self.postMessage({type:'error',message:error.message||'Could not generate the PDF.'});}
};
