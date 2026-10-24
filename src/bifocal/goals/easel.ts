import type { Bindings } from '../../auth.server'
import type { Table } from '../imports/files/csv'
import { sourceMatch } from '../data/snapshots/store'
import { ident, text } from '../metrics/transport'
import { fail } from '../query/types'
/** Easel dataset CSV, dataset.ts at 277548b08ec1a0ebf588db971b099df865405f84.
 * Imported original bytes and named series identify an export snapshot;
 * the digest is never represented as an Easel internal revision id. */
export async function easelTarget(env:Bindings,v:Record<string,unknown>,period:{from:string;to:string;target:string}) {
 const keys=['easelDataset','easelRevision','easelRow','easelSeries']
 if(!keys.some(k=>v[k]!==undefined&&v[k]!==''))return null
 const dataset=ident(v.easelDataset),reviewedRevision=text(v.easelRevision),rowId=text(v.easelRow),series=text(v.easelSeries)
 if(series==='Actual')fail('easel_plan_series_required',400)
 const source=await env.DB.prepare('SELECT id,revision,value_json FROM bf_file_tables WHERE id=?').bind(dataset).first<{id:string;revision:string;value_json:string}>()
 if(!source||source.revision!==reviewedRevision)fail('stale_easel_export',409)
 const table=JSON.parse(source.value_json) as Table,lineage=table.source.lineage
 if(lineage?.kind!=='easel-export'||table.source.delimiter!==',')fail('reviewed_easel_export_required',400)
 const url=new URL(lineage.link),report=/^\/api\/easel\/dataset\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname)
 if(!report||url.search||url.hash)fail('easel_dataset_source_link_required',400)
 const names=['row_id','row_name','month','series','amount_minor','currency']
 if(table.columns.map(c=>c.name).join()!==names.join())fail('easel_dataset_columns_required',400)
 if(!period.from.endsWith('-01')||!period.to.endsWith('-01')||lineage.from>period.from||lineage.to<period.to)fail('complete_easel_month_period_required',400)
 const months:string[]=[]
 for(let at=period.from;at<period.to;){months.push(at.slice(0,7));const date=new Date(at);date.setUTCMonth(date.getUTCMonth()+1);at=date.toISOString().slice(0,10)}
 const selected=table.rows.filter(r=>r[0]===rowId&&r[3]===series&&months.includes(String(r[2])))
 if(selected.length!==months.length||months.some(m=>selected.filter(r=>r[2]===m).length!==1))fail('easel_month_missing_or_duplicated',409)
 let minor=0n
 for(const row of selected){if(row[5]!=='USD'||typeof row[4]!=='string'||! /^-?\d{1,16}$/.test(row[4]))fail('easel_USD_minor_units_required',400);if(BigInt(row[4])>9007199254740991n||BigInt(row[4])< -9007199254740991n)fail('easel_exact_minor_units_required',400);minor+=BigInt(row[4])}
 if(minor<=0n)fail('positive_easel_target_required',400)
 const target=`${minor/100n}.${String(minor%100n).padStart(2,'0')}`
 if(target!==period.target)fail('reviewed_easel_target_mismatch',409)
 return {guard:sourceMatch({...source,table}),provenance:{kind:'easel-export',datasetId:dataset,datasetRevision:source.revision,reportId:report[1],rowId,series,exportSha256:table.source.sha256,link:lineage.link,from:period.from,to:period.to,currency:'USD',target,observedAt:lineage.observedAt,versionMeaning:'Named Easel series and exact original export digest; no internal plan revision is inferred.'}}
}
