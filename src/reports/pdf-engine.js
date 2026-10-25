// Loaded only inside the export worker (or the standalone PDF verification script).
import pdfMake from 'pdfmake/build/pdfmake.js';
import vfs from 'pdfmake/build/vfs_fonts.js';
pdfMake.addVirtualFileSystem(vfs);
export async function renderPdfBuffer(definition,{cjkFont}={}) {
  if(cjkFont){
    const bytes=new Uint8Array(cjkFont);let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
    pdfMake.addVirtualFileSystem({'NotoCJK.otf':btoa(binary)});
    pdfMake.addFonts({NotoCJK:{normal:'NotoCJK.otf',bold:'NotoCJK.otf',italics:'NotoCJK.otf',bolditalics:'NotoCJK.otf'}});
  }
  return pdfMake.createPdf(definition).getBuffer();
}
