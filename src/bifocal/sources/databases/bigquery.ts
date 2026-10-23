import { object, providerJson, requireValue } from '../analytics/protocol'
import type { Column } from '../../imports/files/csv'
import type { Lineage } from '../analytics/lineage'
export type BigQueryTable = {project:string;dataset:string;table:string}
export function tableRef(value: Record<string,unknown>): BigQueryTable {
 requireValue(typeof value.project === 'string' && /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(value.project) && typeof value.dataset === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value.dataset) && typeof value.table === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value.table),'bigquery_table_required')
 return {project:value.project,dataset:value.dataset,table:value.table}
}
export const tableUrl=(ref:BigQueryTable) => `https://bigquery.googleapis.com/bigquery/v2/projects/${ref.project}/datasets/${ref.dataset}/tables/${ref.table}`
export async function tableSchema(ref:BigQueryTable, accessToken:string) {
 const result=await providerJson(tableUrl(ref),accessToken)
 requireValue(object(result.tableReference) && result.tableReference.projectId === ref.project && result.tableReference.datasetId === ref.dataset && result.tableReference.tableId === ref.table && result.location === 'US' && result.type === 'TABLE' && object(result.schema) && Array.isArray(result.schema.fields), 'bigquery_existing_us_table_required',502)
 return result.schema.fields as unknown[]
}
/** Read a small explicitly permitted business table, not SQL or telemetry.
 * No query jobs, paid scan, DDL, ingestion endpoint or cursor is introduced. */
export async function readProductTable(input:Record<string,unknown>,accessToken:string) {
 const ref=tableRef(input), schema=await tableSchema(ref,accessToken)
 requireValue(Array.isArray(input.fields) && input.fields.length > 0 && input.fields.length <= 32 && input.fields.every(f=>typeof f === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(f)) && new Set(input.fields).size === input.fields.length,'bigquery_fields_required')
 const requested=input.fields as string[]
 const selected=schema.filter(field=>object(field) && requested.includes(String(field.name))).map(field=>String((field as Record<string,unknown>).name))
 requireValue(selected.length === requested.length,'bigquery_field_not_found',502)
 const columns:Record<string,Column['type']>={}, fieldTypes:string[]=[]
 for(const name of selected) {
  const field=schema.find(f=>object(f) && f.name === name)
  requireValue(object(field) && !['REPEATED'].includes(String(field.mode)) && ['STRING','INTEGER','INT64','NUMERIC','BIGNUMERIC','BOOLEAN','BOOL','DATE'].includes(String(field.type)), 'bigquery_scalar_field_required',502)
  columns[name]=['INTEGER','INT64','NUMERIC','BIGNUMERIC'].includes(String(field.type)) ? 'number' : ['BOOLEAN','BOOL'].includes(String(field.type)) ? 'boolean' : field.type === 'DATE' ? 'date' : 'text'
  fieldTypes.push(String(field.type))
 }
 const data=await providerJson(tableUrl(ref)+'/data?'+new URLSearchParams({maxResults:'2001',selectedFields:selected.join(',')}),accessToken)
 requireValue(typeof data.totalRows === 'string' && /^\d+$/.test(data.totalRows) && BigInt(data.totalRows) <= 2000n && !data.pageToken && (data.rows === undefined || Array.isArray(data.rows)),'bigquery_complete_table_limit',413)
 const dataRows=(data.rows ?? []) as unknown[]
 requireValue(BigInt(dataRows.length) === BigInt(data.totalRows) && dataRows.length > 0,'bigquery_incomplete_or_empty_table',502)
 const rows=[selected,...dataRows.map(item=>{
  requireValue(object(item) && Array.isArray(item.f) && item.f.length === selected.length,'bigquery_row_schema_mismatch',502)
  return item.f.map((cell,i)=>{
   requireValue(object(cell) && (cell.v === null || typeof cell.v === 'string' && cell.v.length <= 4096),'bigquery_scalar_cell_required',502)
   if(cell.v === null)return ''
   if(fieldTypes[i] === 'DATE') {requireValue(/^\d{4}-\d{2}-\d{2}$/.test(cell.v),'bigquery_date_required',502); return cell.v.slice(5,7)+'/'+cell.v.slice(8,10)+'/'+cell.v.slice(0,4)}
   return cell.v
  })
 })]
 const source:Lineage={kind:'product-table',link:tableUrl(ref),description:'Owner-permitted product business usage table; selected scalar fields only.',from:String(input.from),to:String(input.to),timezone:String(input.timezone),observedAt:new Date().toISOString(),schema:'BigQuery REST v2 tables.get + tabledata.list'}
 return {rows,columns,source}
}
