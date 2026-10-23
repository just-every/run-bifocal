import { sql } from '../../modules/import-kit/src/door/store.ts'
const items='SELECT item_id FROM bf_catalog_sources WHERE dataset_id=?'
export const catalogErasureCounts=(dataset:string)=>['bf_catalog_items','bf_catalog_versions','bf_catalog_grants','bf_catalog_favourites','bf_catalog_dependencies','bf_catalog_sources','bf_catalog_usage','bf_catalog_search'].map(table=>({store:table,query:sql(`SELECT count(*) FROM ${table} WHERE ${table==='bf_catalog_items'?'id':'item_id'} IN (${items})`,dataset)})).concat([{store:'bf_catalog_grant_activation',query:sql(`SELECT count(*) FROM bf_catalog_grant_activation WHERE kind='item' AND resource_id IN (${items})`,dataset)}])
export const catalogErasure=(dataset:string)=>sql(`DELETE FROM bf_catalog_items WHERE id IN (${items})`,dataset)
