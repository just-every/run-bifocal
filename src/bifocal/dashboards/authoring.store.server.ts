import type { Bindings } from '../../auth.server'
import type { Authority } from '../catalog/authority.server'
import { sql } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { fail } from '../query/types'
import type { DashboardDocument } from './authoring.protocol'
export type DashboardDefinitionState={id:string;revision:number;generation:number;publishedRevision:number|null}
export type DashboardDefinitionRevision={revision:number;document:DashboardDocument;boardId:string;wasPublished:boolean;digest:string;createdAt:string}
export type DashboardDefinitionResource=DashboardDefinitionState&{definition:DashboardDocument;published:{revision:number;boardId:string;document:DashboardDocument}|null;revisions:DashboardDefinitionRevision[];history:unknown[]}
export const dashboardDefinitionGuard=(actor:Authority,id:string,state:DashboardDefinitionState|null)=>state
 ?sql('EXISTS(SELECT 1 FROM bf_dashboard_definitions WHERE id=? AND owner_id=? AND head_revision=? AND generation=? AND published_revision IS ?)',id,actor.id,state.revision,state.generation,state.publishedRevision)
 :sql('NOT EXISTS(SELECT 1 FROM bf_dashboard_definitions WHERE id=?)',id)
export const readDashboardDefinitionState=(env:Bindings,actor:Authority,id:string)=>env.DB.prepare('SELECT id,head_revision AS revision,generation,published_revision AS publishedRevision FROM bf_dashboard_definitions WHERE id=? AND owner_id=?').bind(id,actor.id).first<DashboardDefinitionState>()
export async function readDashboardDefinitionRevision(env:Bindings,actor:Authority,id:string,n:number):Promise<DashboardDefinitionRevision> {
 const row=await env.DB.prepare(`SELECT r.*,EXISTS(SELECT 1 FROM bf_dashboard_definition_history h WHERE h.dashboard_id=r.dashboard_id AND h.revision=r.revision AND h.action IN ('publish','rollback')) AS was_published
  FROM bf_dashboard_definition_revisions r JOIN bf_dashboard_definitions d ON d.id=r.dashboard_id WHERE d.id=? AND d.owner_id=? AND r.revision=?`).bind(id,actor.id,n).first<{revision:number;document_json:string;board_id:string;digest:string;created_at:string;was_published:number}>()
 if(!row)fail('dashboard_definition_revision_not_found',404)
 return {revision:row.revision,document:JSON.parse(row.document_json),boardId:row.board_id,wasPublished:!!row.was_published,digest:row.digest,createdAt:row.created_at}
}
export const dashboardRevisionGuard=(actor:Authority,id:string,revision:DashboardDefinitionRevision)=>sql('EXISTS(SELECT 1 FROM bf_dashboard_definition_revisions r JOIN bf_dashboard_definitions d ON d.id=r.dashboard_id WHERE d.id=? AND d.owner_id=? AND r.revision=? AND r.document_json=? AND r.board_id=? AND r.digest=?)',id,actor.id,revision.revision,canonicalJson(revision.document),revision.boardId,revision.digest)
export async function readDashboardDefinition(env:Bindings,actor:Authority,id:string):Promise<DashboardDefinitionResource|null> {
 const state=await readDashboardDefinitionState(env,actor,id);if(!state)return null
 const numbers=(await env.DB.prepare('SELECT revision FROM bf_dashboard_definition_revisions WHERE dashboard_id=? ORDER BY revision DESC LIMIT 101').bind(id).all<{revision:number}>()).results
 const history=(await env.DB.prepare('SELECT revision,action,actor_id,digest,recorded_at FROM bf_dashboard_definition_history WHERE dashboard_id=? ORDER BY recorded_at,id LIMIT 201').bind(id).all()).results
 if(numbers.length>100||history.length>200)fail('dashboard_definition_history_limit',413)
 const revisions=[];for(const row of numbers)revisions.push(await readDashboardDefinitionRevision(env,actor,id,row.revision))
 const head=revisions.find(row=>row.revision===state.revision),published=state.publishedRevision?revisions.find(row=>row.revision===state.publishedRevision):null
 if(!head||state.publishedRevision&&!published)fail('dashboard_definition_custody_conflict',409)
 return {...state,definition:head.document,published:published?{revision:published.revision,boardId:published.boardId,document:published.document}:null,revisions,history}
}
