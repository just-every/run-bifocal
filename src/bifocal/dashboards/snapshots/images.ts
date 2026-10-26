import {unzlibSync,zlibSync} from 'fflate'
import {fail} from '../../query/types'
export function imageBytes(data:string){return Uint8Array.from(atob(data.split(',')[1]),v=>v.charCodeAt(0))}
export function imageType(data:string){return data.startsWith('data:image/png;')?'png':data.startsWith('data:image/jpeg;')?'jpeg':'webp'}
export type PdfImage={width:number;height:number;colors:number;bits:number;bytes:Uint8Array;filter:string;alpha?:Uint8Array}
const u32=(a:Uint8Array,i:number)=>new DataView(a.buffer,a.byteOffset,a.byteLength).getUint32(i)
export function pdfImage(data:string):PdfImage{
 const bytes=imageBytes(data),type=imageType(data)
 if(type==='webp')fail('dashboard_snapshot_pdf_webp_requires_png_or_jpeg',422)
 if(type==='jpeg'){let p=2;while(p+9<bytes.length){if(bytes[p++]!==255)continue;const marker=bytes[p++],length=(bytes[p]<<8)+bytes[p+1];if([192,193,194].includes(marker)){const colors=bytes[p+7];if(![1,3].includes(colors))fail('dashboard_snapshot_jpeg_color_unsupported',422);return {height:(bytes[p+3]<<8)+bytes[p+4],width:(bytes[p+5]<<8)+bytes[p+6],bits:bytes[p+2],colors,bytes,filter:'DCTDecode'}}if(length<2)break;p+=length}fail('dashboard_snapshot_jpeg_invalid',422)}
 const width=u32(bytes,16),height=u32(bytes,20),bits=bytes[24],color=bytes[25]
 if(bits!==8||![0,2,4,6].includes(color)||bytes[28]!==0||!width||!height||width*height>4_000_000)fail('dashboard_snapshot_png_encoding_unsupported',422)
 const channels=color===0?1:color===2?3:color===4?2:4,colors=color===0||color===4?1:3,hasAlpha=color===4||color===6,parts:Uint8Array[]=[]
 for(let p=8;p+12<=bytes.length;){const n=u32(bytes,p);if(p+n+12>bytes.length)fail('dashboard_snapshot_png_invalid',422);const kind=String.fromCharCode(...bytes.subarray(p+4,p+8));if(kind==='tRNS')fail('dashboard_snapshot_png_transparency_encoding_unsupported',422);if(kind==='IDAT')parts.push(bytes.subarray(p+8,p+8+n));p+=n+12}
 const packed=new Uint8Array(parts.reduce((n,a)=>n+a.length,0));let offset=0;for(const part of parts){packed.set(part,offset);offset+=part.length}
 const stride=width*channels,raw=unzlibSync(packed,{out:new Uint8Array((stride+1)*height)});if(raw.length!==(stride+1)*height)fail('dashboard_snapshot_png_invalid',422)
 const pixels=new Uint8Array(stride*height),paeth=(a:number,b:number,c:number)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c}
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];if(filter>4)fail('dashboard_snapshot_png_invalid',422);for(let x=0;x<stride;x++){const a=x>=channels?pixels[y*stride+x-channels]:0,b=y?pixels[(y-1)*stride+x]:0,c=y&&x>=channels?pixels[(y-1)*stride+x-channels]:0;pixels[y*stride+x]=(raw[y*(stride+1)+1+x]+(filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?paeth(a,b,c):0))&255}}
 const rgb=new Uint8Array(width*height*colors),alpha=hasAlpha?new Uint8Array(width*height):undefined;for(let p=0;p<width*height;p++){for(let c=0;c<colors;c++)rgb[p*colors+c]=pixels[p*channels+c];if(alpha)alpha[p]=pixels[p*channels+channels-1]}
 return {width,height,colors,bits:8,bytes:zlibSync(rgb),filter:'FlateDecode',...alpha?{alpha:zlibSync(alpha)}:{}}
}
