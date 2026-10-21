import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import type { D1TargetAdapter, D1Sql } from '../../../modules/import-kit/src/d1/types.ts'
import type { TargetRow } from '../../../modules/import-kit/src/types.ts'
const PREFIX = 'bifocal:files:'
export const fileDestination = (id: string) => PREFIX + id
const destinationId = (destination: string) => /^bifocal:files:[a-z][a-z0-9-]{0,63}$/.test(destination) ? destination.slice(PREFIX.length) : null
const sql = (sql: string, ...params: unknown[]): D1Sql => ({ sql, params })
type Row = { id: string; value_json: string; revision: string }
const native = (row: Row): TargetRow => ({ destination: fileDestination(row.id), targetKind: 'file-table', targetId: row.id, value: JSON.parse(row.value_json), revision: row.revision })
/** One complete table is one guarded native effect, so chunking and job progress
 * cannot expose half a dataset. Every read/write matches its entire before-image. */
export const fileTargets: D1TargetAdapter = {
 async read(db, destination, kind, id) {
  if (destination !== fileDestination(id) || kind !== 'file-table') return undefined
  const row = await db.prepare('SELECT * FROM bf_file_tables WHERE id=?').bind(id).first<Row>()
  return row ? native(row) : undefined
 },
 matches(row, destination, kind, id) {
  if (destination !== fileDestination(id) || kind !== 'file-table') return sql('0')
  return row ? sql('EXISTS(SELECT 1 FROM bf_file_tables WHERE id=? AND revision=? AND value_json=?)', id, row.revision, canonicalJson(row.value)) : sql('NOT EXISTS(SELECT 1 FROM bf_file_tables WHERE id=?)', id)
 },
 matchesCount(count, destination) { const id = destinationId(destination); return id ? sql('(SELECT count(*) FROM bf_file_tables WHERE id=?)=?', id, count) : sql('0') },
 // A destination owns exactly one dataset, including its complete value and revision.
 matchesMany(rows, destination) {
  const id = destinationId(destination)
  if (!id || rows.some(row => row.targetId !== id || row.destination !== destination || row.targetKind !== 'file-table')) return [sql('0')]
  return [sql('(SELECT count(*) FROM bf_file_tables WHERE id=?)=?', id, rows.length), ...rows.map(row => fileTargets.matches(row, destination, 'file-table', id))]
 },
 write(row) {
  if (row.destination !== fileDestination(row.targetId) || row.targetKind !== 'file-table') throw Error('FILE_TARGET_SCOPE')
  return [sql('INSERT INTO bf_file_tables(id,value_json,revision) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision', row.targetId, canonicalJson(row.value), row.revision)]
 },
 remove(destination, kind, id) { return destination === fileDestination(id) && kind === 'file-table' ? [sql('DELETE FROM bf_file_tables WHERE id=?', id)] : [sql('SELECT 0')] },
 async list(db, destination) { const id = destinationId(destination); if (!id) return []; return (await db.prepare('SELECT * FROM bf_file_tables WHERE id=?').bind(id).all<Row>()).results.map(native) },
}
