import type { Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { machineAuthority, machineAudit } from '../credentials/store.server'
import { credentialBindings } from '../credentials/bindings.server'
import { scopedQuery } from '../models/validation/protocol'
import { intersectSources } from '../credentials/sources.server'
import { queryContext } from '../query/context'
import { queryInput } from '../query/validate'
import { execute } from '../query/execute'
import { fail } from '../query/types'
import { exactKeys } from '../models/validation/transport'

/** The exact permitted definition projection, also used for resource classification.
 * Reading this projection neither reserves an operation nor records success. */
export async function credentialDefinitions(env:Bindings,c:Awaited<ReturnType<typeof machineAuthority>>['credential']) {
 if(!c.scope.tools.includes('definitions'))fail('tool_not_permitted',403)
 const {model,view,rules}=await credentialBindings(env,c),scope=c.scope
 intersectSources({...view.query,groupBy:scope.dimensions,filters:[...view.query.filters,...view.rowRules,...scope.filters],measures:view.query.measures.filter(m=>scope.measures.includes(m.id))},rules)
 return {modelId:model.id,revision:scope.revision,viewId:scope.viewId,dimensions:scope.dimensions,measures:view.query.measures.filter(m=>scope.measures.includes(m.id)).map(m=>({id:m.id,unit:m.unit})),scopeDigest:c.digest,tools:scope.tools}
}

/** Native execution only. Transport adapters enter the registered policy door;
 * its read tools call this service once for each actual execution. */
export async function credentialOperation(env:Bindings,admission:Awaited<ReturnType<typeof machineAuthority>>,name:string,input:Record<string,unknown>={},attribution?:{agentId:string;agentName:string;sponsorName:string}){
 const {credential:c,authority}=admission,scope=c.scope
 if(!scope.tools.includes(name))fail('tool_not_permitted',403)
 const {model,view,sources,rules,fences}=await credentialBindings(env,c)
 const reserve=()=>transact(env.DB,authority,[...fences.map(assertion),assertion(sql('EXISTS(SELECT 1 FROM bf_machine_credentials WHERE id=? AND used_operations<max_operations)',c.id)),sql('UPDATE bf_machine_credentials SET used_operations=used_operations+1 WHERE id=?',c.id),machineAudit(c.id,c.owner_id,'machine','read-reserved')])
 let result:unknown
 if(name==='definitions'){
  exactKeys(input,[])
  result=await credentialDefinitions(env,c)
  await reserve()
 }else{
  exactKeys(input,['modelId','revision','viewId','groupBy','filters','offset'])
  if(input.modelId!==scope.modelId||input.revision!==scope.revision||input.viewId!==scope.viewId)fail('scope_not_permitted',403)
  const candidate=queryInput({...view.query,groupBy:input.groupBy,filters:input.filters})
  if(candidate.groupBy.some(d=>!scope.dimensions.includes(d))||candidate.filters.some(f=>!scope.dimensions.includes(f.column)))fail('dimension_not_permitted',403)
  const offset=input.offset??0
  if(!Number.isSafeInteger(offset)||Number(offset)<0)fail('invalid_page_offset',400)
  const query=intersectSources(queryInput({...scopedQuery(view,scope.revision),groupBy:candidate.groupBy,filters:[...view.query.filters,...view.rowRules,...scope.filters,...candidate.filters],measures:view.query.measures.filter(m=>scope.measures.includes(m.id))}),rules)
  const context=await queryContext(env,query,c.owner_id)
  fences.push(...context.guards??[])
  await reserve()
  const answer=execute(query,sources,context)
  if(Number(offset)>answer.rows.length)fail('invalid_page_offset',400)
  result={rows:answer.rows.slice(Number(offset),Number(offset)+25),totals:answer.totals,totalRows:answer.rows.length,offset,nextOffset:Number(offset)+25<answer.rows.length?Number(offset)+25:null,
   citations:{modelId:model.id,revision:scope.revision,viewId:scope.viewId,scopeDigest:c.digest,definitionHash:answer.definitionHash,semanticsVersion:answer.semanticsVersion,sourceWatermarks:answer.sourceWatermarks,companyRevision:context.company.revision,calendar:query.context.calendar,credentialId:c.id},
   query:{modelId:model.id,revision:scope.revision,viewId:scope.viewId,groupBy:candidate.groupBy,filters:candidate.filters,measures:scope.measures,fiscal:query.fiscal??null}}
 }
 // Recheck the reserved activation and all current bindings before releasing data.
 // No raw source count, hidden schema, credential or source text enters diagnostics.
 await transact(env.DB,authority,[...fences.map(assertion),machineAudit(c.id,c.owner_id,'machine',name,attribution)])
 return result
}
