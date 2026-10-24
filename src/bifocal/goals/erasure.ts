import { sql } from '../../modules/import-kit/src/door/store.ts'
const affected="SELECT goal_id FROM bf_goal_versions WHERE json_extract(document_json,'$.easel.datasetId')=?"
export const goalErasureCounts=(dataset:string)=>[
 {store:'bf_goals',query:sql(`SELECT count(*) FROM bf_goals WHERE id IN (${affected})`,dataset)},
 ...['bf_goal_versions','bf_goal_checkins'].map(store=>({store,query:sql(`SELECT count(*) FROM ${store} WHERE goal_id IN (${affected})`,dataset)})),
]
export const goalErasure=(dataset:string)=>sql(`DELETE FROM bf_goals WHERE id IN (${affected})`,dataset)
