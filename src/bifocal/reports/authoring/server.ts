import {randomUUID} from 'node:crypto'
import {runtimeBindings,type Bindings} from '../../../auth.server'
import {assertion,sql,transact} from '../../../modules/import-kit/src/door/store.ts'
import {currentAuthority} from '../../catalog/authority.server'
import {discardBody,exactKeys,json,jsonBody} from '../../models/validation/transport'
import {fail,QueryError} from '../../query/types'
import {downloadNativeReport} from '../../artifacts/downloads.server'
import {prepareNativeReport,readNativeRun,saveNativeReport} from './store.server'
export async function nativeReportResponse(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),prefix='/api/operator/report-authoring'
 if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return null
 const env=runtimeBindings(original),path=url.pathname.slice(prefix.length)
 try{
  const actor=await currentAuthority(request,env)
  if(!actor)fail('session_required',401)
  if(actor.role!=='owner')fail('owner_required',403)
  if(url.search)fail('query_parameters_not_supported',400)
  if(path==='/review'||path==='/render'){
   if(request.method!=='POST')return json({error:'method_not_allowed'},405)
   const input=await jsonBody(request)
   exactKeys(input,path==='/review'?['definition','reportId','previousVersion']:['definition','reportId','previousVersion','reviewedDigest','expiresAt'])
   if(path==='/render')return json(await saveNativeReport(env,actor,input),201)
   const prepared=await prepareNativeReport(env,actor,{...input,reportId:input.reportId??randomUUID(),expiresAt:new Date(Date.now()+600000).toISOString()})
   await transact(env.DB,actor,prepared.guards.map(assertion))
   return json({reportId:prepared.reportId,previousVersion:prepared.previousVersion,definition:prepared.definition,digest:prepared.digest,expiresAt:prepared.expiresAt,manifest:prepared.rendered.manifest,pages:prepared.rendered.pages},200)
  }
  const runMatch=/^\/runs\/([a-f0-9-]{36})(?:\/(pdf|xlsx|csv))?$/.exec(path)
  if(runMatch){
   if(request.method!=='GET')return json({error:'method_not_allowed'},405)
   const {run,guards}=await readNativeRun(env,actor,runMatch[1])
   if(runMatch[2])return await downloadNativeReport(env,actor,run,guards,runMatch[2] as 'pdf'|'xlsx'|'csv')
   await transact(env.DB,actor,guards.map(assertion))
   return json({runId:run.id,reportId:run.report_id,revision:run.revision,manifest:JSON.parse(run.manifest_json)})
  }
  if(!path){
   if(request.method!=='GET')return json({error:'method_not_allowed'},405)
   const reports=(await env.DB.prepare('SELECT id,version,created_at FROM bf_native_reports WHERE owner_id=? ORDER BY created_at DESC').bind(actor.id).all()).results
   await transact(env.DB,actor,[])
   return json({reports})
  }
  const match=/^\/([a-f0-9-]{36})$/.exec(path)
  if(!match)return json({error:'not_found'},404)
  if(request.method!=='GET')return json({error:'method_not_allowed'},405)
  const report=await env.DB.prepare('SELECT * FROM bf_native_reports WHERE id=? AND owner_id=?').bind(match[1],actor.id).first<{id:string;version:number;created_at:string}>()
  if(!report)fail('report_not_found',404)
  const runs=(await env.DB.prepare('SELECT r.id,r.revision,r.created_at,v.definition_json,v.definition_digest FROM bf_native_report_runs r JOIN bf_native_report_revisions v ON v.report_id=r.report_id AND v.revision=r.revision WHERE r.report_id=? ORDER BY r.revision DESC').bind(report.id).all<{id:string;revision:number;created_at:string;definition_json:string;definition_digest:string}>()).results
  for(const item of runs){const {guards}=await readNativeRun(env,actor,item.id);await transact(env.DB,actor,guards.map(assertion))}
  await transact(env.DB,actor,[assertion(sql('EXISTS(SELECT 1 FROM bf_native_reports WHERE id=? AND version=?)',report.id,report.version))])
  return json({...report,runs:runs.map(({definition_json,...run})=>({...run,definition:JSON.parse(definition_json)}))})
 }catch(error){if(error instanceof QueryError)return json({error:error.code},error.status);return json({error:'report_review_changed',reason:'Review the current owner, query, source and report revision again.'},409)}finally{await discardBody(request)}
}
