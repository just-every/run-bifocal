import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import type { D1TargetAdapter, D1Sql } from '../../../modules/import-kit/src/d1/types.ts'
import type { TargetRow } from '../../../modules/import-kit/src/types.ts'
export const FILE_DESTINATION = 'bifocal:files'
const sql = (sql: string, ...params: unknown[]): D1Sql => ({ sql, params })
type Row = { id: string; value_json: string; revision: string }
const native = (row: Row): TargetRow => ({ destination: FILE_DESTINATION, targetKind: 'file-table', targetId: row.id, value: JSON.parse(row.value_json), revision: row.revision })
/** One complete table is one guarded native effect, so chunking and job progress
 * cannot expose half a dataset. Every read/write matches its entire before-image. */
export const fileTargets: D1TargetAdapter = {
 async read(db, destination, kind, id) {
  if (destination !== FILE_DESTINATION || kind !== 'file-table') return undefined
  const row = await db.prepare('SELECT * FROM bf_file_tables WHERE id=?').bind(id).first<Row>()
  return row ? native(row) : undefined
 },
 matches(row, destination, kind, id) {
  if (destination !== FILE_DESTINATION || kind !== 'file-table') return sql('0')
  return row ? sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=? AND revision=? AND value_json=?)', id, row.revision, canonicalJson(row.value)) : sql('NOT EXISTS(SELECT 1 FROM bf_file_tables WHERE id=?)', id)
 },
 matchesCount(count, destination) { return destination === FILE_DESTINATION ? sql('(SELECT count(*) FROM bf_file_tables)=?', count) : sql('0') },
 // Compact exact full-set comparison uses every persisted byte and revision.
 matchesMany(rows, destination) {
  if (destination !== FILE_DESTINATION) return [sql('0')]
  const values = rows.map(row => ({ id: row.targetId, revision: row.revision, value_json: canonicalJson(row.value) }))
  return [sql('(SELECT count(*) FROM bf_file_tables)=? AND NOT EXISTS(SELECT 1 FROM bf_file_tables t WHERE NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE json_extract(j.value,\'$.id\')=t.id AND json_extract(j.value,\'$.revision\')=t.revision AND json_extract(j.value,\'$.value_json\')=t.value_json))', values.length, JSON.stringify(values))]
 },
 write(row) {
  if (row.destination !== FILE_DESTINATION || row.targetKind !== 'file-table') throw Error('FILE_TARGET_SCOPE')
  return [sql('INSERT INTO bf_file_tables(id,value_json,revision) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision', row.targetId, canonicalJson(row.value), row.revision)]
 },
 remove(destination, kind, id) { return destination === FILE_DESTINATION && kind === 'file-table' ? [sql('DELETE FROM bf_file_tables WHERE id=?', id)] : [sql('SELECT 0')] },
 async list(db, destination) { if (destination !== FILE_DESTINATION) return []; return (await db.prepare('SELECT * FROM bf_file_tables ORDER BY id').all<Row>()).results.map(native) },
}
