import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../../auth.server'
import { assertion, sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import type { D1Sql } from '../../../modules/import-kit/src/d1/types.ts'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import type { Table } from '../../imports/files/csv'
import { execute } from '../../query/execute'
import { fail, type Answer, type Context, type Query, type Source } from '../../query/types'
import type {CacheReceipt} from '../../query/cache/identity'
type Authority = D1Sql & {email:string}
type Stored = {id:string;owner_id:string;query_json:string;context_json:string;answer_json:string;digest:string;created_at:string;cache_json:string|null}
export type Snapshot = {queryId:string;snapshotId:string;definition:Query;context:Context;answer:Answer;digest:string;createdAt:string;cache?:CacheReceipt}
export const sourceMatch = (s: Source) => sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=? AND revision=? AND value_json=?)',s.id,s.revision,s.value_json)
export async function ownerIdentity(env: Bindings, authority: Authority): Promise<string> {
 const row = await env.DB.prepare(`SELECT id FROM oa_operators WHERE email=? AND role='owner' AND status='active' AND (${authority.sql})`).bind(authority.email,...authority.params ?? []).first<{id:string}>()
 if (!row) fail('owner_required',401)
 return row.id
}
export async function readSources(env: Bindings, query: Query): Promise<Source[]> {
 const sources: Source[] = []
 for (const id of new Set([query.dataset,...query.joins.map(j=>j.dataset)])) {
  const row = await env.DB.prepare('SELECT id,revision,value_json FROM bf_file_tables WHERE id=?').bind(id).first<Omit<Source,'table'>>()
  if (!row) fail('dataset_not_found',404)
  sources.push({...row,table:JSON.parse(row.value_json) as Table})
 }
 return sources
}
export function versionContext(context:Context,definition:Query,sources:Source[]):Context {
 return {...context, definitionVersions: {model: {label: definition.context.modelVersion, revision: sha256(canonicalJson({tables: sources.map(source => ({id: source.id, columns: source.table.columns})), joins: definition.joins, dimensions: definition.groupBy}))}, metrics: {label: definition.context.metricVersion, revision: sha256(canonicalJson(definition.measures))}}}
}
export function prepareQuery(definition: Query, context: Context, sources: Source[],result?:{answer:Answer;cache:CacheReceipt}) {
 context=versionContext(context,definition,sources)
 const answer = result?structuredClone(result.answer):execute(definition,sources,context), snapshotId = randomUUID(), createdAt = new Date().toISOString()
 if(context.exploration?.grantId){answer.inputRows=answer.filteredRows;answer.joinDiagnostics=[]}
 const {guards = [],...frozenContext} = context
 const snapshot: Snapshot = {queryId:snapshotId,snapshotId,definition,context:frozenContext,answer,digest:'',createdAt,...result?{cache:result.cache}:{}}
 return {snapshot,changes:snapshotStatements(snapshot,sources,guards)}
}
export async function saveQuery(env: Bindings, authority: Authority, definition: Query, context: Context, sources: Source[]): Promise<Snapshot> {
 const {snapshot,changes}=prepareQuery(definition,context,sources)
 await transact(env.DB,authority,changes)
 return snapshot
}
function digest(snapshot: Omit<Snapshot,'digest'>): string { return sha256(canonicalJson(snapshot)) }
function snapshotStatements(snapshot: Snapshot, sources: Source[], guards: D1Sql[]): D1Sql[] {
 const {digest:ignored,...content} = snapshot; snapshot.digest = digest(content)
 return [...sources.map(sourceMatch).map(assertion),...guards.map(assertion),
  sql('INSERT INTO bf_query_snapshots(id,owner_id,query_json,context_json,answer_json,digest,created_at,cache_json) VALUES(?,?,?,?,?,?,?,?)',snapshot.snapshotId,snapshot.context.ownerId,canonicalJson(snapshot.definition),canonicalJson(snapshot.context),canonicalJson(snapshot.answer),snapshot.digest,snapshot.createdAt,snapshot.cache?canonicalJson(snapshot.cache):null),
  ...(snapshot.context.modelImport?[sql('INSERT INTO bf_model_import_uses(snapshot_id,project_id) VALUES(?,?)',snapshot.snapshotId,snapshot.context.modelImport.projectId)]:[]),
  ...(snapshot.context.metric?[sql('INSERT INTO bf_metric_uses(snapshot_id,metric_id,revision) VALUES(?,?,?)',snapshot.snapshotId,snapshot.context.metric.id,snapshot.context.metric.revision)]:[]),
  ...sources.map(s=>sql('INSERT INTO bf_query_sources(snapshot_id,dataset_id,revision,value_json) VALUES(?,?,?,?)',snapshot.snapshotId,s.id,s.revision,s.value_json))]
}
export async function readQuery(env: Bindings, authority: Authority, ownerId: string, id: string): Promise<{snapshot:Snapshot;sources:Source[];guard:D1Sql}> {
 const row = await env.DB.prepare('SELECT * FROM bf_query_snapshots WHERE id=? AND owner_id=?').bind(id,ownerId).first<Stored>()
 if (!row) fail('snapshot_not_found',404)
 const rawSources = (await env.DB.prepare('SELECT dataset_id,revision,value_json FROM bf_query_sources WHERE snapshot_id=? ORDER BY dataset_id').bind(id).all<{dataset_id:string;revision:string;value_json:string}>()).results
 const sources = rawSources.map(s=>({id:s.dataset_id,revision:s.revision,value_json:s.value_json,table:JSON.parse(s.value_json) as Table}))
 const snapshot: Snapshot = {queryId:id,snapshotId:id,definition:JSON.parse(row.query_json),context:JSON.parse(row.context_json),answer:JSON.parse(row.answer_json),digest:row.digest,createdAt:row.created_at,...row.cache_json?{cache:JSON.parse(row.cache_json)}:{}}
 const {digest:ignored,...content} = snapshot
 if (!sources.length || digest(content) !== row.digest || snapshot.context.ownerId !== ownerId || snapshot.context.securityScope.ownerId !== ownerId) fail('snapshot_integrity_failed',409)
 const expected = [...new Set([snapshot.definition.dataset,...snapshot.definition.joins.map(j=>j.dataset)])].sort()
 if (canonicalJson(expected)!==canonicalJson(sources.map(s=>s.id).sort()) || sources.some(s=>!snapshot.answer.sourceWatermarks.some(w=>w.dataset===s.id && w.revision===s.revision && w.sha256===sha256(s.value_json)))) fail('snapshot_integrity_failed',409)
 const guard = sql(`EXISTS(SELECT 1 FROM bf_query_snapshots WHERE id=? AND owner_id=? AND digest=? AND query_json=? AND context_json=? AND answer_json=? AND cache_json IS ?)
  AND (SELECT count(*) FROM bf_query_sources WHERE snapshot_id=?)=?`,id,ownerId,row.digest,row.query_json,row.context_json,row.answer_json,row.cache_json,id,sources.length)
 await transact(env.DB,authority,[assertion(guard),...sources.map(s=>assertion(sql('EXISTS(SELECT 1 FROM bf_query_sources WHERE snapshot_id=? AND dataset_id=? AND revision=? AND value_json=?)',id,s.id,s.revision,s.value_json)))])
 return {snapshot,sources,guard}
}
