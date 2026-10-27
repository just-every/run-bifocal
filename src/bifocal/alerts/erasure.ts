import { sql } from '../../modules/import-kit/src/door/store.ts'
const affected='SELECT rule_id FROM bf_alert_sources WHERE dataset_id=?'
export const alertErasureCounts=(dataset:string)=>['bf_alert_rules','bf_alert_sources','bf_alert_observations','bf_alert_episodes','bf_alert_transitions'].map(store=>({store,query:sql(`SELECT count(*) FROM ${store} WHERE ${store==='bf_alert_rules'?'id':'rule_id'} IN (${affected})`,dataset)}))
export const alertErasure=(dataset:string)=>[sql(`DELETE FROM bf_alert_rules WHERE id IN (${affected})`,dataset)]
