import {strToU8,zlibSync} from 'fflate'
import {canonicalJson} from '../../../modules/import-kit/src/provenance/identity.ts'
import {fail} from '../../query/types'
import {bitmapGlyph} from './chart-export-font'
import {WIDTH,HEIGHT,type Snapshot} from './scene'

const ink=[20,64,115],textInk=[20,33,44]
const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let i=0;i<8;i++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0})
function chunk(type:string,data:Uint8Array){
 const bytes=new Uint8Array(data.length+12),view=new DataView(bytes.buffer);view.setUint32(0,data.length);bytes.set(strToU8(type),4);bytes.set(data,8)
 let crc=0xffffffff;for(let i=4;i<bytes.length-4;i++)crc=crcTable[(crc^bytes[i])&255]^(crc>>>8)
 view.setUint32(bytes.length-4,(crc^0xffffffff)>>>0);return bytes
}
/** A single PNG contains every reviewed page, stacked at its native width. */
export function encodePng(snapshot:Snapshot):Uint8Array{
 const width=WIDTH,height=HEIGHT*snapshot.pages.length
 if(!height||width*height>8_000_000)fail('chart_snapshot_png_pixel_limit',413)
 const pixels=new Uint8Array(width*height*3);pixels.fill(255)
 const pixel=(x:number,y:number,color:number[])=>{if(x<0||x>=width||y<0||y>=height)return;const offset=(y*width+x)*3;pixels[offset]=color[0];pixels[offset+1]=color[1];pixels[offset+2]=color[2]}
 const rect=(x:number,y:number,w:number,h:number,color:number[])=>{if(w<=0||h<=0)return;for(let py=Math.max(0,Math.floor(y));py<Math.min(height,Math.ceil(y+h));py++)for(let px=Math.max(0,Math.floor(x));px<Math.min(width,Math.ceil(x+w));px++)pixel(px,py,color)}
 const line=(a:{x:number;y:number},b:{x:number;y:number},thickness:number)=>{
  const dx=b.x-a.x,dy=b.y-a.y,count=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))))
  for(let i=0;i<=count;i++)rect(a.x+dx*i/count-thickness/2,a.y+dy*i/count-thickness/2,thickness,thickness,ink)
 }
 const polygon=(points:{x:number;y:number}[])=>{
  if(points.length<3)return
  const low=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))),high=Math.min(height-1,Math.ceil(Math.max(...points.map(p=>p.y))))
  for(let y=low;y<=high;y++){
   const intersections:number[]=[]
   for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[j],b=points[i],scan=y+.5
    if((a.y<=scan&&b.y>scan)||(b.y<=scan&&a.y>scan))intersections.push(a.x+(scan-a.y)*(b.x-a.x)/(b.y-a.y))
   }
   intersections.sort((a,b)=>a-b)
   for(let i=0;i+1<intersections.length;i+=2)rect(intersections[i],y,intersections[i+1]-intersections[i],1,ink)
  }
 }
 for(const [index,page] of snapshot.pages.entries())for(const shape of page.shapes){
  const y=shape.y+index*HEIGHT
  if(![shape.x,shape.y,shape.w,shape.h].every(Number.isFinite)||shape.x<0||shape.y<0||shape.x+shape.w>WIDTH||shape.y+shape.h>HEIGHT)fail('chart_snapshot_png_shape_outside_page',422)
  if(shape.kind==='text'){
   for(const [row,value] of shape.lines.entries()){
    if(value.length*shape.size*.6>shape.w+.01||(row+1)*shape.size*1.25>shape.h+.01)fail('chart_snapshot_png_text_does_not_fit',422)
    let x=shape.x
    for(const character of value){const glyph=bitmapGlyph(character),scale=shape.size/9;for(let column=0;column<5;column++)for(let bit=0;bit<7;bit++)if(glyph[column]&(1<<bit))rect(x+column*scale,y+row*shape.size*1.25+shape.size*.15+bit*scale,scale,scale,textInk);x+=shape.size*.6}
   }
  }else if(shape.kind==='rect')rect(shape.x,y,shape.w,shape.h,ink)
  else if(shape.kind==='ellipse'){
   const rx=shape.w/2,ry=shape.h/2
   if(rx&&ry)for(let py=Math.floor(y);py<Math.ceil(y+shape.h);py++)for(let px=Math.floor(shape.x);px<Math.ceil(shape.x+shape.w);px++)if(((px+.5-shape.x-rx)/rx)**2+((py+.5-y-ry)/ry)**2<=1)pixel(px,py,ink)
  }else if(shape.kind==='path'){
   const points=shape.points.map(p=>({x:p.x,y:p.y+index*HEIGHT}))
   if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>WIDTH||p.y<index*HEIGHT||p.y>(index+1)*HEIGHT))fail('chart_snapshot_png_shape_outside_page',422)
   if(shape.fill)polygon(points)
   if(shape.strokeWidth>0){for(let i=1;i<points.length;i++)line(points[i-1],points[i],shape.strokeWidth);if(shape.closed&&points.length)line(points[points.length-1],points[0],shape.strokeWidth)}
  }else fail('chart_snapshot_png_image_unsupported',422)
 }
 const header=new Uint8Array(13),view=new DataView(header.buffer);view.setUint32(0,width);view.setUint32(4,height);header[8]=8;header[9]=2
 const scanlines=new Uint8Array((width*3+1)*height)
 for(let row=0;row<height;row++)scanlines.set(pixels.subarray(row*width*3,(row+1)*width*3),row*(width*3+1)+1)
 const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('iTXt',strToU8('Bifocal provenance\0\0\0\0\0'+canonicalJson(snapshot.provenance))),chunk('IDAT',zlibSync(scanlines,{level:3})),chunk('IEND',new Uint8Array())]
 const output=new Uint8Array(parts.reduce((total,part)=>total+part.length,0));let offset=0;for(const part of parts){output.set(part,offset);offset+=part.length}return output
}
