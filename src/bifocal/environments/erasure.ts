import {sql} from '../../modules/import-kit/src/door/store.ts'
const estates='SELECT owner_id,estate_id FROM bf_environment_sources WHERE dataset_id=?'
const policies='SELECT owner_id,policy_id FROM bf_policy_definition_sources WHERE dataset_id=?'
export const definitionErasureCounts=(dataset:string)=>[
 ...['bf_environment_estates','bf_environment_revisions','bf_environment_sources','bf_environment_approval'].map(table=>({store:table,query:sql(`SELECT count(*) FROM ${table} WHERE (owner_id,${table==='bf_environment_estates'?'id':'estate_id'}) IN (${estates})`,dataset)})),
 ...['bf_policy_definitions','bf_policy_definition_revisions','bf_policy_definition_sources'].map(table=>({store:table,query:sql(`SELECT count(*) FROM ${table} WHERE (owner_id,${table==='bf_policy_definitions'?'id':'policy_id'}) IN (${policies})`,dataset)})),
 {store:'bf_charts',query:sql('SELECT count(*) FROM bf_charts WHERE snapshot_id IN (SELECT snapshot_id FROM bf_query_sources WHERE dataset_id=?)',dataset)}
]
export const eraseDefinitions=(dataset:string)=>[
 sql(`DELETE FROM bf_environment_approval WHERE (owner_id,estate_id) IN (${estates})`,dataset),
 sql(`DELETE FROM bf_environment_estates WHERE (owner_id,id) IN (${estates})`,dataset),
 sql(`DELETE FROM bf_environment_revisions WHERE (owner_id,estate_id) IN (${estates})`,dataset),
 sql(`DELETE FROM bf_policy_definitions WHERE (owner_id,id) IN (${policies})`,dataset),
 sql(`DELETE FROM bf_policy_definition_revisions WHERE (owner_id,policy_id) IN (${policies})`,dataset)
]
