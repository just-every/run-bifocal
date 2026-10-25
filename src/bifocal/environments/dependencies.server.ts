import type { Bindings } from '../../auth.server'
import type { Authority } from '../catalog/authority.server'
import { sql } from '../../modules/import-kit/src/door/store.ts'
import { fail, type Query } from '../query/types'
import type { EstateDocument } from './protocol'

/** Opaque standalone version labels confer no semantic-model dependency. An
 * actual retained native revision must belong to this exact selected estate. */
export async function nativeModelDependency(env:Bindings,actor:Authority,document:EstateDocument,query:Query) {
 const row=await env.DB.prepare(`SELECT r.model_id,r.definition_json,m.owner_id FROM bf_semantic_revisions r
  JOIN bf_semantic_models m ON m.id=r.model_id WHERE r.id=?`).bind(query.context.modelVersion).first<{model_id:string;definition_json:string;owner_id:string}>()
 if(!row)return []
 if(row.owner_id!==actor.id)fail('estate_model_dependency_not_permitted',403)
 const selected=document.resources.find(ref=>ref.kind==='model'&&ref.id===row.model_id)
 if(!selected)fail('estate_model_dependency_required',409)
 if(selected.revisionId!==query.context.modelVersion)fail('estate_model_dependency_revision_mismatch',409)
 return [sql(`EXISTS(SELECT 1 FROM bf_semantic_revisions r JOIN bf_semantic_models m ON m.id=r.model_id
  WHERE r.id=? AND r.model_id=? AND m.owner_id=? AND r.definition_json=?)`,query.context.modelVersion,row.model_id,actor.id,row.definition_json)]
}
