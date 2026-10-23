import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../../auth.server'
import { sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { fileImportResponse } from '../../imports/files/server'
import { requireValue } from './protocol'
import type { Lineage } from './lineage'
import type { Column } from '../../imports/files/csv'
export async function planSource(request: Request, env: Bindings, dataset: string, rows: string[][], columns: Record<string,Column['type']>, source: Lineage, catchup: boolean): Promise<Response> {
 const csv = rows.map(row => row.map(value => `"${value.replace(/"/g,'""')}"`).join(',')).join('\r\n')+'\r\n'
 requireValue(Buffer.byteLength(csv) <= 524288, 'source_file_limit',413)
 const bytes = Buffer.from(JSON.stringify({version:1,datasetId:dataset,filename:'analytical-source.csv',data:csv,delimiter:',',encoding:'utf-8',nullValue:'',mode:'replace',columns,formulaTreatment:'literal-text',lineage:source}))
 requireValue(bytes.length <= 1048576,'source_envelope_limit',413)
 const call = async (action: string, body: unknown) => {
  const native = new Request(new URL('/api/operator/import/'+action,env.AUTH_ORIGIN),{method:'POST',headers:{host:new URL(env.AUTH_ORIGIN).host,origin:env.AUTH_ORIGIN,cookie:request.headers.get('cookie') ?? '', 'content-type':'application/json','X-Import-Dataset':dataset},body:JSON.stringify(body)})
  return (await fileImportResponse(native,env))!
 }
 const uploadId=randomUUID(), totalChunks=Math.ceil(bytes.length/65536)
 for(let index=0;index<totalChunks;index++) {
  const chunk=bytes.subarray(index*65536,(index+1)*65536), response=await call('uploads',{uploadId,name:'analytical-source.json',bundleSha256:sha256(bytes),totalBytes:bytes.length,totalChunks,index,chunkSha256:sha256(chunk),base64:chunk.toString('base64')})
  if(!response.ok)return response
  await response.body?.cancel()
 }
 return call('plan',{uploadId,...(catchup?{catchup:true}:{})})
}
