import {strToU8} from 'fflate'
import {fail} from '../../query/types'
import {canonicalJson} from '../../../modules/import-kit/src/provenance/identity.ts'
import {pdfImage} from './images.ts'
import {WIDTH,HEIGHT,type PrintableSnapshot} from './scene.ts'
const utf16=(value:string)=>'<FEFF'+Array.from(value).map(c=>{const u=c.codePointAt(0)!;return u<=65535?u.toString(16).padStart(4,'0'):[0xd800+((u-65536)>>10),0xdc00+((u-65536)&1023)].map(n=>n.toString(16).padStart(4,'0')).join('')}).join('')+'>'
function literal(value:string){const extra:Record<string,number>={'€':128,'–':150,'—':151,'‘':145,'’':146,'“':147,'”':148,'…':133};let out='(';for(const c of value){const code=extra[c]??c.charCodeAt(0);if(code>255||code<32)fail('dashboard_snapshot_pdf_font_character_unsupported',422);out+='\\'+code.toString(8).padStart(3,'0')}return out+')'}
/** Native PDF objects contain selectable text, image objects and reading tags. */
export function encodePdf(snapshot:PrintableSnapshot){
 const {width:pageWidth,height:pageHeight}=snapshot.pageSize??{width:WIDTH,height:HEIGHT}
 const objects:(Uint8Array|null)[]=[null],reserve=()=>{objects.push(null);return objects.length-1},put=(id:number,value:string|Uint8Array)=>{objects[id]=typeof value==='string'?strToU8(value):value},add=(value:string|Uint8Array)=>{const id=reserve();put(id,value);return id},stream=(dict:string,data:Uint8Array)=>{const head=strToU8('<< '+dict+' /Length '+data.length+' >>\nstream\n'),tail=strToU8('\nendstream'),all=new Uint8Array(head.length+data.length+tail.length);all.set(head);all.set(data,head.length);all.set(tail,head.length+data.length);return add(all)}
 const catalog=reserve(),pagesId=reserve(),struct=reserve(),parentTree=reserve(),font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),pageIds:number[]=[],sections:number[]=[],parents:string[]=[]
 for(const [index,page] of snapshot.pages.entries()){
  const pageId=reserve(),section=reserve(),tags:number[]=[],refs:string[]=[],annotations:number[]=[],commands:string[]=[];pageIds.push(pageId);sections.push(section)
  for(const [mcid,shape] of page.shapes.entries()){
   const tag=reserve();tags.push(tag);put(tag,'<< /Type /StructElem /S /'+(shape.kind==='text'?'P':'Figure')+' /P '+section+' 0 R /Pg '+pageId+' 0 R /K '+mcid+' /Alt '+utf16(shape.label)+' >>')
   commands.push('/'+(shape.kind==='text'?'P':'Figure')+' << /MCID '+mcid+' >> BDC')
   if(shape.kind==='text'){
    commands.push('BT /F1 '+shape.size+' Tf '+shape.x+' '+(pageHeight-shape.y-shape.size)+' Td '+(shape.size*1.25)+' TL')
    for(const [i,line] of shape.lines.entries())commands.push((i?'T* ':'')+literal(line)+' Tj')
    commands.push('ET')
    if(shape.link)annotations.push(add('<< /Type /Annot /Subtype /Link /Rect ['+[shape.x,pageHeight-shape.y-shape.h,shape.x+shape.w,pageHeight-shape.y].join(' ')+'] /Border [0 0 0] /A << /S /URI /URI '+literal(shape.link)+' >> >>'))
   }else if(shape.kind==='rect'||shape.kind==='ellipse'){
    if(shape.kind==='rect')commands.push('q 0.08 0.25 0.45 rg '+shape.x+' '+(pageHeight-shape.y-shape.h)+' '+shape.w+' '+shape.h+' re f Q')
    else{const x=shape.x+shape.w/2,y=pageHeight-shape.y-shape.h/2,rx=shape.w/2,ry=shape.h/2,k=.5522847498;commands.push('q 0.08 0.25 0.45 rg '+[x+rx,y,'m',x+rx,y+k*ry,x+k*rx,y+ry,x,y+ry,'c',x-k*rx,y+ry,x-rx,y+k*ry,x-rx,y,'c',x-rx,y-k*ry,x-k*rx,y-ry,x,y-ry,'c',x+k*rx,y-ry,x+rx,y-k*ry,x+rx,y,'c f Q'].join(' '))}
   }else{
    const image=pdfImage(shape.data),mask=image.alpha?stream('/Type /XObject /Subtype /Image /Width '+image.width+' /Height '+image.height+' /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode',image.alpha):null,id=stream('/Type /XObject /Subtype /Image /Width '+image.width+' /Height '+image.height+' /ColorSpace /'+(image.colors===1?'DeviceGray':'DeviceRGB')+' /BitsPerComponent '+image.bits+' /Filter /'+image.filter+(mask?' /SMask '+mask+' 0 R':''),image.bytes),name='Im'+mcid
    refs.push('/'+name+' '+id+' 0 R');const ratio=Math.min(shape.w/image.width,shape.h/image.height),w=image.width*ratio,h=image.height*ratio;commands.push('q '+w+' 0 0 '+h+' '+shape.x+' '+(pageHeight-shape.y-h)+' cm /'+name+' Do Q')
   }
   commands.push('EMC')
  }
  const content=stream('',strToU8(commands.join('\n')))
  put(section,'<< /Type /StructElem /S /Sect /P '+struct+' 0 R /Pg '+pageId+' 0 R /T '+utf16(page.title)+' /K ['+tags.map(t=>t+' 0 R').join(' ')+'] >>')
  parents.push(index+' ['+tags.map(t=>t+' 0 R').join(' ')+']')
  put(pageId,'<< /Type /Page /Parent '+pagesId+' 0 R /MediaBox [0 0 '+pageWidth+' '+pageHeight+'] /StructParents '+index+' /Tabs /S /Resources << /Font << /F1 '+font+' 0 R >> /XObject << '+refs.join(' ')+' >> >> /Contents '+content+' 0 R /Annots ['+annotations.map(a=>a+' 0 R').join(' ')+'] >>')
 }
 const provenance=stream('/Type /EmbeddedFile /Subtype /application#2Fjson',strToU8(canonicalJson(snapshot.provenance))),spec=add('<< /Type /Filespec /F (snapshot-provenance.json) /UF (snapshot-provenance.json) /AFRelationship /Data /EF << /F '+provenance+' 0 R >> >>')
 put(parentTree,'<< /Nums ['+parents.join(' ')+'] >>');put(struct,'<< /Type /StructTreeRoot /K ['+sections.map(id=>id+' 0 R').join(' ')+'] /ParentTree '+parentTree+' 0 R /ParentTreeNextKey '+snapshot.pages.length+' >>')
 put(pagesId,'<< /Type /Pages /Count '+pageIds.length+' /Kids ['+pageIds.map(id=>id+' 0 R').join(' ')+'] >>')
 put(catalog,'<< /Type /Catalog /Pages '+pagesId+' 0 R /Lang (en-US) /MarkInfo << /Marked true >> /StructTreeRoot '+struct+' 0 R /Names << /EmbeddedFiles << /Names [(snapshot-provenance.json) '+spec+' 0 R] >> >> /AF ['+spec+' 0 R] >>')
 const chunks:Uint8Array[]=[strToU8('%PDF-1.7\n% Bifocal native snapshot\n')],offsets=[0];let offset=chunks[0].length
 for(let id=1;id<objects.length;id++){const head=strToU8(id+' 0 obj\n'),body=objects[id]!,tail=strToU8('\nendobj\n');offsets.push(offset);chunks.push(head,body,tail);offset+=head.length+body.length+tail.length}
 const xref=offset;chunks.push(strToU8('xref\n0 '+objects.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+objects.length+' /Root '+catalog+' 0 R >>\nstartxref\n'+xref+'\n%%EOF\n'))
 const bytes=new Uint8Array(chunks.reduce((n,a)=>n+a.length,0));offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return bytes
}
