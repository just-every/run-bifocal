import { randomUUID } from 'node:crypto'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { certifiedReportMetric } from '../catalog/certification.server'
import { currentAuthority } from '../catalog/authority.server'
import { text, uuid } from '../catalog/protocol'
import { readQuery } from '../data/snapshots/store'
import { discardBody, exactKeys, json, jsonBody } from '../models/validation/transport'
import { fail, QueryError } from '../query/types'
import { downloadReport, issueDownload } from '../artifacts/downloads.server'
import { freshness, readRun, render, reportAudit, runGuard } from './store.server'
import { sendReport } from './transport.server.mjs'
import { artifactCustody, reviewerAccess } from './grant-access.server'
import { grantAudit } from './grant-audit.server'
import { reportGrantResponse, reviewerDetails } from './grants.server'
import { fencePending, pendingRecipients, recipientDefinitions, recipientMember } from './recipients.server'

export async function reportCustodyResponse(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),prefix='/api/operator/report-runs'
 if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return null
 const env=runtimeBindings(original),path=url.pathname.slice(prefix.length)
 try{
  const actor=await currentAuthority(request,env)
  if(!actor){await discardBody(request);return json({error:'session_required'},401)}
  const grantResponse=await reportGrantResponse(request,env,actor,path)
  if(grantResponse)return grantResponse
  if(actor.role!=='owner'&&!(request.method==='GET'&&/^\/[a-f0-9-]{36}(?:\/download)?$/.test(path)))fail('owner_required',403)
  if(path!=='/retention'&&path!=='/series'&&url.search&&!/^\/[a-f0-9-]{36}\/download$/.test(path))fail('query_parameters_not_supported',400)
  if(path==='/retention'){
   const policy=await env.DB.prepare('SELECT * FROM bf_report_retention WHERE owner_id=?').bind(actor.id).first<{version:number;days:number|null}>()
   if(request.method==='GET'){await transact(env.DB,actor,[]);return json({version:policy?.version??0,days:policy?.days??null,default:'retain until owner erases',automaticErasure:false})}
   if(request.method!=='PUT')return json({error:'method_not_allowed'},405)
   const input=await jsonBody(request);exactKeys(input,['previousVersion','days','consent'])
   if(input.previousVersion!==(policy?.version??0)||input.consent!==true||input.days!==null&&(!Number.isSafeInteger(input.days)||Number(input.days)<1||Number(input.days)>3650))fail('exact_retention_consent_required',409)
   const guard=policy?sql('EXISTS(SELECT 1 FROM bf_report_retention WHERE owner_id=? AND version=?)',actor.id,policy.version):sql('NOT EXISTS(SELECT 1 FROM bf_report_retention WHERE owner_id=?)',actor.id)
   await transact(env.DB,actor,[assertion(guard),sql('INSERT INTO bf_report_retention(owner_id,version,days,consented_at) VALUES(?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET version=excluded.version,days=excluded.days,consented_at=excluded.consented_at',actor.id,(policy?.version??0)+1,input.days,new Date().toISOString()),sql('INSERT INTO bf_report_retention_audit(owner_id,actor_id,version,days,consented_at) VALUES(?,?,?,?,?)',actor.id,actor.id,(policy?.version??0)+1,input.days,new Date().toISOString())])
   return json({version:(policy?.version??0)+1,days:input.days,appliesTo:'new runs; existing artifacts retain their reviewed cutoff',automaticErasure:false})
  }
  if(path==='/series'){
   if(request.method!=='POST')return json({error:'method_not_allowed'},405)
   const input=await jsonBody(request);exactKeys(input,['period'])
   const period=text(input.period,8),match=/^\d{4}-W(\d{2})$/.exec(period)
   if(!match||Number(match[1])<1||Number(match[1])>53)fail('iso_week_required',400)
   const id=randomUUID();await transact(env.DB,actor,[sql('INSERT INTO bf_report_series(id,owner_id,period) VALUES(?,?,?)',id,actor.id,period)])
   return json({id,period},201)
  }
  if(!path){
   if(request.method!=='POST')return json({error:'method_not_allowed'},405)
   const input=await jsonBody(request);exactKeys(input,['seriesId','queryId','title','narrative','corrects','audience','acceptStale','retentionVersion','metricRef','pendingRecipients'])
   const seriesId=uuid(input.seriesId),queryId=uuid(input.queryId),title=text(input.title),narrative=input.narrative===''?'':text(input.narrative,4000)
   if(typeof input.acceptStale!=='boolean'||!Array.isArray(input.audience)||input.audience.length!==1||input.audience[0]!==actor.id)fail('current_owner_only_snapshot_scope',403)
   const series=await env.DB.prepare('SELECT period,next_revision FROM bf_report_series WHERE id=? AND owner_id=?').bind(seriesId,actor.id).first<{period:string;next_revision:number}>()
   if(!series)fail('report_series_not_found',404)
   const latest=await env.DB.prepare('SELECT id FROM bf_report_runs WHERE series_id=? ORDER BY revision DESC LIMIT 1').bind(seriesId).first<{id:string}>()
   if((latest?.id??null)!==input.corrects)fail('explicit_correction_relation_required',409)
   const policy=await env.DB.prepare('SELECT version,days FROM bf_report_retention WHERE owner_id=?').bind(actor.id).first<{version:number;days:number|null}>()
   if(input.retentionVersion!==(policy?.version??0))fail('current_retention_review_required',409)
   const {snapshot,sources,guard}=await readQuery(env,actor,actor.id,queryId),current=await freshness(env,sources)
   const metric=await certifiedReportMetric(env,actor,input.metricRef,snapshot.definition)
   if(current.stale&&!input.acceptStale)fail('fresh_snapshot_required',409)
   const pending=await recipientDefinitions(env,input.pendingRecipients===undefined?[]:input.pendingRecipients)
   const id=randomUUID(),createdAt=new Date().toISOString(),retainUntil=policy?.days?new Date(Date.now()+policy.days*86400000).toISOString():null
   await transact(env.DB,actor,[assertion(guard),assertion(metric.guard),...current.guards.map(assertion),...pending.map(recipientMember).map(assertion),assertion(sql('EXISTS(SELECT 1 FROM bf_report_series WHERE id=? AND owner_id=? AND next_revision=?)',seriesId,actor.id,series.next_revision)),assertion(policy?sql('EXISTS(SELECT 1 FROM bf_report_retention WHERE owner_id=? AND version=?)',actor.id,policy.version):sql('NOT EXISTS(SELECT 1 FROM bf_report_retention WHERE owner_id=?)',actor.id)),sql("INSERT INTO bf_report_runs(id,series_id,owner_id,revision,corrects,period,snapshot_id,state,request_json,retain_until,created_at) VALUES(?,?,?,?,?,?,?,'queued',?,?,?)",id,seriesId,actor.id,series.next_revision,input.corrects,series.period,snapshot.snapshotId,canonicalJson({title,narrative,acceptStale:input.acceptStale,audience:[actor.id],metricRef:metric.reference}),retainUntil,createdAt),...pending.map(p=>sql('INSERT INTO bf_report_pending_recipients(run_id,reviewer_id,reviewer_version) VALUES(?,?,?)',id,p.reviewerId,p.reviewerVersion)),sql('UPDATE bf_report_series SET next_revision=next_revision+1 WHERE id=?',seriesId)])
   return json({id,seriesId,period:series.period,revision:series.next_revision,corrects:input.corrects,state:'queued',version:1,reviewUrl:'/app/report-runs/'+id},201)
  }
  const match=/^\/([a-f0-9-]{36})(?:\/(render|approve|send|download-link|download|cancel|purge|recipients))?$/.exec(path)
  if(!match)return json({error:'not_found'},404)
  const run=await readRun(env,actor,match[1]),operation=match[2]
  if(!operation){
   if(request.method!=='GET')return json({error:'method_not_allowed'},405)
   if(actor.role!=='owner'){
    const guards=await artifactCustody(env,actor,run),access=await reviewerDetails(env,actor,run)
    await transact(env.DB,actor,[assertion(runGuard(run)),...guards.map(assertion),assertion(reviewerAccess(actor,run.id,access.grantId)),...grantAudit(actor,run,'reviewer-read',actor.id,access.grantId)])
    return json({id:run.id,seriesId:run.series_id,revision:run.revision,corrects:run.corrects,period:run.period,state:run.state,version:run.version,artifact:JSON.parse(run.artifact_json!),digest:run.artifact_digest,retainUntil:run.retain_until,createdAt:run.created_at,access})
   }
   const dispatches=(await env.DB.prepare('SELECT id,artifact_digest,recipient_id,outcome,provider,provider_reference,recorded_at FROM bf_report_dispatches WHERE run_id=? ORDER BY recorded_at,id').bind(run.id).all()).results
   const claims=(await env.DB.prepare('SELECT id,artifact_digest,recipient_id,created_at FROM bf_report_dispatch_claims WHERE run_id=?').bind(run.id).all()).results
   const audit=(await env.DB.prepare('SELECT actor_id,action,version,recorded_at FROM bf_report_audit WHERE run_id=? ORDER BY recorded_at,id').bind(run.id).all()).results
   const pending=await pendingRecipients(env,run.id),grantHistory=(await env.DB.prepare('SELECT grant_id,actor_id,reviewer_id,artifact_digest,action,recorded_at FROM bf_report_grant_audit WHERE run_id=? ORDER BY recorded_at,id').bind(run.id).all()).results
   await transact(env.DB,actor,[assertion(runGuard(run))])
   return json({id:run.id,seriesId:run.series_id,revision:run.revision,corrects:run.corrects,period:run.period,state:run.state,version:run.version,artifact:run.artifact_json?JSON.parse(run.artifact_json):null,digest:run.artifact_digest,retainUntil:run.retain_until,createdAt:run.created_at,access:{kind:'owner',readOnly:false},pendingRecipients:pending,grantAudit:grantHistory,dispatches,claims,audit,externalCopies:dispatches.some(f=>['accepted','uncertain'].includes(String(f.outcome)))?'Previously accepted or possibly submitted external copies cannot be recalled. Provider acceptance is not mailbox delivery.':null})
  }
  if(operation==='download'){
   if(request.method!=='GET')return json({error:'method_not_allowed'},405)
   if([...url.searchParams.keys()].some(key=>key!=='token')||url.searchParams.getAll('token').length>1)fail('download_token_required',400)
   return await downloadReport(env,actor,run,url.searchParams.get('token'))
  }
  if(operation==='recipients'){
   if(request.method!=='PUT')return json({error:'method_not_allowed'},405)
   const input=await jsonBody(request);exactKeys(input,['previousVersion','reviewerIds'])
   if(input.previousVersion!==run.version||run.state!=='queued')fail('queued_report_review_required',409)
   const pending=await recipientDefinitions(env,input.reviewerIds),existing=await pendingRecipients(env,run.id),removed=existing.some(value=>!pending.some(next=>next.reviewerId===value.reviewerId))
   if(removed){
    await transact(env.DB,actor,[assertion(runGuard(run)),sql("UPDATE bf_report_runs SET state='cancelled',request_json=NULL,artifact_json=NULL,artifact_digest=NULL,approval_json=NULL,version=version+1 WHERE id=?",run.id),reportAudit(actor,run,'pending-recipient-removed-cancelled')])
    return json({id:run.id,state:'cancelled',version:run.version+1,pendingRecipients:[],grantsAuthority:false,historicalDispatchesUnchanged:true})
   }
   await transact(env.DB,actor,[assertion(runGuard(run)),...pending.map(recipientMember).map(assertion),sql('DELETE FROM bf_report_pending_recipients WHERE run_id=?',run.id),...pending.map(p=>sql('INSERT INTO bf_report_pending_recipients(run_id,reviewer_id,reviewer_version) VALUES(?,?,?)',run.id,p.reviewerId,p.reviewerVersion)),sql('UPDATE bf_report_runs SET version=version+1 WHERE id=?',run.id),reportAudit(actor,run,'pending-recipients-reviewed')])
   return json({id:run.id,version:run.version+1,pendingRecipients:pending,grantsAuthority:false})
  }
  if(request.method!=='POST')return json({error:'method_not_allowed'},405)
  const input=await jsonBody(request)
  if(operation==='render'){exactKeys(input,[]);return json(await render(env,actor,run))}
  if(operation==='download-link'){exactKeys(input,['expiresAt']);return json(await issueDownload(env,actor,run,input.expiresAt),201)}
  if(operation==='cancel'||operation==='purge'){
   exactKeys(input,['previousVersion'])
   if(input.previousVersion!==run.version||operation==='cancel'&&!['queued','rendered','approved'].includes(run.state)||operation==='purge'&&(!run.retain_until||Date.parse(run.retain_until)>Date.now()))fail('reviewed_pending_or_expired_report_required',409)
   await transact(env.DB,actor,[assertion(runGuard(run)),sql("UPDATE bf_report_runs SET state=?,request_json=NULL,artifact_json=NULL,artifact_digest=NULL,approval_json=NULL,version=version+1 WHERE id=?",operation==='cancel'?'cancelled':'erased',run.id),sql('DELETE FROM bf_report_downloads WHERE run_id=?',run.id),reportAudit(actor,run,operation)])
   return json({id:run.id,state:operation==='cancel'?'cancelled':'erased',historicalDispatchesUnchanged:true})
  }
  exactKeys(input,['digest','previousVersion'])
  const pending=await fencePending(env,actor,run)
  if(input.digest!==run.artifact_digest||input.previousVersion!==run.version||!run.artifact_json||!run.snapshot_id||run.retain_until&&Date.parse(run.retain_until)<=Date.now())fail('exact_retained_report_review_required',409)
  const {guard,sources,snapshot}=await readQuery(env,actor,actor.id,run.snapshot_id),current=await freshness(env,sources),artifact=JSON.parse(run.artifact_json)
  const metric=await certifiedReportMetric(env,actor,artifact.metricRef,snapshot.definition)
  if(canonicalJson(current.cutoffs)!==canonicalJson(artifact.observedSources))fail('source_changed_after_render_create_revision',409)
  const member=await env.DB.prepare("SELECT version,email FROM oa_operators WHERE id=? AND role='owner' AND status='active'").bind(actor.id).first<{version:number;email:string}>()
  if(!member)fail('owner_required',401)
  const memberGuard=sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active' AND version=?)",actor.id,member.version)
  if(operation==='approve'){
   if(run.state!=='rendered')fail('rendered_report_required',409)
   const approval={actorId:actor.id,operatorVersion:member.version,digest:run.artifact_digest,reviewedAt:new Date().toISOString()}
   await transact(env.DB,actor,[assertion(runGuard(run)),assertion(pending),assertion(guard),assertion(metric.guard),assertion(memberGuard),...current.guards.map(assertion),sql("UPDATE bf_report_runs SET state='approved',approval_json=?,version=version+1 WHERE id=?",canonicalJson(approval),run.id),reportAudit(actor,run,'approved')])
   return json({id:run.id,state:'approved',version:run.version+1,digest:run.artifact_digest})
  }
  if(run.state!=='approved'||!run.approval_json)fail('exact_approved_report_required',409)
  const approval=JSON.parse(run.approval_json)
  if(approval.actorId!==actor.id||approval.operatorVersion!==member.version||approval.digest!==run.artifact_digest)fail('approval_authority_changed',409)
  if(env.AUTH_LOCAL!=='true'&&env.RER_DEMO!=='1'&&(env.MAIL_PROVIDER!=='sendgrid'||!env.MAIL_API_KEY||!env.MAIL_FROM))fail('configured_sendgrid_transport_required',503)
  const claimId=randomUUID()
  await transact(env.DB,actor,[assertion(runGuard(run)),assertion(pending),assertion(guard),assertion(metric.guard),assertion(memberGuard),...current.guards.map(assertion),sql('INSERT INTO bf_report_dispatch_claims(id,run_id,artifact_digest,owner_id,recipient_id,recipient_version,created_at) VALUES(?,?,?,?,?,?,?)',claimId,run.id,run.artifact_digest,actor.id,actor.id,member.version,new Date().toISOString()),sql("UPDATE bf_report_runs SET state='dispatching',version=version+1 WHERE id=?",run.id),reportAudit(actor,run,'dispatch-claimed')])
  // The claim is the dispatch boundary. Erasure after it discloses an in-flight
  // external exception. No queued claim is retried automatically after restart.
  let result
  try{result=await sendReport(env,claimId,member.email,run.artifact_json)}catch{result={provider:'sendgrid',status:'uncertain',providerMessageId:null}}
  const outcome=['accepted','rejected','development'].includes(result.status)?result.status:'uncertain'
  const claimGuard=sql('EXISTS(SELECT 1 FROM bf_report_dispatch_claims WHERE id=? AND run_id=? AND artifact_digest=?)',claimId,run.id,run.artifact_digest)
  // Record an already attempted outcome even if custody or actor access was
  // revoked during HTTP; this writes only the immutable redacted dispatch fact.
  await transact(env.DB,claimGuard,[sql('INSERT INTO bf_report_dispatches(id,run_id,artifact_digest,owner_id,recipient_id,recipient_version,outcome,provider,provider_reference,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)',claimId,run.id,run.artifact_digest,actor.id,actor.id,member.version,outcome,result.provider,result.providerMessageId,new Date().toISOString()),sql("UPDATE bf_report_runs SET state=CASE WHEN artifact_json IS NULL THEN 'erased' ELSE ? END,version=version+1 WHERE id=?",outcome,run.id)])
  await transact(env.DB,actor,[])
  return json({id:run.id,outcome,provider:result.provider,providerReference:result.providerMessageId,delivered:false,automaticReplay:false})
 }catch(error){if(error instanceof QueryError)return json({error:error.code},error.status);return json({error:'report_custody_conflict',reason:'The current session, retained source, report revision or exact review changed. No new unreviewed dispatch was authorized.'},409)}finally{await discardBody(request)}
}
