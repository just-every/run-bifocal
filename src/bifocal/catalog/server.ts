import { randomUUID } from 'node:crypto'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { fail, QueryError } from '../query/types'
import { discardBody, exactKeys, json, jsonBody } from '../models/validation/transport'
import { currentAuthority, itemAccess } from './authority.server'
import { digest, metadata, text, uuid } from './protocol'
import { accessGuard, archiveReview, audit, itemDocument, itemGuard, readItem, versionStatement, type Item } from './store.server'

/** Catalog grants permit catalog metadata only. Query/source execution keeps its
 * own authorization. Privacy detail is opt-in and owner-only; agents get no door. */
export async function catalogResponse(request:Request,original:Bindings):Promise<Response|null>{
 const url=new URL(request.url),prefix='/api/operator/library'
 if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return null
 const env=runtimeBindings(original),path=url.pathname.slice(prefix.length)
 try{
  const actor=await currentAuthority(request,env)
  if(!actor){await discardBody(request);return json({error:'session_required'},401)}
  const epoch=await env.DB.prepare('SELECT revision FROM bf_catalog_epoch WHERE singleton=1').first<{revision:number}>()
  if(!epoch)fail('catalog_schema_required',503)
  const commit=(queries:Parameters<typeof transact>[2])=>transact(env.DB,actor,[assertion(sql('EXISTS(SELECT 1 FROM bf_catalog_epoch WHERE singleton=1 AND revision=?)',epoch.revision)),...queries])
  const owner=()=>{if(actor.role!=='owner')fail('owner_required',403)}
  if(path==='/search'){
   if(request.method!=='GET')return json({error:'method_not_allowed'},405)
   if([...url.searchParams.keys()].some(k=>!['q','offset','favourites','tag','collection'].includes(k)))fail('unsupported_search',400)
   const q=url.searchParams.get('q')??'',offset=Number(url.searchParams.get('offset')??0),tag=url.searchParams.get('tag'),collection=url.searchParams.get('collection')
   if(q.length>200||!Number.isSafeInteger(offset)||offset<0||offset>10000||url.searchParams.has('favourites')&&url.searchParams.get('favourites')!=='true')fail('invalid_search',400)
   const terms=q.match(/[\p{L}\p{N}_]+/gu)??[]
   if(terms.length>8)fail('search_too_many_terms',400)
   const match=terms.map(term=>'"'+term+'"*').join(' AND '),access=itemAccess(actor)
   const where=`i.archived=0 AND ${access.sql} ${match?'AND bf_catalog_search MATCH ?':''} ${tag?'AND EXISTS(SELECT 1 FROM json_each(i.tags_json) WHERE value=?)':''} ${collection?'AND i.collection_id=?':''} ${url.searchParams.has('favourites')?'AND EXISTS(SELECT 1 FROM bf_catalog_favourites f WHERE f.item_id=i.id AND f.operator_id=?)':''}`
   const params=[...access.params??[],...match?[match]:[],...tag?[text(tag,64)]:[],...collection?[uuid(collection)]:[],...url.searchParams.has('favourites')?[actor.id]:[]]
   const join=match?' JOIN bf_catalog_search ON bf_catalog_search.item_id=i.id':''
   const total=Number((await env.DB.prepare(`SELECT count(*) AS n FROM bf_catalog_items i ${join} WHERE ${where}`).bind(...params).first<{n:number}>())?.n??0)
   const rows=(await env.DB.prepare(`SELECT i.* FROM bf_catalog_items i ${join} WHERE ${where} ORDER BY (i.kind='metric' AND i.verified=1) DESC,${match?'bm25(bf_catalog_search),':''} i.title COLLATE NOCASE,i.id LIMIT 50 OFFSET ?`).bind(...params,offset).all<Item>()).results
   await commit(rows.flatMap(item=>[assertion(itemGuard(item)),assertion(accessGuard(actor,item.id))]))
   return json({items:rows.map(item=>({...itemDocument(item),collectionId:actor.role==='owner'?item.collection_id:null})),total,suggestions:[...new Set(rows.map(item=>item.title))],nextOffset:offset+rows.length<total?offset+rows.length:null})
  }
  if(url.search)fail('query_parameters_not_supported',400)
  if(path==='/collections'){
   if(request.method==='GET'){
    const rows=(await env.DB.prepare(`SELECT c.* FROM bf_catalog_collections c WHERE c.owner_id=? OR EXISTS(SELECT 1 FROM bf_catalog_collection_grants g WHERE g.collection_id=c.id AND g.operator_id=?) ORDER BY c.name,c.id`).bind(actor.id,actor.id).all()).results
    await commit([])
    return json({collections:rows.map(row=>({...row,parent_id:actor.role==='owner'?row.parent_id:null}))})
   }
   if(request.method!=='POST')return json({error:'method_not_allowed'},405)
   owner();const input=await jsonBody(request);exactKeys(input,['name','parentId']);const name=text(input.name),parent=input.parentId===null?null:uuid(input.parentId),id=randomUUID()
   await commit([...parent?[assertion(sql('EXISTS(SELECT 1 FROM bf_catalog_collections WHERE id=? AND owner_id=?)',parent,actor.id))]:[],sql('INSERT INTO bf_catalog_collections(id,owner_id,parent_id,name) VALUES(?,?,?,?)',id,actor.id,parent,name),audit(actor,actor.id,'collection-created',null,null,digest({name,parent}))])
   return json({id,name,parentId:parent,version:1},201)
  }
  const collectionGrant=/^\/collections\/([a-f0-9-]{36})\/grants$/.exec(path)
  if(collectionGrant){
   owner();if(request.method!=='PUT')return json({error:'method_not_allowed'},405)
   const input=await jsonBody(request);exactKeys(input,['readerId','enabled']);const readerId=uuid(input.readerId)
   if(typeof input.enabled!=='boolean')fail('grant_enabled_required',400)
   await commit([assertion(sql('EXISTS(SELECT 1 FROM bf_catalog_collections WHERE id=? AND owner_id=?)',collectionGrant[1],actor.id)),assertion(sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active')",readerId)),input.enabled?sql('INSERT OR IGNORE INTO bf_catalog_collection_grants(collection_id,operator_id) VALUES(?,?)',collectionGrant[1],readerId):sql('DELETE FROM bf_catalog_collection_grants WHERE collection_id=? AND operator_id=?',collectionGrant[1],readerId),audit(actor,actor.id,'collection-grant-changed',null,null,digest(input))])
   return json({enabled:input.enabled})
  }
  if(path==='/items'){
   if(request.method!=='POST')return json({error:'method_not_allowed'},405)
   owner();const input=await jsonBody(request);exactKeys(input,['kind','title','description','tags','definition','sourceLinks','verified','collectionId','sourceDatasets'])
   const value=metadata(input),id=randomUUID()
   if(!Array.isArray(input.sourceDatasets)||input.sourceDatasets.length>10||!input.sourceDatasets.every(v=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(v)))fail('source_datasets_required',400)
   const sources=[...new Set(input.sourceDatasets)] as string[]
   await commit([...value.collectionId?[assertion(sql('EXISTS(SELECT 1 FROM bf_catalog_collections WHERE id=? AND owner_id=?)',value.collectionId,actor.id))]:[],...sources.map(dataset=>assertion(sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=?)',dataset))),sql('INSERT INTO bf_catalog_items(id,owner_id,collection_id,kind,title,description,tags_json,definition_json,source_links_json,verified,fingerprint,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,actor.id,value.collectionId,value.kind,value.title,value.description,canonicalJson(value.tags),canonicalJson(value.definition),canonicalJson(value.sourceLinks),Number(value.verified),value.fingerprint,new Date().toISOString()),...sources.map(dataset=>sql('INSERT INTO bf_catalog_sources(item_id,dataset_id) VALUES(?,?)',id,dataset)),versionStatement(id,1,value),audit(actor,actor.id,value.verified?'content-verified':'content-created',id,1,digest(value))])
   return json({id,version:1},201)
  }
  if(path==='/privacy'){
   owner()
   const current=await env.DB.prepare('SELECT * FROM bf_catalog_policy WHERE owner_id=?').bind(actor.id).first<{version:number;usage_enabled:number}>()
   if(request.method==='GET'){await commit([]);return json({version:current?.version??0,usageEnabled:!!current?.usage_enabled,detail:'owner-only',automaticErasure:false})}
   if(request.method!=='PUT')return json({error:'method_not_allowed'},405)
   const input=await jsonBody(request);exactKeys(input,['previousVersion','usageEnabled','consent','detail'])
   if(input.previousVersion!==(current?.version??0)||typeof input.usageEnabled!=='boolean'||input.consent!==true||input.detail!=='owner-only')fail('exact_owner_privacy_consent_required',409)
   const version=(current?.version??0)+1,guard=current?sql('EXISTS(SELECT 1 FROM bf_catalog_policy WHERE owner_id=? AND version=?)',actor.id,current.version):sql('NOT EXISTS(SELECT 1 FROM bf_catalog_policy WHERE owner_id=?)',actor.id)
   await commit([assertion(guard),sql('INSERT INTO bf_catalog_policy(owner_id,version,usage_enabled,consented_at) VALUES(?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET version=excluded.version,usage_enabled=excluded.usage_enabled,consented_at=excluded.consented_at',actor.id,version,Number(input.usageEnabled),new Date().toISOString()),audit(actor,actor.id,'privacy-consented',null,version,digest(input))])
   return json({version,usageEnabled:input.usageEnabled,detail:'owner-only',automaticErasure:false})
  }
  if(path==='/usage/import'||path==='/hygiene'){
   owner();const policy=await env.DB.prepare('SELECT version FROM bf_catalog_policy WHERE owner_id=? AND usage_enabled=1').bind(actor.id).first<{version:number}>()
   if(!policy)fail('usage_privacy_consent_required',409)
   const policyGuard=sql('EXISTS(SELECT 1 FROM bf_catalog_policy WHERE owner_id=? AND version=? AND usage_enabled=1)',actor.id,policy.version)
   if(path==='/usage/import'){
    if(request.method!=='POST')return json({error:'method_not_allowed'},405)
    const input=await jsonBody(request);exactKeys(input,['events','policyVersion']);if(input.policyVersion!==policy.version||!Array.isArray(input.events)||input.events.length>200)fail('bounded_authorized_events_required',400)
    const now=Date.now(),statements=[]
    for(const raw of input.events){
     if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('invalid_usage_event',400)
     const event=raw as Record<string,unknown>;exactKeys(event,['id','itemId','readerId','tenant','openedAt'])
     const id=text(event.id,120),itemId=uuid(event.itemId),readerId=uuid(event.readerId),tenant=text(event.tenant,120),openedAt=text(event.openedAt,40),time=Date.parse(openedAt)
     if(!Number.isFinite(time)||new Date(time).toISOString()!==openedAt||time>now||time<now-90*86400000)fail('usage_event_outside_ninety_days',400)
     const hash=digest(event)
     statements.push(assertion(sql('EXISTS(SELECT 1 FROM bf_catalog_items WHERE id=? AND owner_id=?)',itemId,actor.id)),assertion(sql("EXISTS(SELECT 1 FROM oa_operators o JOIN bf_catalog_items i ON i.id=? WHERE o.id=? AND o.status='active' AND (i.owner_id=o.id OR EXISTS(SELECT 1 FROM bf_catalog_grants g WHERE g.item_id=i.id AND g.operator_id=o.id)))",itemId,readerId)),assertion(sql('NOT EXISTS(SELECT 1 FROM bf_catalog_usage WHERE id=? AND fingerprint<>?)',id,hash)),sql('INSERT OR IGNORE INTO bf_catalog_usage(id,item_id,reader_id,tenant,opened_at,fingerprint,imported_at) VALUES(?,?,?,?,?,?,?)',id,itemId,readerId,tenant,openedAt,hash,new Date().toISOString()))
    }
    await commit([assertion(policyGuard),...statements,audit(actor,actor.id,'usage-imported',null,policy.version,digest(input.events))])
    return json({accepted:input.events.length,policyVersion:policy.version},201)
   }
   if(request.method!=='GET')return json({error:'method_not_allowed'},405)
   const since=new Date(Date.now()-90*86400000).toISOString()
   const items=(await env.DB.prepare(`SELECT i.id,i.title,i.owner_id,i.fingerprint,i.archived,i.updated_at,count(u.id) AS opens,max(u.opened_at) AS lastOpen FROM bf_catalog_items i LEFT JOIN bf_catalog_usage u ON u.item_id=i.id AND u.opened_at>=? WHERE i.owner_id=? GROUP BY i.id ORDER BY i.id`).bind(since,actor.id).all()).results
   const usage=(await env.DB.prepare('SELECT u.item_id,u.reader_id,u.tenant,count(*) AS opens,max(u.opened_at) AS lastOpen FROM bf_catalog_usage u JOIN bf_catalog_items i ON i.id=u.item_id WHERE i.owner_id=? AND u.opened_at>=? GROUP BY u.item_id,u.reader_id,u.tenant ORDER BY u.item_id,u.reader_id,u.tenant').bind(actor.id,since).all()).results
   const dependencies=(await env.DB.prepare('SELECT d.item_id,d.depends_on FROM bf_catalog_dependencies d JOIN bf_catalog_items i ON i.id=d.item_id WHERE i.owner_id=? ORDER BY d.item_id,d.depends_on').bind(actor.id).all()).results
   const historicalTotal=Number((await env.DB.prepare('SELECT count(*) AS n FROM bf_catalog_usage u JOIN bf_catalog_items i ON i.id=u.item_id WHERE i.owner_id=?').bind(actor.id).first<{n:number}>())?.n??0)
   await commit([assertion(policyGuard)])
   return json({windowDays:90,denominator:{items:items.length,historicalOpens:historicalTotal,archivedItems:items.filter(i=>i.archived).length},items:items.map(item=>({...item,unused:item.opens===0,stale:Date.parse(String(item.lastOpen??item.updated_at))<Date.now()-30*86400000,duplicates:items.filter(other=>other.id!==item.id&&other.fingerprint===item.fingerprint).map(other=>other.id)})),usage,dependencies,detail:'owner-only'})
  }
  if(path==='/audit'){
   owner();if(request.method!=='GET')return json({error:'method_not_allowed'},405)
   const records=(await env.DB.prepare('SELECT * FROM bf_catalog_audit WHERE owner_id=? ORDER BY recorded_at,id').bind(actor.id).all()).results;await commit([]);return json({records})
  }
  const match=/^\/items\/([a-f0-9-]{36})(?:\/(favourite|grants|dependencies|archive-preview|archive|restore|versions))?$/.exec(path)
  if(match){
   const item=await readItem(env,actor,match[1]),operation=match[2]
   if(!operation){
    if(request.method==='PUT'){
     owner();if(item.owner_id!==actor.id)fail('content_not_found',404)
     if(item.archived)fail('restore_before_edit',409)
     const input=await jsonBody(request);exactKeys(input,['previousVersion','kind','title','description','tags','definition','sourceLinks','verified','collectionId','sourceDatasets'])
     if(input.previousVersion!==item.version||!Array.isArray(input.sourceDatasets)||input.sourceDatasets.length>10||!input.sourceDatasets.every(v=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(v)))fail('current_metadata_review_required',409)
     const value=metadata(input),sources=[...new Set(input.sourceDatasets)] as string[],version=item.version+1
     await commit([assertion(itemGuard(item)),...value.collectionId?[assertion(sql('EXISTS(SELECT 1 FROM bf_catalog_collections WHERE id=? AND owner_id=?)',value.collectionId,actor.id))]:[],...sources.map(dataset=>assertion(sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=?)',dataset))),sql('UPDATE bf_catalog_items SET collection_id=?,kind=?,title=?,description=?,tags_json=?,definition_json=?,source_links_json=?,verified=?,fingerprint=?,version=?,updated_at=? WHERE id=?',value.collectionId,value.kind,value.title,value.description,canonicalJson(value.tags),canonicalJson(value.definition),canonicalJson(value.sourceLinks),Number(value.verified),value.fingerprint,version,new Date().toISOString(),item.id),...sources.map(dataset=>sql('INSERT OR IGNORE INTO bf_catalog_sources(item_id,dataset_id) VALUES(?,?)',item.id,dataset)),versionStatement(item.id,version,value),audit(actor,actor.id,'metadata-reviewed',item.id,version,digest(value))])
     return json({id:item.id,version})
    }
    if(request.method!=='GET')return json({error:'method_not_allowed'},405)
    const favourite=!!await env.DB.prepare('SELECT 1 FROM bf_catalog_favourites WHERE item_id=? AND operator_id=?').bind(item.id,actor.id).first()
    await commit([assertion(itemGuard(item)),assertion(accessGuard(actor,item.id))])
    return json({...itemDocument(item),collectionId:actor.role==='owner'?item.collection_id:null,favourite})
   }
   if(operation==='favourite'){
    if(request.method!=='PUT')return json({error:'method_not_allowed'},405)
    const input=await jsonBody(request);exactKeys(input,['favourite']);if(typeof input.favourite!=='boolean')fail('favourite_required',400)
    await commit([assertion(accessGuard(actor,item.id)),input.favourite?sql('INSERT OR IGNORE INTO bf_catalog_favourites(item_id,operator_id) VALUES(?,?)',item.id,actor.id):sql('DELETE FROM bf_catalog_favourites WHERE item_id=? AND operator_id=?',item.id,actor.id)])
    return json({favourite:input.favourite})
   }
   owner();if(item.owner_id!==actor.id)fail('content_not_found',404)
   if(operation==='versions'){
    if(request.method!=='GET')return json({error:'method_not_allowed'},405)
    const versions=(await env.DB.prepare('SELECT version,metadata_json FROM bf_catalog_versions WHERE item_id=? ORDER BY version').bind(item.id).all()).results;await commit([assertion(itemGuard(item))]);return json({versions})
   }
   if(operation==='archive-preview'){
    if(request.method!=='POST')return json({error:'method_not_allowed'},405)
    const input=await jsonBody(request);exactKeys(input,[]);return json((await archiveReview(env,actor,item)).review)
   }
   if(operation==='archive'||operation==='restore'){
    if(request.method!=='POST')return json({error:'method_not_allowed'},405)
    const input=await jsonBody(request);exactKeys(input,['digest','previousVersion']);const {review,guards}=await archiveReview(env,actor,item)
    if(input.digest!==review.digest||input.previousVersion!==item.version||operation!==(item.archived?'restore':'archive'))fail('exact_archive_review_required',409)
    const archived=operation==='archive',version=item.version+1
    await commit([...guards.map(assertion),sql('UPDATE bf_catalog_items SET archived=?,version=?,updated_at=? WHERE id=?',Number(archived),version,new Date().toISOString(),item.id),versionStatement(item.id,version,{...itemDocument(item),archived,version}),audit(actor,actor.id,operation,item.id,version,review.digest)])
    return json({id:item.id,archived,version})
   }
   if(request.method!=='PUT')return json({error:'method_not_allowed'},405)
   const input=await jsonBody(request)
   if(operation==='grants'){
    exactKeys(input,['readerId','enabled']);const readerId=uuid(input.readerId);if(typeof input.enabled!=='boolean')fail('grant_enabled_required',400)
    await commit([assertion(itemGuard(item)),assertion(sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active')",readerId)),input.enabled?sql('INSERT OR IGNORE INTO bf_catalog_grants(item_id,operator_id) VALUES(?,?)',item.id,readerId):sql('DELETE FROM bf_catalog_grants WHERE item_id=? AND operator_id=?',item.id,readerId),audit(actor,actor.id,input.enabled?'grant-enabled':'grant-revoked',item.id,item.version,digest({readerId}))])
    return json({enabled:input.enabled})
   }
   exactKeys(input,['dependsOn','enabled']);const dependsOn=uuid(input.dependsOn);if(typeof input.enabled!=='boolean'||dependsOn===item.id)fail('invalid_dependency',400)
   await commit([assertion(itemGuard(item)),assertion(sql('EXISTS(SELECT 1 FROM bf_catalog_items WHERE id=? AND owner_id=?)',dependsOn,actor.id)),input.enabled?sql('INSERT OR IGNORE INTO bf_catalog_dependencies(item_id,depends_on) VALUES(?,?)',item.id,dependsOn):sql('DELETE FROM bf_catalog_dependencies WHERE item_id=? AND depends_on=?',item.id,dependsOn),audit(actor,actor.id,'dependency-changed',item.id,item.version,digest(input))])
   return json({enabled:input.enabled})
  }
  return json({error:'not_found'},404)
 }catch(error){if(error instanceof QueryError)return json({error:error.code},error.status);return json({error:'catalog_conflict',reason:'The session, current grant, reviewed content or privacy policy changed. No partial change was committed.'},409)}finally{await discardBody(request)}
}
