import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../../auth.server'
import type { Authority } from '../../catalog/authority.server'
import { assertion, sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { readQuery, sourceMatch } from '../../data/snapshots/store'
import { modelGuard, readModel } from '../../models/validation/store.server'
import { fail } from '../../query/types'
import { compose, type Operation } from './execute'
import { prepareSubject, type SubjectInput } from './subjects.server'
export type Definition=Operation&{left:SubjectInput;right:SubjectInput}
type Row={id:string;owner_id:string;left_snapshot:string;right_snapshot:string;definition_json:string;result_json:string;digest:string}
const digest=(definition:unknown,result:unknown,left:string,right:string)=>sha256(canonicalJson({definition,result,left,right}))
export async function saveComposition(env:Bindings,actor:Authority,definition:Definition) {
 const [left,right]=await Promise.all([prepareSubject(env,actor,definition.left),prepareSubject(env,actor,definition.right)])
 const {result}=compose(left,right,definition),id=randomUUID(),fingerprint=digest(definition,result,left.snapshot.digest,right.snapshot.digest)
 await transact(env.DB,actor,[...left.changes,...right.changes,sql('INSERT INTO bf_exploration_compositions(id,owner_id,left_snapshot,right_snapshot,definition_json,result_json,digest,created_at) VALUES(?,?,?,?,?,?,?,?)',id,actor.id,left.snapshot.snapshotId,right.snapshot.snapshotId,canonicalJson(definition),canonicalJson(result),fingerprint,new Date().toISOString())])
 return {id,definition,...result}
}
export async function readComposition(env:Bindings,actor:Authority,id:string) {
 const row=await env.DB.prepare('SELECT * FROM bf_exploration_compositions WHERE id=? AND owner_id=?').bind(id,actor.id).first<Row>()
 if(!row)fail('composition_not_found',404)
 const [left,right]=await Promise.all([readQuery(env,actor,actor.id,row.left_snapshot),readQuery(env,actor,actor.id,row.right_snapshot)])
 const guards=[left.guard,right.guard,sql('EXISTS(SELECT 1 FROM bf_exploration_compositions WHERE id=? AND owner_id=? AND digest=? AND definition_json=? AND result_json=?)',id,actor.id,row.digest,row.definition_json,row.result_json)]
 for(const subject of [left,right]) {
  const exploration=subject.snapshot.context.exploration
  if(!exploration||exploration.grantId)fail('composition_subject_integrity_failed',409)
  const model=await readModel(env,actor.id,exploration.modelId)
  if(model.production!==exploration.revision)fail('published_model_changed',409)
  guards.push(modelGuard(model))
  for(const source of subject.sources) {
   const current=await env.DB.prepare('SELECT revision,value_json FROM bf_file_tables WHERE id=?').bind(source.id).first<{revision:string;value_json:string}>()
   if(!current||current.revision!==source.revision||current.value_json!==source.value_json)fail('composition_source_changed',409)
   guards.push(sourceMatch(source))
  }
 }
 const definition=JSON.parse(row.definition_json) as Definition,built=compose(left,right,definition)
 if(canonicalJson(built.result)!==row.result_json||digest(definition,built.result,left.snapshot.digest,right.snapshot.digest)!==row.digest)fail('composition_integrity_failed',409)
 return {document:{id,definition,...built.result},underlying:built.underlying,guards:guards.map(assertion)}
}
