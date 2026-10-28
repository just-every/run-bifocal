import {randomUUID} from 'node:crypto'
import type {Bindings} from '../../../auth.server'
import {assertion,sql,transact} from '../../../modules/import-kit/src/door/store.ts'
import {canonicalJson,sha256} from '../../../modules/import-kit/src/provenance/identity.ts'
import type {Authority} from '../../catalog/authority.server'
import {readQuery} from '../../data/snapshots/store'
import {fail} from '../../query/types'
import {freshness} from '../store.server'
import {validateDefinition} from './definition'
import {renderNativeReport} from './render'
export type NativeRun={id:string;report_id:string;revision:number;owner_version:number;manifest_json:string;created_at:string;snapshot_id:string;owner_id:string}
export async function prepareNativeReport(env:Bindings,actor:Authority,input:Record<string,unknown>){
 const {snapshot,sources,guard}=await readQuery(env,actor,actor.id,String((input.definition as Record<string,unknown>)?.queryId??''))
 if(snapshot.context.securityScope.kind!=='installation-owner')fail('native_owner_query_required',403)
 const definition=validateDefinition(input.definition,snapshot),current=await freshness(env,sources)
 if(current.stale)fail('fresh_query_snapshot_required',409)
 const reportId=typeof input.reportId==='string'&&/^[a-f0-9-]{36}$/.test(input.reportId)?input.reportId:fail('report_id_required',400)
 if(!Number.isSafeInteger(input.previousVersion)||Number(input.previousVersion)<0)fail('report_version_required',400)
 const previousVersion=Number(input.previousVersion),existing=await env.DB.prepare('SELECT owner_id,version FROM bf_native_reports WHERE id=?').bind(reportId).first<{owner_id:string;version:number}>()
 if(existing?(existing.owner_id!==actor.id||existing.version!==previousVersion):previousVersion!==0)fail('report_revision_changed',409)
 const owner=await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND role='owner' AND status='active'").bind(actor.id).first<{version:number}>()
 if(!owner)fail('owner_required',403)
 const expiresAt=String(input.expiresAt??''),expiry=Date.parse(expiresAt)
 if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+900000)fail('report_review_expired',409)
 const rendered=renderNativeReport(definition,snapshot,sources)
 const digest=sha256(canonicalJson({reportId,previousVersion,definition,snapshotDigest:snapshot.digest,sources:current.cutoffs,ownerId:actor.id,ownerVersion:owner.version,expiresAt,manifest:rendered.manifest}))
 const revisionGuard=existing?sql('EXISTS(SELECT 1 FROM bf_native_reports WHERE id=? AND owner_id=? AND version=?)',reportId,actor.id,previousVersion):sql('NOT EXISTS(SELECT 1 FROM bf_native_reports WHERE id=?)',reportId)
 const guards=[guard,revisionGuard,...current.guards,sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active' AND version=?)",actor.id,owner.version),...sources.map(source=>sql('NOT EXISTS(SELECT 1 FROM bf_preparation_erasing WHERE dataset_id=?)',source.id))]
 return {definition,reportId,previousVersion,ownerVersion:owner.version,expiresAt,rendered,digest,guards}
}
export async function saveNativeReport(env:Bindings,actor:Authority,input:Record<string,unknown>){
 const prepared=await prepareNativeReport(env,actor,input)
 if(input.reviewedDigest!==prepared.digest)fail('exact_report_review_required',409)
 const {reportId,previousVersion,definition,ownerVersion,rendered}=prepared,revision=previousVersion+1,id=randomUUID(),now=new Date().toISOString(),definitionJson=canonicalJson(definition)
 const bytes=(value:Uint8Array)=>value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength) as ArrayBuffer
 const hash=(value:Uint8Array)=>sha256(value)
 const manifest={...rendered.manifest as object,runId:id,reportId,revision,ownerId:actor.id,ownerVersion,createdAt:now,artifacts:{pdf:hash(rendered.pdf),xlsx:hash(rendered.xlsx),csv:hash(rendered.csv)},pages:rendered.pages}
 await transact(env.DB,actor,[...prepared.guards.map(assertion),...(previousVersion===0?[sql('INSERT INTO bf_native_reports(id,owner_id,version,created_at) VALUES(?,?,?,?)',reportId,actor.id,revision,now)]:[sql('UPDATE bf_native_reports SET version=? WHERE id=?',revision,reportId)]),sql('INSERT INTO bf_native_report_revisions(report_id,revision,snapshot_id,definition_json,definition_digest,created_at) VALUES(?,?,?,?,?,?)',reportId,revision,definition.queryId,definitionJson,sha256(definitionJson),now),sql('INSERT INTO bf_native_report_runs(id,report_id,revision,owner_version,manifest_json,created_at) VALUES(?,?,?,?,?,?)',id,reportId,revision,ownerVersion,canonicalJson(manifest),now),...(['pdf','xlsx','csv'] as const).map(format=>sql('INSERT INTO bf_native_report_artifacts(run_id,format,content,digest) VALUES(?,?,?,?)',id,format,bytes(rendered[format]),hash(rendered[format]))),sql('INSERT INTO bf_native_report_audit(id,run_id,actor_id,action,recorded_at) VALUES(?,?,?,?,?)',randomUUID(),id,actor.id,'reviewed-render',now)])
 return {id:reportId,version:revision,runId:id,manifest,url:'/app/report-editor?report='+reportId}
}
export async function readNativeRun(env:Bindings,actor:Authority,id:string){
 const run=await env.DB.prepare('SELECT r.*,v.snapshot_id,p.owner_id FROM bf_native_report_runs r JOIN bf_native_report_revisions v ON v.report_id=r.report_id AND v.revision=r.revision JOIN bf_native_reports p ON p.id=r.report_id WHERE r.id=? AND p.owner_id=?').bind(id,actor.id).first<NativeRun>()
 if(!run)fail('report_run_not_found',404)
 const {guard,sources}=await readQuery(env,actor,actor.id,run.snapshot_id)
 const guards=[guard,sql('EXISTS(SELECT 1 FROM bf_native_report_runs WHERE id=? AND manifest_json=?)',run.id,run.manifest_json),sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active' AND version=?)",actor.id,run.owner_version)]
 for(const source of sources)guards.push(sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=?) AND NOT EXISTS(SELECT 1 FROM bf_preparation_erasing WHERE dataset_id=?)',source.id,source.id))
 return {run,guards}
}
