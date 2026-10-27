import { randomUUID } from 'node:crypto'
import { operatorAuth, runtimeBindings, type Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { ownerIdentity, prepareQuery, readSources, sourceMatch } from '../data/snapshots/store'
import { fileOwner } from '../imports/files/owner.server'
import { discardBody, exactKeys, json, jsonBody } from '../models/validation/transport'
import { queryContext } from '../query/context'
import { execute } from '../query/execute'
import { fail, QueryError } from '../query/types'
import { chartPage } from './page.server'
import { chartDocument } from './protocol'
import { readChart } from './store.server'
import { chartStyles } from './styles'
import {currentAuthority} from '../catalog/authority.server'
import {subject} from '../collaboration/subjects.server'

export async function chartResponse(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname
 if(path==='/bifocal/charts.css')return ['GET','HEAD'].includes(request.method)?new Response(request.method==='HEAD'?null:chartStyles,{headers:{'content-type':'text/css; charset=utf-8','x-content-type-options':'nosniff'}}):new Response(null,{status:405})
 const definition=/^\/api\/operator\/chart-definitions\/(review|create)$/.exec(path),saved=/^\/(api\/operator|app)\/charts\/([a-f0-9-]{36})$/.exec(path)
 if(!definition&&!saved)return null
 const env=runtimeBindings(original)
 try {
  let owner=await fileOwner(request,env),ownerId:string,delegated=false
  if(!owner){
   const actor=saved?await currentAuthority(request,env):null
   if(!actor)return json({error:'owner_required'},401)
   let target
   try{target=await subject(env,actor,'chart',saved![2])}
   catch(error){if(error instanceof QueryError&&error.status===404)return json({error:'owner_required'},401);throw error}
   const checks=[actor,...target.guards]
   owner={email:actor.email,...sql(checks.map(check=>'('+check.sql+')').join(' AND '),...checks.flatMap(check=>check.params??[]))}
   ownerId=target.ownerId;delegated=true
  }else ownerId=await ownerIdentity(env,owner)
  if(url.search)fail('query_parameters_not_supported',400)
  if(saved) {
   if(request.method!=='GET')fail('method_not_allowed',405)
   const chart=await readChart(env,owner,ownerId,saved[2])
   if(delegated){chart.answer.inputRows=chart.answer.filteredRows;chart.answer.joinDiagnostics=[]}
   if(saved[1]==='app') {
    const session=await operatorAuth(env).getSession(request)
    if(!session)fail('owner_required',401)
    return chartPage(chart,session.operator)
   }
   return json(chart)
  }
  if(request.method!=='POST')fail('method_not_allowed',405)
  const input=await jsonBody(request);exactKeys(input,['document','reviewedDigest'])
  const document=chartDocument(input.document),context=await queryContext(env,document.definition,ownerId),sources=await readSources(env,document.definition)
  const guards=[...context.guards??[],...sources.map(sourceMatch)],digest=sha256(canonicalJson({ownerId,kind:'chart',document,guards}))
  if(definition![1]==='review') {
   const answer=execute(document.definition,sources,context)
   await transact(env.DB,owner,guards.map(assertion))
   return json({document,digest,answer})
  }
  if(input.reviewedDigest!==digest)fail('exact_current_chart_review_required',409)
  const {snapshot,changes}=prepareQuery(document.definition,context,sources),id=randomUUID(),createdAt=new Date().toISOString()
  await transact(env.DB,owner,[...changes,sql('INSERT INTO bf_charts(id,snapshot_id,title,visual_json,owner_id,created_at) VALUES(?,?,?,?,?,?)',id,snapshot.snapshotId,document.title,canonicalJson(document.visual),ownerId,createdAt)])
  return json({id,title:document.title,visual:document.visual,...snapshot,createdAt},201)
 }catch(error){if(error instanceof QueryError)return json({error:error.code},error.status);return json({error:'chart_conflict'},409)}finally{await discardBody(request)}
}
