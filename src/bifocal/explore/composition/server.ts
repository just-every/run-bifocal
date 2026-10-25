import type { Bindings } from '../../../auth.server'
import type { Authority } from '../../catalog/authority.server'
import { assertion, transact } from '../../../modules/import-kit/src/door/store.ts'
import { exactKeys, json, jsonBody, privateHeaders } from '../../models/validation/transport'
import { fail } from '../../query/types'
import { readExportPolicy, exportPolicyGuard } from '../export-policy.server'
import { exportTable } from '../table-export'
import { readComposition, saveComposition, type Definition } from './store.server'

/** The existing exploration dispatcher owns native admission and body cleanup. */
export async function compositionResponse(request:Request,env:Bindings,actor:Authority,path:string):Promise<Response|null> {
 if(!/^\/api\/operator\/explore\/compositions(?:\/|$)/.test(path))return null
 if(actor.role!=='owner')fail('composition_owner_required',403)
 if(path==='/api/operator/explore/compositions/run') {
  if(request.method!=='POST')fail('method_not_allowed',405)
  const input=await jsonBody(request);exactKeys(input,['left','right','operation','join'])
  if(!['join','append'].includes(String(input.operation))||!['left','inner','full'].includes(String(input.join)))fail('composition_operation_required',400)
  return json(await saveComposition(env,actor,input as unknown as Definition),201)
 }
 const match=/^\/api\/operator\/explore\/compositions\/([a-f0-9-]{36})(?:\/(page|export))?$/.exec(path)
 if(!match)fail('not_found',404)
 if(request.method!==(match[2]?'POST':'GET'))fail('method_not_allowed',405)
 const composition=await readComposition(env,actor,match[1])
 if(!match[2]){await transact(env.DB,actor,composition.guards);return json(composition.document)}
 const input=await jsonBody(request);exactKeys(input,match[2]==='export'?['scope','format']:['scope','offset'])
 if(input.scope!=='summary'&&input.scope!=='underlying')fail('explicit_export_scope_required',400)
 const table=input.scope==='summary'?composition.document:composition.underlying
 if(match[2]==='page') {
  if(!Number.isSafeInteger(input.offset)||Number(input.offset)<0||Number(input.offset)>table.rows.length)fail('invalid_page_offset',400)
  const offset=Number(input.offset)
  await transact(env.DB,actor,composition.guards)
  return json({columns:table.columns,rows:table.rows.slice(offset,offset+25),...(input.scope==='summary'?{valueStates:composition.document.valueStates.slice(offset,offset+25)}:{}),offset,nextOffset:offset+25<table.rows.length?offset+25:null,totalRows:table.rows.length,scope:input.scope})
 }
 if(input.format!=='csv'&&input.format!=='xlsx')fail('export_format_required',400)
 const policy=await readExportPolicy(env)
 if(table.rows.length>policy[input.format])fail('full_export_unavailable',413)
 if(input.scope==='summary'&&!composition.document.complete)fail('incomplete_summary_export_refused',409)
 const output=exportTable(table.columns,table.rows,input.format)
 await transact(env.DB,actor,[...composition.guards,assertion(exportPolicyGuard(policy))])
 return new Response(output.body,{headers:{...privateHeaders,'content-type':output.type,'content-disposition':`attachment; filename="bifocal-combined-${input.scope}.${input.format}"`,'x-bifocal-row-count':String(table.rows.length),'x-bifocal-scope':input.scope}})
}
