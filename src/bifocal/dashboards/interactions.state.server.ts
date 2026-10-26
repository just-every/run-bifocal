import {randomUUID} from 'node:crypto'
import type {Bindings} from '../../auth.server'
import type {Authority} from '../catalog/authority.server'
import {sql} from '../../modules/import-kit/src/door/store.ts'
import {canonicalJson} from '../../modules/import-kit/src/provenance/identity.ts'
import {fail,type Filter} from '../query/types'
import {exactKeys} from '../models/validation/transport'
import {publishedDashboard,runPublishedDashboard} from './interactions.run.server'
import {readerSelection,type ReaderSelection} from './interactions.protocol'

type Run=Awaited<ReturnType<typeof runPublishedDashboard>>
export async function readReaderBookmarks(env:Bindings,actor:Authority,run:Run,name?:string,revision?:number,scopeId='native'){
 const id=run.result.id
 if(name!==undefined){const row=await env.DB.prepare('SELECT name,revision,published_revision,selection_json,created_at FROM bf_dashboard_reader_bookmarks WHERE dashboard_id=? AND operator_id=? AND scope_id=? AND name=? AND revision=?').bind(id,actor.id,scopeId,name,revision).first<{name:string;revision:number;published_revision:number;selection_json:string;created_at:string}>();if(!row)fail('dashboard_personal_bookmark_not_found',404);if(row.published_revision!==run.result.revision)fail('dashboard_bookmark_publication_changed',409);return {name:row.name,revision:row.revision,publishedRevision:row.published_revision,selection:readerSelection(JSON.parse(row.selection_json),run.result.config),createdAt:row.created_at}}
 const rows=(await env.DB.prepare('SELECT b.name,b.revision,b.published_revision,b.created_at FROM bf_dashboard_reader_bookmarks b WHERE b.dashboard_id=? AND b.operator_id=? AND b.scope_id=? AND b.revision=(SELECT max(v.revision) FROM bf_dashboard_reader_bookmarks v WHERE v.dashboard_id=b.dashboard_id AND v.operator_id=b.operator_id AND v.scope_id=b.scope_id AND v.name=b.name) ORDER BY b.name LIMIT 21').bind(id,actor.id,scopeId).all()).results
 if(rows.length>20)fail('dashboard_personal_bookmark_limit',413)
 return {bookmarks:rows.map(row=>({name:row.name,revision:row.revision,publishedRevision:row.published_revision,createdAt:row.created_at}))}
}
export async function prepareReaderBookmark(env:Bindings,actor:Authority,run:Run,input:Record<string,unknown>,scopeId='native'){
 exactKeys(input,['name','previousRevision','selection','contextId'])
 if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80||/[\u0000-\u001f]/.test(input.name))fail('dashboard_bookmark_name_required',400)
 if(run.result.cards.some(card=>card.status==='failed'))fail('dashboard_bookmark_data_unavailable',409)
 if(run.result.inherited.filters.length||Object.keys(run.result.inherited.fiscal).length)fail('dashboard_inherited_context_bookmark_refused',409)
 const name=input.name.trim(),id=run.result.id,head=await env.DB.prepare('SELECT max(revision) AS revision FROM bf_dashboard_reader_bookmarks WHERE dashboard_id=? AND operator_id=? AND scope_id=? AND name=?').bind(id,actor.id,scopeId,name).first<{revision:number|null}>()
 if(input.previousRevision!==(head?.revision??null))fail('dashboard_personal_bookmark_revision_changed',409)
 const revision=(head?.revision??0)+1;if(revision>100)fail('dashboard_personal_bookmark_revision_limit',413)
 const now=new Date().toISOString(),changes=[sql('(SELECT max(revision) FROM bf_dashboard_reader_bookmarks WHERE dashboard_id=? AND operator_id=? AND scope_id=? AND name=?) IS ?',id,actor.id,scopeId,name,head?.revision??null),sql('(SELECT count(DISTINCT name) FROM bf_dashboard_reader_bookmarks WHERE dashboard_id=? AND operator_id=? AND scope_id=?)<?',id,actor.id,scopeId,head?.revision?21:20)]
 return {result:{name,revision,publishedRevision:run.result.revision,selection:run.result.selection,createdAt:now},guards:changes,changes:[sql('INSERT INTO bf_dashboard_reader_bookmarks(dashboard_id,operator_id,scope_id,name,revision,published_revision,selection_json,created_at) VALUES(?,?,?,?,?,?,?,?)',id,actor.id,scopeId,name,revision,run.result.revision,canonicalJson(run.result.selection),now)]}
}
export async function prepareDashboardAction(env:Bindings,actor:Authority,ownerId:string,run:Run,actionId:unknown){
 const action=run.result.config.actions.find(a=>a.id===actionId);if(!action)fail('dashboard_action_unavailable',404)
 if(run.result.cards.some(card=>card.status==='failed'))fail('dashboard_action_source_unavailable',409)
 const target=await publishedDashboard(env,actor,ownerId,action.target),filters:Filter[]=[],fiscal:ReaderSelection['fiscal']={}
 for(const binding of action.bindings){const matches=[...run.result.inherited.filters,...run.result.selection.filters].filter(f=>f.column===binding.source);if(!matches.length)fail('dashboard_action_named_context_required',400);if(!target.config.dimensions.includes(binding.target))fail('dashboard_action_target_dimension_unavailable',403);for(const match of matches)filters.push({...match,column:binding.target})}
 for(const binding of action.fiscalBindings){const period=run.result.inherited.fiscal[binding.source]??run.result.selection.fiscal[binding.source];if(!period||!target.config.fiscalParameters.some(p=>p.id===binding.target))fail('dashboard_action_target_period_unavailable',403);fiscal[binding.target]=period}
 return {action,target,inherited:{filters,fiscal},guards:[...run.guards,...target.guards]}
}
export async function prepareDashboardContext(env:Bindings,actor:Authority,prepared:Awaited<ReturnType<typeof prepareDashboardAction>>,source:Run){
 const id=randomUUID(),expiresAt=new Date(Date.now()+30*60*1000).toISOString(),target=prepared.target
 return {result:{contextId:id,target:target.state.id,revision:target.revision.revision,location:'/app/dashboard-authoring/'+target.state.id+'/view?context='+id,context:prepared.inherited,expiresAt},changes:[sql('DELETE FROM bf_dashboard_reader_contexts WHERE expires_at<=?',new Date().toISOString()),sql('INSERT INTO bf_dashboard_reader_contexts(id,operator_id,source_id,source_revision,target_id,target_revision,context_json,expires_at) VALUES(?,?,?,?,?,?,?,?)',id,actor.id,source.result.id,source.result.revision,target.state.id,target.revision.revision,canonicalJson(prepared.inherited),expiresAt)]}
}
export async function readDashboardContext(env:Bindings,actor:Authority,ownerId:string,targetId:string,value:unknown){
 if(value===undefined||value===null)return null
 if(typeof value!=='string'||!/^[a-f0-9-]{36}$/.test(value))fail('dashboard_context_required',400)
 const row=await env.DB.prepare('SELECT * FROM bf_dashboard_reader_contexts WHERE id=? AND operator_id=? AND target_id=? AND expires_at>?').bind(value,actor.id,targetId,new Date().toISOString()).first<{id:string;source_id:string;source_revision:number;target_revision:number;context_json:string;expires_at:string}>()
 if(!row)fail('dashboard_context_unavailable',404)
 const source=await runPublishedDashboard(env,actor,ownerId,row.source_id,{})
 if(source.result.revision!==row.source_revision||source.result.cards.some(card=>card.status==='failed'))fail('dashboard_context_source_changed',409)
 return {inherited:JSON.parse(row.context_json) as {filters:Filter[];fiscal:ReaderSelection['fiscal']},targetRevision:row.target_revision,guards:[...source.guards,sql('EXISTS(SELECT 1 FROM bf_dashboard_reader_contexts WHERE id=? AND operator_id=? AND target_id=? AND context_json=? AND expires_at>strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\'))',value,actor.id,targetId,row.context_json)]}
}
