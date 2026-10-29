import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import type { Authority } from '../catalog/authority.server'
import type { Table } from '../imports/files/csv'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { exactKeys, json, jsonBody } from '../models/validation/transport'
import { readDefinition, readModel, modelGuard } from '../models/validation/store.server'
import { fail, type Filter, type Source } from '../query/types'
import { sourceMatch } from '../data/snapshots/store'

type Definition={modelId:string;viewId:string;column:string;mapping:string;hierarchy:string|null;normalization:'exact'|'ascii-lowercase';maxAgeSeconds:number}
type Reference={id:string;revision:string;digest:string}
type Stored={owner_id:string;model_id:string;view_id:string;revision:number;document_json:string;digest:string}
type Document={definition:Definition;sources:Reference[]}
const normalize=(value:string,mode:Definition['normalization'])=>mode==='exact'?value:value.replace(/[A-Z]/g,c=>c.toLowerCase())
const key=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9._@+-]{1,254}$/.test(value)
const date=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value
function definitionInput(value:unknown):Definition {
 if(!value||typeof value!=='object'||Array.isArray(value))fail('entitlement_definition_required',400)
 const v=value as Record<string,unknown>
 exactKeys(v,['modelId','viewId','column','mapping','hierarchy','normalization','maxAgeSeconds'])
 if(!['modelId','viewId','column','mapping'].every(k=>key(v[k]))||!(v.hierarchy===null||key(v.hierarchy))||!['exact','ascii-lowercase'].includes(String(v.normalization))||!Number.isSafeInteger(v.maxAgeSeconds)||Number(v.maxAgeSeconds)<1||Number(v.maxAgeSeconds)>604800)fail('invalid_entitlement_definition',400)
 return v as unknown as Definition
}
const policyGuard=(owner:string,model:string,view:string,revision:number|null)=>revision===null
 ?sql('NOT EXISTS(SELECT 1 FROM bf_entitlement_snapshots WHERE owner_id=? AND model_id=? AND view_id=?)',owner,model,view)
 :sql('EXISTS(SELECT 1 FROM bf_entitlement_snapshots WHERE owner_id=? AND model_id=? AND view_id=? AND revision=?)',owner,model,view,revision)
async function stored(env:Bindings,owner:string,model:string,view:string){return env.DB.prepare('SELECT * FROM bf_entitlement_snapshots WHERE owner_id=? AND model_id=? AND view_id=?').bind(owner,model,view).first<Stored>()}
async function source(env:Bindings,id:string){
 const row=await env.DB.prepare('SELECT id,revision,value_json FROM bf_file_tables WHERE id=?').bind(id).first<Omit<Source,'table'>>()
 if(!row)fail('entitlement_feed_missing',409)
 return {...row,table:JSON.parse(row.value_json) as Table}
}
function records(s:Source,columns:string[]){
 const indexes=columns.map(name=>s.table.columns.findIndex(c=>c.name===name))
 if(indexes.some(i=>i<0))fail('entitlement_columns_required',400)
 return s.table.rows.map(row=>indexes.map(i=>row[i]))
}
function evaluate(def:Definition,sources:Source[],principal:string,now:Date){
 const day=now.toISOString().slice(0,10),mode=def.normalization
 const active=(from:unknown,until:unknown)=>{
  if(!date(from)||(until!==null&&!date(until))||until!==null&&String(until)<=String(from))fail('invalid_entitlement_interval',400)
  return String(from)<=day&&(until===null||day<String(until))
 }
 const expiresAt=Math.min(...sources.map(s=>Date.parse(s.table.updatedAt)+def.maxAgeSeconds*1000))
 if(!Number.isFinite(expiresAt)||expiresAt<=now.getTime())fail('entitlement_feed_stale',409)
 const parents=new Map<string,string>()
 if(def.hierarchy){for(const [employee,manager,from,until] of records(sources[1],['principal','manager','valid_from','valid_until'])){
  if(!key(employee)||!key(manager))fail('invalid_entitlement_principal',400)
  if(!active(from,until))continue
  const child=normalize(employee,mode),parent=normalize(manager,mode)
  if(parents.has(child))fail('ambiguous_entitlement_hierarchy',409)
  parents.set(child,parent)
 }}
 for(const start of parents.keys()){
  const seen=new Set<string>();let current:string|undefined=start
  while(current!==undefined){if(seen.has(current))fail('cyclic_entitlement_hierarchy',409);seen.add(current);current=parents.get(current)}
 }
 const values=new Set<string>(),roles=new Set<string>(),identity=normalize(principal,mode)
 for(const [person,role,value,from,until] of records(sources[0],['principal','role','value','valid_from','valid_until'])){
  if(!key(person)||!key(role)||typeof value!=='string'||value.length>4096)fail('invalid_entitlement_mapping',400)
  if(!active(from,until))continue
  let current:string|undefined=normalize(person,mode)
  while(current!==undefined){if(current===identity){values.add(value);roles.add(role);break}current=parents.get(current)}
 }
 if(values.size>100)fail('entitlement_scope_limit',413)
 return {values:[...values].sort(),roles:[...roles].sort(),expiresAt:new Date(expiresAt).toISOString(),day}
}
const audit=(actor:Authority,model:string,view:string,revision:number,digest:string,action:string)=>sql('INSERT INTO bf_entitlement_audit(id,owner_id,actor_id,model_id,view_id,revision,digest,action,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)',randomUUID(),actor.id,actor.id,model,view,revision,digest,action,new Date().toISOString())

/** Additional row restrictions only: this never issues or widens a grant. */
export async function entitlementScope(env:Bindings,actor:Authority,owner:string,model:string,view:string){
 const row=await stored(env,owner,model,view),guard=policyGuard(owner,model,view,row?.revision??null)
 if(!row)return {revision:null,day:null,filters:[] as Filter[],guards:[guard],sources:[] as Source[]}
 const document=JSON.parse(row.document_json) as Document
 if(sha256(canonicalJson(document))!==row.digest)fail('entitlement_snapshot_changed',409)
 const person=await env.DB.prepare("SELECT email FROM oa_operators WHERE id=? AND status='active'").bind(actor.id).first<{email:string}>()
 if(!person)fail('entitlement_mapping_missing',403)
 const principal=normalize(person.email,document.definition.normalization),identityColumn=document.definition.normalization==='exact'?'email COLLATE BINARY':'lower(email) COLLATE BINARY'
 const identityGuard=sql(`(SELECT count(*) FROM oa_operators WHERE status='active' AND ${identityColumn}=? COLLATE BINARY)=1`,principal)
 const unique=await env.DB.prepare(`SELECT count(*) AS n FROM oa_operators WHERE status='active' AND ${identityColumn}=? COLLATE BINARY`).bind(principal).first<{n:number}>()
 if(unique?.n!==1)fail('ambiguous_entitlement_principal',409)
 const sources=[]
 for(const ref of document.sources){const s=await source(env,ref.id);if(s.revision!==ref.revision||sha256(s.value_json)!==ref.digest)fail('entitlement_snapshot_changed',409);sources.push(s)}
 const result=evaluate(document.definition,sources,person.email,new Date())
 if(!result.values.length)fail('entitlement_mapping_missing',403)
 return {revision:row.revision,day:result.day,filters:[{column:document.definition.column,op:'in' as const,value:result.values}],sources,guards:[guard,identityGuard,...sources.map(sourceMatch),sql("strftime('%Y-%m-%dT%H:%M:%fZ','now')<? AND strftime('%Y-%m-%d','now')=?",result.expiresAt,result.day)]}
}

/** Owner review binds normalization, sources and current model before publish. */
export async function entitlementResponse(request:Request,env:Bindings,actor:Authority,path:string):Promise<Response|null>{
 const prefix='/api/operator/explore/entitlements'
 if(path!==prefix&&!path.startsWith(prefix+'/'))return null
 if(actor.role!=='owner')fail('owner_required',403)
 const match=/^\/api\/operator\/explore\/entitlements\/([a-f0-9-]{36})\/([a-z][a-z0-9-]{0,63})$/.exec(path)
 if(match&&request.method==='GET'){
  const current=await stored(env,actor.id,match[1],match[2])
  if(!current)fail('entitlement_snapshot_missing',404)
  const history=(await env.DB.prepare('SELECT revision,document_json,digest,created_at FROM bf_entitlement_history WHERE owner_id=? AND model_id=? AND view_id=? ORDER BY revision').bind(actor.id,match[1],match[2]).all<{revision:number;document_json:string;digest:string;created_at:string}>()).results
  await transact(env.DB,actor,[assertion(policyGuard(actor.id,match[1],match[2],current.revision))])
  return json({revision:current.revision,document:JSON.parse(current.document_json),history:history.map(h=>({revision:h.revision,document:JSON.parse(h.document_json),digest:h.digest,createdAt:h.created_at}))})
 }
 if(request.method!=='POST'||![prefix+'/review',prefix+'/publish'].includes(path))fail('method_not_allowed',405)
 const input=await jsonBody(request);exactKeys(input,['definition','previousRevision','reviewedDigest'])
 const definition=definitionInput(input.definition),previous=input.previousRevision
 if(previous!==null&&(!Number.isSafeInteger(previous)||Number(previous)<1))fail('entitlement_revision_required',400)
 const model=await readModel(env,actor.id,definition.modelId)
 if(!model.production)fail('published_model_required',409)
 const view=(await readDefinition(env,model.production)).views.find(v=>v.id===definition.viewId)
 if(!view?.query.semantic?.dimensions.some(d=>d.column===definition.column&&d.type==='text'))fail('entitlement_dimension_required',403)
 const current=await stored(env,actor.id,model.id,definition.viewId)
 if((current?.revision??null)!==previous)fail('entitlement_snapshot_changed',409)
 const sources=[await source(env,definition.mapping)]
 if(definition.hierarchy)sources.push(await source(env,definition.hierarchy))
 // Validate every row and hierarchy, including rows unrelated to the reviewer.
 evaluate(definition,sources,actor.email,new Date())
 const people=(await env.DB.prepare("SELECT email FROM oa_operators WHERE status='active' ORDER BY id LIMIT 2001").all<{email:string}>()).results
 if(people.length>2000)fail('entitlement_principal_limit',413)
 const principals=people.map(p=>normalize(p.email,definition.normalization))
 if(new Set(principals).size!==principals.length)fail('ambiguous_entitlement_principal',409)
 const document:Document={definition,sources:sources.map(s=>({id:s.id,revision:s.revision,digest:sha256(s.value_json)}))},revision=Number(previous??0)+1,digest=sha256(canonicalJson({document,previous,modelRevision:model.production}))
 const guards=[policyGuard(actor.id,model.id,definition.viewId,previous as number|null),modelGuard(model),...sources.map(sourceMatch)]
 if(path.endsWith('/review')){await transact(env.DB,actor,[...guards.map(assertion),audit(actor,model.id,definition.viewId,revision,digest,'review')]);return json({document,revision,digest,additionalRestrictionOnly:true})}
 if(input.reviewedDigest!==digest)fail('exact_entitlement_review_required',409)
 const content=canonicalJson(document),contentDigest=sha256(content)
 await transact(env.DB,actor,[...guards.map(assertion),sql('INSERT INTO bf_entitlement_snapshots(owner_id,model_id,view_id,revision,document_json,digest) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,model_id,view_id) DO UPDATE SET revision=excluded.revision,document_json=excluded.document_json,digest=excluded.digest',actor.id,model.id,definition.viewId,revision,content,contentDigest),sql('INSERT INTO bf_entitlement_history(owner_id,model_id,view_id,revision,document_json,digest,created_at) VALUES(?,?,?,?,?,?,?)',actor.id,model.id,definition.viewId,revision,content,contentDigest,new Date().toISOString()),audit(actor,model.id,definition.viewId,revision,contentDigest,'publish')])
 return json({revision,digest:contentDigest,additionalRestrictionOnly:true},201)
}
