import { createHmac } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import type { D1Sql } from '../../modules/import-kit/src/d1/types.ts'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import type { Snapshot } from '../data/snapshots/store'

type Head={sequence:number;hash:string;signature:string}
export type AuditEvent={actorId:string|null;delegatedCredential:string|null;tenantId:string|null;action:string;outcome:string;httpStatus?:number;queryId?:string;scope?:Record<string,unknown>;recordedAt:string}
export const fingerprint=(env:Bindings,value:unknown)=>createHmac('sha256',env.SESSION_SECRET).update('bifocal-security-v1\n'+canonicalJson(value)).digest('hex')
const genesis={sequence:0,hash:'genesis',signature:''}
const signHead=(env:Bindings,head:Pick<Head,'sequence'|'hash'>)=>fingerprint(env,{installation:env.RER_INSTALLATION_ID??env.AUTH_ORIGIN,...head})
async function head(env:Bindings):Promise<Head>{
 const value=await env.DB.prepare('SELECT sequence,hash,signature FROM bf_security_audit_head WHERE singleton=1').first<Head>()
 if(value&&value.signature!==signHead(env,{sequence:value.sequence,hash:value.hash}))throw Error('audit_head_integrity_failed')
 return value??genesis
}
const headGuard=(value:Head)=>value.sequence===0?sql('NOT EXISTS(SELECT 1 FROM bf_security_audit_head)'):sql('EXISTS(SELECT 1 FROM bf_security_audit_head WHERE singleton=1 AND sequence=? AND hash=? AND signature=?)',value.sequence,value.hash,value.signature)
/** A bounded compare-and-swap retries only a proven concurrent append. */
export async function appendAudit(env:Bindings,authority:D1Sql,event:Omit<AuditEvent,'recordedAt'>,changes:D1Sql[]=[]):Promise<void>{
 const eventJson=canonicalJson({...event,recordedAt:new Date().toISOString()})
 for(let attempt=0;attempt<8;attempt++){
  const previous=await head(env),sequence=previous.sequence+1,hash=fingerprint(env,{sequence,previousHash:previous.hash,eventJson}),signature=signHead(env,{sequence,hash})
  try{
   await transact(env.DB,authority,[assertion(headGuard(previous)),...changes,
    sql('INSERT INTO bf_security_audit(sequence,event_json,previous_hash,hash) VALUES(?,?,?,?)',sequence,eventJson,previous.hash,hash),
    sql('INSERT INTO bf_security_audit_head(singleton,sequence,hash,signature) VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET sequence=excluded.sequence,hash=excluded.hash,signature=excluded.signature',sequence,hash,signature)])
   return
  }catch(error){const current=await head(env);if(current.sequence===previous.sequence&&current.hash===previous.hash)throw error}
 }
 throw Error('audit_append_conflict')
}
export async function inspectAudit(env:Bindings,authority:D1Sql){
 const before=await head(env),events:({sequence:number;hash:string}&AuditEvent)[]=[]
 let sequence=0,previousHash='genesis',valid=true
 for(;;){
  const rows=(await env.DB.prepare('SELECT sequence,event_json,previous_hash,hash FROM bf_security_audit WHERE sequence>? ORDER BY sequence LIMIT 100').bind(sequence).all<{sequence:number;event_json:string;previous_hash:string;hash:string}>()).results
  if(!rows.length)break
  for(const row of rows){
   if(row.sequence!==sequence+1||row.previous_hash!==previousHash||row.hash!==fingerprint(env,{sequence:row.sequence,previousHash:row.previous_hash,eventJson:row.event_json}))valid=false
   try{events.push({sequence:row.sequence,hash:row.hash,...JSON.parse(row.event_json)});if(events.length>100)events.shift()}catch{valid=false}
   sequence=row.sequence;previousHash=row.hash
  }
 }
 valid=valid&&sequence===before.sequence&&previousHash===before.hash
 await transact(env.DB,authority,[assertion(headGuard(before))])
 return {valid,complete:true,head:{sequence:before.sequence,hash:before.hash},events:valid?events:[],earlierEvents:Math.max(0,sequence-100)}
}
const scopes=new WeakMap<Request,{queryId:string;scope:Record<string,unknown>}>()
export function noteQuery(request:Request,env:Bindings,snapshot:Snapshot,extra:Record<string,unknown>={}){
 const exploration=snapshot.context.exploration
 scopes.set(request,{queryId:snapshot.snapshotId,scope:{kind:snapshot.context.securityScope.kind,ownerId:snapshot.context.ownerId,
  modelId:exploration?.modelId??null,modelRevision:exploration?.revision??null,viewId:exploration?.viewId??null,grantId:exploration?.grantId??null,
  entitlementRevision:exploration?.entitlementRevision??null,entitlementDay:exploration?.entitlementDay??null,
  rowScopeDigest:fingerprint(env,{filters:snapshot.definition.filters,fiscal:snapshot.definition.fiscal??null}),queryDigest:fingerprint(env,snapshot.definition),...extra}})
}
export const queryNote=(request:Request)=>scopes.get(request)
