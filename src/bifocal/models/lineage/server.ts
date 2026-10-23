import type { Bindings } from '../../../auth.server'
/** References describe retained query dependencies. They neither drop a source
 * column nor claim unimplemented transform or scheduled-artifact lineage. */
export async function sourceImpact(env:Bindings,dataset:string,column:string) {
 const snapshots=(await env.DB.prepare('SELECT q.id,q.query_json FROM bf_query_snapshots q JOIN bf_query_sources s ON s.snapshot_id=q.id WHERE s.dataset_id=?').bind(dataset).all<{id:string;query_json:string}>()).results
 const queryIds=snapshots.filter(s=>{
  const q=JSON.parse(s.query_json)
  return q.groupBy.includes(column)||q.filters.some((f:{column:string})=>f.column===column)||q.measures.some((m:Record<string,unknown>)=>['column','numerator','denominator','weight','stateColumn','currencyColumn','rateDateColumn'].some(k=>m[k]===column))||q.joins.some((j:{left:string;right:string})=>j.left===column||j.right===column)
 }).map(s=>s.id)
 const artifacts=[]
 for(const id of queryIds){artifacts.push(...(await env.DB.prepare('SELECT id,kind,title FROM bf_query_artifacts WHERE snapshot_id=? UNION SELECT b.id,b.kind,b.title FROM bf_analytics_boards b JOIN bf_analytics_cards c ON c.board_id=b.id WHERE c.snapshot_id=?').bind(id,id).all()).results)}
 const metrics=(await env.DB.prepare('SELECT metric_id,revision,document_json FROM bf_metric_revisions WHERE dataset_id=?').bind(dataset).all<{metric_id:string;revision:number;document_json:string}>()).results.filter(r=>JSON.stringify(JSON.parse(r.document_json).query).includes(JSON.stringify(column))).map(({metric_id,revision})=>({id:metric_id,revision}))
 return {source:{dataset,column},queries:queryIds,artifacts:[...new Map(artifacts.map(a=>[a.id,a])).values()],metrics,operation:'preview only',unresolved:['transform lineage','scheduled artifacts','promotion enforcement']}
}
