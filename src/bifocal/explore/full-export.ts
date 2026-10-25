import {canonicalJson,sha256} from '../../modules/import-kit/src/provenance/identity.ts'
import {fail,type Cell} from '../query/types'
import type {ExportPolicy} from './export-policy.server'
import type {ExportColumn} from './table-export'
export function fullExportPlan(snapshotId:string,queryDigest:string,scope:string,format:'csv'|'xlsx',columns:ExportColumn[],rows:Cell[][],policy:ExportPolicy,layout='flat'){
 if(format==='xlsx'&&columns.length>16384)fail('xlsx_column_limit',422)
 const partRows=Math.min(policy[format],10000)
 const content={snapshotId,queryDigest,scope,format,layout,totalRows:rows.length,interactiveCap:policy[format],policyRevision:policy.revision,partRows,parts:Math.max(1,Math.ceil(rows.length/partRows))}
 return {...content,planDigest:sha256(canonicalJson(content))}
}
export function fullExportSlice(plan:ReturnType<typeof fullExportPlan>,rows:Cell[][],offset:unknown,digest:unknown){
 if(digest!==plan.planDigest)fail('full_export_plan_changed',409)
 if(!Number.isSafeInteger(offset)||Number(offset)<0||Number(offset)%plan.partRows!==0||Number(offset)>=rows.length&&!(offset===0&&rows.length===0))fail('full_export_offset_required',400)
 const start=Number(offset),part=rows.slice(start,start+plan.partRows),next=start+part.length
 return {rows:part,offset:start,nextOffset:next<rows.length?next:null,totalRows:rows.length,partNumber:Math.floor(start/plan.partRows)+1}
}
