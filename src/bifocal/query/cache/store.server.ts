import type {Bindings} from '../../../auth.server'
import type {D1Sql} from '../../../modules/import-kit/src/d1/types.ts'
import {assertion,sql,transact} from '../../../modules/import-kit/src/door/store.ts'
import {canonicalJson,sha256} from '../../../modules/import-kit/src/provenance/identity.ts'
import {prepareQuery,sourceMatch,versionContext} from '../../data/snapshots/store'
import type {Grant} from '../../explore/access.server'
import {execute} from '../execute'
import {fail,type Answer,type Context,type Query,type Source} from '../types'
import {resultKey,type CacheReceipt} from './identity'
import {executionBindings} from './bindings.server'

type Authority=D1Sql&{email:string}
type Principal={id:string;version:number;role:string}
type Entry={key:string;answer_json:string;digest:string;created_at:string}
type Result={answer:Answer;comparison?:Answer}
type Options={grant?:Grant;dependencies?:Source[];comparison?:Query;changes?:D1Sql[]}

/** Admission and response both use real native authority. Cache lookup supplies
 * computation only; it confers no right to read a source or saved answer. */
export async function saveCachedQuery(env:Bindings,authority:Authority,definition:Query,context:Context,sources:Source[],options:Options={}) {
 const principalId=context.securityScope.operatorId??context.ownerId
 const person=await env.DB.prepare(`SELECT id,version,role FROM oa_operators WHERE id=? AND status='active' AND (${authority.sql})`).bind(principalId,...authority.params??[]).first<Principal>()
 const owner=await env.DB.prepare("SELECT id,version,role FROM oa_operators WHERE id=? AND status='active' AND role='owner'").bind(context.ownerId).first<Principal>()
 if(!person||!owner)fail('cache_authority_changed',403)
 const people=[...new Map([person,owner].map(p=>[p.id,p])).values()]
 const guards=[...context.guards??[],...await executionBindings(env,context.ownerId,definition),...people.map(p=>sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND role=? AND status='active')",p.id,p.version,p.role))]
 context=versionContext({...context,guards},definition,sources)
 const dependencies=[...new Map([...sources,...options.dependencies??[]].map(s=>[s.id,s])).values()]
 const evidence=[...guards,...dependencies.map(sourceMatch)]
 await transact(env.DB,authority,evidence.map(assertion))
 const key=resultKey(definition,context,dependencies,people,options.grant?{id:options.grant.id,digest:options.grant.digest,definition:options.grant.definition}:null)
 const entry=await env.DB.prepare('SELECT key,answer_json,digest,created_at FROM bf_query_cache WHERE key=? AND owner_id=? AND principal_id=?').bind(key,context.ownerId,principalId).first<Entry>()
 const now=new Date(),age=entry?now.getTime()-Date.parse(entry.created_at):NaN
 const hit=!!entry&&Number.isFinite(age)&&age>=0&&age<86400000
 let result:Result
 if(hit){
  if(sha256(canonicalJson({key,content:entry.answer_json}))!==entry.digest)fail('cache_integrity_failed',409)
  result=JSON.parse(entry.answer_json) as Result
 }else{
  const answer=execute(definition,sources,context),comparison=options.comparison?execute(options.comparison,sources,context):undefined
  for(const value of [answer,comparison])if(value&&options.grant){value.inputRows=value.filteredRows;value.joinDiagnostics=[]}
  result={answer,...comparison?{comparison}:{}}
 }
 const createdAt=hit?entry.created_at:now.toISOString()
 const cache:CacheReceipt={status:hit?'hit':'miss',key,createdAt,ageMs:hit?Math.floor(age):0,principalId,principalVersion:person.version}
 if(options.comparison){
  if(!context.exploration||!result.comparison)fail('cache_integrity_failed',409)
  context={...context,exploration:{...context.exploration,comparison:{definition:options.comparison,answer:result.comparison}}}
 }
 const {snapshot,changes}=prepareQuery(definition,context,sources,{answer:result.answer,cache})
 const content=canonicalJson(result),digest=sha256(canonicalJson({key,content}))
 const entryGuard=sql('EXISTS(SELECT 1 FROM bf_query_cache WHERE key=? AND answer_json=? AND digest=? AND created_at=?)',key,content,digest,createdAt)
 const cacheChanges=hit?[assertion(entryGuard)]:[
  sql('DELETE FROM bf_query_cache WHERE key=?',key),
  sql('INSERT INTO bf_query_cache(key,owner_id,principal_id,answer_json,digest,created_at) VALUES(?,?,?,?,?,?)',key,context.ownerId,principalId,content,digest,createdAt),
  ...dependencies.map(s=>sql('INSERT INTO bf_query_cache_sources(cache_key,dataset_id,revision,fingerprint) VALUES(?,?,?,?)',key,s.id,s.revision,sha256(s.value_json))),
  sql('DELETE FROM bf_query_cache WHERE principal_id=? AND key NOT IN (SELECT key FROM bf_query_cache WHERE principal_id=? ORDER BY created_at DESC,key DESC LIMIT 128) AND key<>?',principalId,principalId,key)
 ]
 await transact(env.DB,authority,[...evidence.map(assertion),...cacheChanges,...changes,...options.changes??[]])
 // Prepare the returned bytes before the last async boundary. A revocation,
 // erasure or source change while the first batch completes cannot leak them.
 const response=Response.json(snapshot,{status:201,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; sandbox"}})
 await transact(env.DB,authority,[...evidence.map(assertion),assertion(entryGuard),assertion(sql('EXISTS(SELECT 1 FROM bf_query_snapshots WHERE id=? AND digest=?)',snapshot.snapshotId,snapshot.digest))])
 return response
}
