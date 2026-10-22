import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import { sql, transact } from '../../../modules/import-kit/src/door/store.ts'
import type { D1Sql } from '../../../modules/import-kit/src/d1/types.ts'
import type { ImportPlan, Json } from '../../../modules/import-kit/src/types.ts'
import type { RowErrors } from './interpretation'

type Review = { columns: { name: string; type: string }[]; rowCount: number; rowErrors: RowErrors; widthErrors?: {row: number; actual: number; expected: number}[]; errorCount: number }
/** Error metadata survives plan cancellation. No submitted cell values are kept
 * here; dataset erasure withdraws this store in the same retirement batch. */
export async function retainReview(db: D1Database, owner: D1Sql, dataset: string, id: string, plan: ImportPlan) {
 const payload = plan.entries[0]?.source.payload as { review?: Review } | undefined
 const review = payload?.review
 if (!review) return null
 await transact(db, owner, [sql('INSERT OR IGNORE INTO bf_file_reviews(plan_id,dataset_id,review_json) VALUES(?,?,?)', id, dataset, canonicalJson(review as unknown as Json))])
 return pageReview(review, 0)
}
export async function readReview(db: D1Database, owner: D1Sql, dataset: string, id: string, offset: number) {
 const result = await db.batch([
  db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN (${owner.sql}) THEN 1 ELSE 0 END`).bind(...owner.params ?? []),
  db.prepare('SELECT review_json FROM bf_file_reviews WHERE plan_id=? AND dataset_id=?').bind(id, dataset),
  db.prepare('DELETE FROM ik_d1_assertions'),
 ])
 const row = result[1].results[0] as { review_json: string } | undefined
 return row ? pageReview(JSON.parse(row.review_json), offset) : null
}
function pageReview(review: Review, offset: number) {
 const widthErrors = (review.widthErrors ?? []).map(row => ({row: row.row, column: null, name: `Row has ${row.actual} columns`, expected: `${row.expected} columns`}))
 const errors = [...widthErrors, ...review.rowErrors.flatMap(row => row.columns.map(column => ({ row: row.row, column, name: review.columns[column - 1].name, expected: review.columns[column - 1].type })))]
 return { columns: review.columns, rowCount: review.rowCount, errorCount: review.errorCount, errors: errors.slice(offset, offset + 100), nextOffset: offset + 100 < errors.length ? offset + 100 : null }
}
