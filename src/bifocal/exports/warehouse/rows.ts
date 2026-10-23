import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import type { readBoard } from '../../dashboards/store.server'
import { requireValue } from '../../sources/analytics/protocol'
export const exportFields=['artifact_id','snapshot_id','snapshot_digest','metric','dimensions_json','value','numerator','denominator','unit','state','source_json','observed_at']
export function warehouseRows(board:NonNullable<Awaited<ReturnType<typeof readBoard>>>) {
 const rows=[]
 for(const card of board.cards)for(const group of card.answer.rows)for(const [metric,value] of Object.entries(group.values)) {
  const json:Record<string,string>={artifact_id:board.id,snapshot_id:card.snapshotId,snapshot_digest:card.digest,metric,dimensions_json:canonicalJson(group.dimensions),value:value.value ?? '',numerator:value.exact?.numerator ?? '',denominator:value.exact?.denominator ?? '',unit:value.unit,state:value.state,source_json:canonicalJson(card.provenance),observed_at:card.createdAt}
  rows.push({insertId:sha256(canonicalJson([board.id,card.snapshotId,metric,group.dimensions])),json})
 }
 requireValue(rows.length > 0 && rows.length <= 2000 && new TextEncoder().encode(JSON.stringify(rows)).length <= 1048576,'warehouse_export_limit',413)
 return rows
}
