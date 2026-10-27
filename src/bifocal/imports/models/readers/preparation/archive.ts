import { strFromU8, unzipSync } from 'fflate'
import type { FlowFile, SourceFlow } from './types'

export function prepDocuments(files:FlowFile[]):{files:FlowFile[];gaps:SourceFlow[]} {
 const decoded:FlowFile[]=[],gaps:SourceFlow[]=[]
 for(const file of files){
  if(!/\.(tfl|tflx)$/i.test(file.path)||file.content.trimStart().startsWith('{')){decoded.push(file);continue}
  let expanded=0,count=0,unsafe=false
  try{
   if(!/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)||file.content.length%4)throw Error('base64')
   const bytes=Uint8Array.from(atob(file.content),c=>c.charCodeAt(0))
   const entries=unzipSync(bytes,{filter(entry){
    expanded+=entry.originalSize;count++
    if(expanded>1048576||count>64||entry.originalSize>262144||entry.name.startsWith('/')||entry.name.includes('\\')||/[:\u0000-\u001f]/.test(entry.name)||entry.name.split('/').filter(Boolean).some(p=>p==='.'||p==='..')){unsafe=true;return false}
    return entry.name==='flow'
   }})
   if(unsafe||!entries.flow)throw Error('bounds')
   decoded.push({path:file.path+'/flow',content:strFromU8(entries.flow)})
  }catch{
   gaps.push({id:file.path,name:file.path,file:file.path,result:'archive',steps:[{id:'archive',name:'Archive',file:file.path,location:file.path,sourceExpression:'',dependencies:[],reason:'Invalid or unsafe Prep archive: require one flow member, safe relative paths and bounded expanded content. Nothing is extracted to disk.'}]})
  }
 }
 return {files:decoded,gaps}
}
