import type { Bindings } from '../../auth.server'
import { assertion, transact } from '../../modules/import-kit/src/door/store.ts'
import { readQuery } from '../data/snapshots/store'
import { exportPolicyGuard, readExportPolicy } from '../explore/export-policy.server'
import { fullExportPlan, fullExportSlice } from '../explore/full-export'
import { exportTable } from '../explore/table-export'
import { discardBody, exactKeys, json, jsonBody, privateHeaders } from '../models/validation/transport'
import { fail } from './types'
import { retainedTable } from './export-table'

export async function retainedExportResponse(request:Request,env:Bindings,owner:Parameters<typeof readQuery>[1],ownerId:string):Promise<Response|null> {
 const path=new URL(request.url).pathname
 if(path==='/api/operator/queries/export-policy') {
  if(request.method!=='GET')fail('method_not_allowed',405)
  const policy=await readExportPolicy(env)
  await transact(env.DB,owner,[assertion(exportPolicyGuard(policy))])
  return json(policy)
 }
 const match=/^\/api\/operator\/queries\/([a-f0-9-]{36})\/(export|export-plan|full-export)$/.exec(path)
 if(!match)return null
 try {
  if(request.method!=='POST')fail('method_not_allowed',405)
  const input=await jsonBody(request);exactKeys(input,['scope','format',...(match[2]==='full-export'?['offset','planDigest']:[])])
  if(input.scope!=='summary'&&input.scope!=='underlying')fail('explicit_export_scope_required',400)
  if(input.format!=='csv'&&input.format!=='xlsx')fail('export_format_required',400)
  const {snapshot,sources,guard}=await readQuery(env,owner,ownerId,match[1]),policy=await readExportPolicy(env)
  if(input.scope==='summary'&&snapshot.answer.rows.some(row=>Object.values(row.values).some(value=>!['value','null'].includes(value.state))))fail('incomplete_summary_export_refused',409)
  const {columns,rows}=retainedTable(snapshot,sources,input.scope==='underlying')
  const plan=fullExportPlan(snapshot.snapshotId,snapshot.digest,input.scope,input.format,columns,rows,policy)
  const fences=[assertion(guard),assertion(exportPolicyGuard(policy))]
  if(match[2]==='export-plan'){await transact(env.DB,owner,fences);return json(plan)}
  if(match[2]==='export'&&rows.length>policy[input.format]){await transact(env.DB,owner,fences);return json({error:'interactive_export_cap_exceeded',totalRows:rows.length,cap:policy[input.format],fullExport:plan},413)}
  const part=match[2]==='full-export'?fullExportSlice(plan,rows,input.offset,input.planDigest):null
  const output=exportTable(columns,part?part.rows:rows,input.format)
  await transact(env.DB,owner,fences)
  return new Response(output.body,{headers:{...privateHeaders,'content-type':output.type,'content-disposition':`attachment; filename="bifocal-retained-${input.scope}${part?'-part-'+part.partNumber:''}.${input.format}"`,'x-bifocal-row-count':String(part?part.rows.length:rows.length),'x-bifocal-scope':input.scope,...part?{'x-bifocal-total-rows':String(part.totalRows),'x-bifocal-offset':String(part.offset),'x-bifocal-next-offset':part.nextOffset===null?'':String(part.nextOffset),'x-bifocal-plan-digest':plan.planDigest}:{}}})
 }finally{await discardBody(request)}
}
