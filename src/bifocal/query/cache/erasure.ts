import { assertion, sql } from '../../../modules/import-kit/src/door/store.ts'
import type { D1Sql } from '../../../modules/import-kit/src/d1/types.ts'

const affected = 'SELECT cache_key FROM bf_query_cache_sources WHERE dataset_id=?'

export const cacheErasureCounts = (dataset: string) => [
 {store: 'bf_query_cache', query: sql(`SELECT count(*) FROM bf_query_cache WHERE key IN (${affected})`, dataset)},
 {store: 'bf_query_cache_sources', query: sql(`SELECT count(*) FROM bf_query_cache_sources WHERE cache_key IN (${affected})`, dataset)},
]

/** A source erasure withdraws the whole answer and all of its dependency links. */
export const cacheErasure = (dataset: string): D1Sql[] => [
 sql(`DELETE FROM bf_query_cache WHERE key IN (${affected})`, dataset),
 assertion(sql(`NOT EXISTS(SELECT 1 FROM bf_query_cache WHERE key IN (${affected}))
  AND NOT EXISTS(SELECT 1 FROM bf_query_cache_sources WHERE dataset_id=?)`, dataset, dataset)),
]
