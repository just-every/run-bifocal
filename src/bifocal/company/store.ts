import { randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import type { D1Sql } from '../../modules/import-kit/src/d1/types.ts'
import { ConventionsError, integer, requireValue } from './protocol'
export type Authority = D1Sql & { email: string }
export type VersionTable = 'bf_calendars' | 'bf_rate_sources' | 'bf_schedules'
export interface VersionRow { id: string; version: number; value_json: string; created_at: string; created_by: string }
export const sql = (sql: string, ...params: unknown[]): D1Sql => ({ sql, params })
const assertion = (guard: D1Sql) => sql(`INSERT INTO bf_conventions_assertions(ok) SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END`, ...guard.params ?? [])
/** D1 batch is atomic. The session/version/IdP predicate fences actual returned
 * rows as well as mutations; revocation between admission and batch wins. */
export async function guarded<T>(env: Bindings, owner: Authority, queries: D1Sql[]): Promise<T[][]> {
 const statements = [assertion(owner), ...queries, assertion(owner), sql('DELETE FROM bf_conventions_assertions')]
 const result = await env.DB.batch<T>(statements.map(query => env.DB.prepare(query.sql).bind(...query.params ?? [])))
 return result.slice(1, queries.length + 1).map(row => row.results)
}
export async function versions(env: Bindings, owner: Authority, table: VersionTable, id?: string) {
 const query = id
  ? sql(`SELECT id,version,created_at,created_by,json_extract(value_json,'$.name') AS name FROM ${table} WHERE id=? ORDER BY version DESC LIMIT 1001`, id)
  : sql(`SELECT d.id,d.version,d.created_at,d.created_by,json_extract(d.value_json,'$.name') AS name FROM ${table} d WHERE d.version=(SELECT MAX(v.version) FROM ${table} v WHERE v.id=d.id) ORDER BY d.id LIMIT 1001`)
 const [rows] = await guarded<{ id: string; version: number; created_at: string; created_by: string; name: string }>(env, owner, [query])
 requireValue(rows.length <= 1000, 'version_list_limit', { reason: 'Lists are limited to 1000 definitions or versions. An exact id/version remains readable.' })
 return rows.map(row => ({ id: row.id, version: row.version, name: row.name, createdAt: row.created_at, createdBy: row.created_by }))
}
export const versionValue = (row: VersionRow) => ({ id: row.id, version: row.version, definition: JSON.parse(row.value_json) as unknown, createdAt: row.created_at, createdBy: row.created_by })
export async function readVersion(env: Bindings, owner: Authority, table: VersionTable, id: string, version: number) {
 const [rows] = await guarded<VersionRow>(env, owner, [sql(`SELECT * FROM ${table} WHERE id=? AND version=?`, id, version)])
 if (!rows[0]) throw new ConventionsError('version_not_found', 404, { id, version })
 return rows[0]
}
export async function saveVersion(env: Bindings, owner: Authority, table: VersionTable, id: string, previous: unknown, definition: unknown) {
 const expected = previous === null ? 0 : integer(previous, 'previousVersion', 1, 1000000000)
 const version = expected + 1, createdAt = new Date().toISOString(), value = JSON.stringify(definition)
 await guarded(env, owner, [assertion(sql(`COALESCE((SELECT MAX(version) FROM ${table} WHERE id=?),0)=?`, id, expected)),
  sql(`INSERT INTO ${table}(id,version,value_json,created_at,created_by) VALUES(?,?,?,?,?)`, id, version, value, createdAt, owner.email),
  audit(owner, table, id, version.toString(), value, createdAt)])
 return { id, version, definition, createdAt, createdBy: owner.email }
}
export function audit(owner: Authority, kind: string, id: string, revision: string, value: string, createdAt = new Date().toISOString()) {
 return sql('INSERT INTO bf_conventions_audit(id,actor,kind,record_id,revision,value_json,created_at) VALUES(?,?,?,?,?,?,?)', randomUUID(), owner.email, kind, id, revision, value, createdAt)
}
