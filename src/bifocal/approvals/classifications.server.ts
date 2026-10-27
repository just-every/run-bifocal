import { randomUUID } from 'node:crypto'
import { runtimeBindings, type Bindings } from '../../auth.server'
import type { D1Sql } from '../../modules/import-kit/src/d1/types.ts'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { currentAuthority } from '../catalog/authority.server'
import { uuid } from '../catalog/protocol'
import { discardBody, exactKeys, json, jsonBody } from '../models/validation/transport'
import { fail, QueryError } from '../query/types'

type Kind = 'none' | 'leadership' | 'board'
export type ClassificationReference = {operatorId:string;operatorVersion:number;revision:number;kind:Kind;expiresAt:string|null}
type Stored = {revision:number;kind:Kind;operator_version:number;expires_at:string|null}
const memberGuard = (id:string, version:number) => sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active')",id,version)
const storedGuard = (id:string, value:Stored|null) => value
 ? sql('EXISTS(SELECT 1 FROM bf_approval_classifications WHERE operator_id=? AND revision=? AND kind=? AND operator_version=? AND expires_at IS ?)',id,value.revision,value.kind,value.operator_version,value.expires_at)
 : sql('NOT EXISTS(SELECT 1 FROM bf_approval_classifications WHERE operator_id=?)',id)
const reference = (id:string, version:number, value:Stored|null):ClassificationReference => ({operatorId:id,operatorVersion:version,revision:value?.revision??0,kind:value?.kind??'none',expiresAt:value?.expires_at??null})

export async function classificationBindings(env:Bindings, ids:string[]):Promise<{references:ClassificationReference[];guards:D1Sql[]}> {
 const references:ClassificationReference[]=[], guards:D1Sql[]=[]
 for (const id of [...new Set(ids.map(uuid))].sort()) {
  const person=await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND status='active'").bind(id).first<{version:number}>()
  if(!person)fail('classification_expired_or_changed',409)
  const value=await env.DB.prepare('SELECT revision,kind,operator_version,expires_at FROM bf_approval_classifications WHERE operator_id=?').bind(id).first<Stored>()
  if(value&&value.kind!=='none'&&(value.operator_version!==person.version||!value.expires_at||!Number.isFinite(Date.parse(value.expires_at))||Date.parse(value.expires_at)<=Date.now()))fail('classification_expired_or_changed',409)
  references.push(reference(id,person.version,value))
  guards.push(memberGuard(id,person.version),storedGuard(id,value))
  if(value&&value.kind!=='none')guards.push(sql("EXISTS(SELECT 1 FROM bf_approval_classifications WHERE operator_id=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",id))
 }
 return {references,guards}
}

export async function classificationResponse(request:Request,original:Bindings):Promise<Response|null> {
 const url=new URL(request.url),prefix='/api/operator/approval-classifications'
 if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return null
 const env=runtimeBindings(original)
 try {
  if(request.headers.has('Authorization'))fail('human_session_required',403)
  const actor=await currentAuthority(request,env)
  if(!actor)fail('session_required',401)
  if(actor.role!=='owner')fail('owner_required',403)
  if(url.search)fail('query_parameters_not_supported',400)
  if(url.pathname===prefix) {
   if(request.method!=='GET')return json({error:'method_not_allowed'},405)
   const people=(await env.DB.prepare(`SELECT o.id AS operatorId,o.display_name AS displayName,o.email,o.version AS operatorVersion,
    COALESCE(c.revision,0) AS revision,COALESCE(c.kind,'none') AS kind,c.expires_at AS expiresAt,
    CASE WHEN c.operator_id IS NULL OR c.kind='none' OR c.operator_version=o.version AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE 0 END AS current
    FROM oa_operators o LEFT JOIN bf_approval_classifications c ON c.operator_id=o.id WHERE o.status='active' ORDER BY o.display_name,o.id`).all()).results
   await transact(env.DB,actor,[])
   return json({people,grantsAuthority:false})
  }
  if(url.pathname===prefix+'/audit') {
   if(request.method!=='GET')return json({error:'method_not_allowed'},405)
   const records=(await env.DB.prepare('SELECT operator_id AS operatorId,actor_id AS actorId,actor_version AS actorVersion,before_json AS beforeJson,after_json AS afterJson,recorded_at AS recordedAt FROM bf_approval_classification_audit ORDER BY recorded_at DESC,id DESC LIMIT 200').all()).results
   await transact(env.DB,actor,[])
   return json({records:records.map(record=>({...record,before:JSON.parse(String(record.beforeJson)),after:JSON.parse(String(record.afterJson)),beforeJson:undefined,afterJson:undefined}))})
  }
  const id=uuid(url.pathname.slice(prefix.length+1))
  if(request.method!=='PUT')return json({error:'method_not_allowed'},405)
  const input=await jsonBody(request)
  exactKeys(input,['previousRevision','operatorVersion','kind','expiresAt'])
  if(!Number.isSafeInteger(input.previousRevision)||Number(input.previousRevision)<0||Number(input.previousRevision)>=Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(input.operatorVersion)||Number(input.operatorVersion)<1||!['none','leadership','board'].includes(input.kind as string))fail('classification_review_required',400)
  const kind=input.kind as Kind,expiresAt=input.expiresAt
  if(kind==='none') {if(expiresAt!==null)fail('classification_expiry_required',400)}
  else {
   const expiry=typeof expiresAt==='string'?Date.parse(expiresAt):NaN,now=Date.now()
   if(!Number.isFinite(expiry)||new Date(expiry).toISOString()!==expiresAt||expiry<=now||expiry>now+7*86400000)fail('classification_expiry_required',400)
  }
  const person=await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND status='active'").bind(id).first<{version:number}>()
  if(!person||person.version!==input.operatorVersion)fail('classification_expired_or_changed',409)
  const before=await env.DB.prepare('SELECT revision,kind,operator_version,expires_at FROM bf_approval_classifications WHERE operator_id=?').bind(id).first<Stored>()
  if((before?.revision??0)!==input.previousRevision)fail('classification_revision_changed',409)
  const owner=await env.DB.prepare("SELECT version FROM oa_operators WHERE id=? AND role='owner' AND status='active'").bind(actor.id).first<{version:number}>()
  if(!owner)fail('owner_required',403)
  const after:ClassificationReference={operatorId:id,operatorVersion:person.version,revision:Number(input.previousRevision)+1,kind,expiresAt:expiresAt as string|null}
  const guards=[memberGuard(id,person.version),storedGuard(id,before),sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active' AND version=?)",actor.id,owner.version)]
  if(kind!=='none')guards.push(sql("?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",expiresAt))
  await transact(env.DB,actor,[...guards.map(assertion),sql('INSERT INTO bf_approval_classifications(operator_id,revision,kind,operator_version,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(operator_id) DO UPDATE SET revision=excluded.revision,kind=excluded.kind,operator_version=excluded.operator_version,expires_at=excluded.expires_at',id,after.revision,kind,person.version,expiresAt),sql('INSERT INTO bf_approval_classification_audit(id,operator_id,actor_id,actor_version,before_json,after_json,recorded_at) VALUES(?,?,?,?,?,?,?)',randomUUID(),id,actor.id,owner.version,canonicalJson(reference(id,before?.operator_version??person.version,before)),canonicalJson(after),new Date().toISOString())])
  return json({...after,grantsAuthority:false})
 } catch(error) {
  if(error instanceof QueryError)return json({error:error.code},error.status)
  return json({error:'classification_expired_or_changed'},409)
 } finally {await discardBody(request)}
}
