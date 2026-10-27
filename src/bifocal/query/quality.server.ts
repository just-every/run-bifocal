import { dependencySchemas } from '../models/lineage/schemas.server'
import type { Bindings } from '../../auth.server'
import type { D1Sql } from '../../modules/import-kit/src/d1/types.ts'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import type { Snapshot } from '../data/snapshots/store'
import { inspectQuality } from '../quality/evidence.server'
import { queryDependencies } from '../models/lineage/dependencies'

/** A qualification points to this immutable answer. It never swaps a card to
 * a newer answer or promotes a source, model or metric. */
export async function retainedQuality(env:Bindings,authority:D1Sql,ownerId:string,snapshot:Snapshot) {
 const {quality,guards,schemas}=await inspectQuality(env,snapshot.answer.sourceWatermarks.map(s=>s.dataset),ownerId)
 const lineage=queryDependencies(snapshot.definition,await dependencySchemas(env,snapshot.snapshotId))
 for(const dependency of lineage){const source=schemas.find(source=>source.dataset===dependency.dataset);if(source)for(const column of dependency.columns)if(!source.columns.includes(column)){quality.tests.push({dataset:dependency.dataset,column,state:'unknown',reason:'column_unavailable',sourceRevision:source.revision});if(quality.state!=='at risk')quality.state='unknown'}}
 const matches=quality.tests.every(test=>snapshot.answer.sourceWatermarks.some(s=>s.dataset===test.dataset&&s.revision===test.sourceRevision))
 if(quality.state==='healthy'&&matches) {
  const checkedAt=new Date().toISOString()
  await transact(env.DB,authority,[...guards.map(assertion),assertion(sql('EXISTS(SELECT 1 FROM bf_query_snapshots WHERE id=? AND owner_id=? AND digest=?)',snapshot.snapshotId,ownerId,snapshot.digest)),sql('INSERT OR IGNORE INTO bf_retained_quality(snapshot_id,checked_at,evidence_json) VALUES(?,?,?)',snapshot.snapshotId,checkedAt,canonicalJson(quality.tests))])
 }
 const retained=await env.DB.prepare('SELECT checked_at,evidence_json FROM bf_retained_quality WHERE snapshot_id=?').bind(snapshot.snapshotId).first<{checked_at:string;evidence_json:string}>()
 await transact(env.DB,authority,[...guards.map(assertion),assertion(sql('EXISTS(SELECT 1 FROM bf_query_snapshots WHERE id=? AND owner_id=? AND digest=?)',snapshot.snapshotId,ownerId,snapshot.digest))])
 return {...quality,retainedSourceRevisions:snapshot.answer.sourceWatermarks.map(s=>({dataset:s.dataset,revision:s.revision})),lineage,modelRevision:snapshot.definition.context.modelVersion,metric:snapshot.context.metric??null,lastGood:retained?{queryId:snapshot.queryId,createdAt:snapshot.createdAt,checkedAt:retained.checked_at,currency:snapshot.context.currency,tests:JSON.parse(retained.evidence_json),answer:snapshot.answer}:null}
}
