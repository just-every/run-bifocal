import { noteComposition } from '../../security/audit.server'
import type { Bindings } from '../../../auth.server'
import type { Authority } from '../../catalog/authority.server'
import { assertion, transact } from '../../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { exactKeys, json, jsonBody, privateHeaders } from '../../models/validation/transport'
import { fail } from '../../query/types'
import { readExportPolicy, exportPolicyGuard } from '../export-policy.server'
import { exportTable } from '../table-export'
import { fullExportPlan, fullExportSlice } from '../full-export'
import { readComposition, saveComposition, type Definition } from './store.server'

/** The existing exploration dispatcher owns native admission and body cleanup. */
export async function compositionResponse(request:Request,env:Bindings,actor:Authority,path:string):Promise<Response|null> {
 if(!/^\/api\/operator\/explore\/compositions(?:\/|$)/.test(path))return null
 if(actor.role!=='owner')fail('composition_owner_required',403)
 if(path==='/api/operator/explore/compositions/run') {
  if(request.method!=='POST')fail('method_not_allowed',405)
  const input=await jsonBody(request);exactKeys(input,['left','right','operation','join'])
  if(!['join','append'].includes(String(input.operation))||!['left','inner','full'].includes(String(input.join)))fail('composition_operation_required',400)
  const composition=await saveComposition(env,actor,input as unknown as Definition)
  noteComposition(request,env,composition.document.id,composition.digest,composition.subjects)
  return json(composition.document,201)
 }
 const match=/^\/api\/operator\/explore\/compositions\/([a-f0-9-]{36})(?:\/(page|export|export-plan|full-export))?$/.exec(path)
 if(!match)fail('not_found',404)
 if(request.method!==(match[2]?'POST':'GET'))fail('method_not_allowed',405)
 const composition=await readComposition(env,actor,match[1])
 noteComposition(request,env,composition.document.id,composition.digest,composition.subjects)
 if(!match[2]){await transact(env.DB,actor,composition.guards);return json(composition.document)}
 const input=await jsonBody(request);exactKeys(input,match[2]==='page'?['scope','offset']:['scope','format',...match[2]==='full-export'?['offset','planDigest']:[]])
 if(input.scope!=='summary'&&input.scope!=='underlying')fail('explicit_export_scope_required',400)
 noteComposition(request,env,composition.document.id,composition.digest,composition.subjects,{exportScope:input.scope})
 const table=input.scope==='summary'?composition.document:composition.underlying
 if(match[2]==='page') {
  if(!Number.isSafeInteger(input.offset)||Number(input.offset)<0||Number(input.offset)>table.rows.length)fail('invalid_page_offset',400)
  const offset=Number(input.offset)
  await transact(env.DB,actor,composition.guards)
  return json({columns:table.columns,rows:table.rows.slice(offset,offset+25),...(input.scope==='summary'?{valueStates:composition.document.valueStates.slice(offset,offset+25)}:{}),offset,nextOffset:offset+25<table.rows.length?offset+25:null,totalRows:table.rows.length,scope:input.scope})
 }
 if(input.format!=='csv'&&input.format!=='xlsx')fail('export_format_required',400)
 const policy=await readExportPolicy(env)
 if(input.scope==='summary'&&!composition.document.complete)fail('incomplete_summary_export_refused',409)
 const plan=fullExportPlan(composition.document.id,sha256(canonicalJson(composition.document)),input.scope,input.format,table.columns,table.rows,policy,'combined')
 if(match[2]==='export-plan') {
  await transact(env.DB,actor,[...composition.guards,assertion(exportPolicyGuard(policy))]);return json(plan)
 }
 if(match[2]==='export'&&table.rows.length>policy[input.format]) {
  await transact(env.DB,actor,[...composition.guards,assertion(exportPolicyGuard(policy))])
  return json({error:'interactive_export_cap_exceeded',totalRows:table.rows.length,cap:policy[input.format],fullExport:plan},413)
 }
 const part=match[2]==='full-export'?fullExportSlice(plan,table.rows,input.offset,input.planDigest):null
 const output=exportTable(table.columns,part?part.rows:table.rows,input.format)
 await transact(env.DB,actor,[...composition.guards,assertion(exportPolicyGuard(policy))])
 return new Response(output.body,{headers:{...privateHeaders,'content-type':output.type,'content-disposition':`attachment; filename="bifocal-combined-${input.scope}${part?'-part-'+part.partNumber:''}.${input.format}"`,'x-bifocal-row-count':String(part?part.rows.length:table.rows.length),'x-bifocal-scope':input.scope,...part?{'x-bifocal-total-rows':String(part.totalRows),'x-bifocal-offset':String(part.offset),'x-bifocal-next-offset':part.nextOffset===null?'':String(part.nextOffset),'x-bifocal-plan-digest':plan.planDigest}:{}}})
}
