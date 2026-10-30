import { sql } from '../../modules/import-kit/src/door/store.ts'

const affected = 'SELECT id FROM bf_input_tables WHERE dataset_id=?'
const values = ['bf_input_rows', 'bf_input_history', 'bf_input_schemas']
export const inputErasureCounts = (dataset: string) => [
 {store: 'bf_input_tables', query: sql('SELECT count(*) FROM bf_input_tables WHERE dataset_id=?', dataset)},
 ...values.map(store => ({store, query: sql(`SELECT count(*) FROM ${store} WHERE table_id IN (${affected})`, dataset)})),
]

/** Source custody can be absent after Undo. Erase inputs by their retained
 * source identity, inside the same authorized and retention-guarded batch. */
export const inputErasure = (dataset: string) => [
 ...values.map(store => sql(`DELETE FROM ${store} WHERE table_id IN (${affected})`, dataset)),
 sql('DELETE FROM bf_input_tables WHERE dataset_id=?', dataset),
]
