import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../../auth.server'
import { sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { fileImportResponse } from '../../imports/files/server'
import { requireValue } from '../analytics/protocol'
import type { WebInput } from './input'
import type { WebSnapshot } from './read'
import type { WebMetadata } from './metadata'
/** Stage only a fully read snapshot. Original download is the normalized CSV,
 * not the upstream response; no source grant or continuation is retained. */
export async function planWeb(request:Request,env:Bindings,input:WebInput,snapshot:WebSnapshot):Promise<Response> {
 const nullValue='__BIFOCAL_NULL__'
 requireValue(snapshot.rows.every(row=>row.every(value=>value!==nullValue)),'web_reserved_null_marker',502)
 const rows=[input.fields.map(field=>field.name),...snapshot.rows]
 const csv=rows.map(row=>row.map(value=>'"'+(value===null?nullValue:value).replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n'
 requireValue(Buffer.byteLength(csv)<=524288,'web_snapshot_limit',413)
 const webSource:WebMetadata={origin:new URL(input.endpoint).origin,format:input.format,paging:input.paging,pages:snapshot.pages,fetchedAt:new Date().toISOString(),reconciliation:'reviewed-full-snapshot',deletionFeed:false,deltaAvailable:snapshot.deltaAvailable}
 const bytes=Buffer.from(JSON.stringify({version:1,datasetId:input.datasetId,filename:'web-source-snapshot.csv',data:csv,delimiter:',',encoding:'utf-8',nullValue,mode:'replace',columns:Object.fromEntries(input.fields.map(field=>[field.name,field.type])),formulaTreatment:'literal-text',webSource}))
 requireValue(bytes.length<=1048576,'web_envelope_limit',413)
 const call=async(action:string,body:unknown)=>{
  const native=new Request(new URL('/api/operator/import/'+action,env.AUTH_ORIGIN),{method:'POST',headers:{host:new URL(env.AUTH_ORIGIN).host,origin:env.AUTH_ORIGIN,cookie:request.headers.get('cookie')??'','content-type':'application/json','X-Import-Dataset':input.datasetId},body:JSON.stringify(body)})
  return (await fileImportResponse(native,env))!
 }
 const uploadId=randomUUID(),totalChunks=Math.ceil(bytes.length/65536)
 for(let index=0;index<totalChunks;index++) {
  const chunk=bytes.subarray(index*65536,(index+1)*65536),response=await call('uploads',{uploadId,name:'web-source-snapshot.json',bundleSha256:sha256(bytes),totalBytes:bytes.length,totalChunks,index,chunkSha256:sha256(chunk),base64:chunk.toString('base64')})
  if(!response.ok)return response
  await response.body?.cancel()
 }
 return call('plan',{uploadId,...(input.catchup?{catchup:true}:{})})
}
