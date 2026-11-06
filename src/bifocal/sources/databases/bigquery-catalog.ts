import { object, providerJson, requireValue } from '../analytics/protocol'
import { projectId, objectId } from './bigquery'

// Official BigQuery REST v2 discovery revision 20261009. Only these metadata
// projections are requested; SQL, connection details and row data stay upstream.
const datasetName = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_]{1,1024}$/.test(value)
const tableName = (value: unknown): value is string => typeof value === 'string' && /^[\p{L}\p{M}\p{N}\p{Pc}\p{Pd}\p{Zs}]{1,1024}$/u.test(value)
const fieldName = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,299}$/.test(value)
const root = 'https://bigquery.googleapis.com/bigquery/v2/projects/'
const schemaFields = (depth: number): string => `name,type,mode${depth ? `,fields(${schemaFields(depth - 1)})` : ''}`
const projection = {
 datasets: 'nextPageToken,datasets(datasetReference(projectId,datasetId),location)',
 tables: 'nextPageToken,tables(tableReference(projectId,datasetId,tableId),type)',
 schema: `tableReference(projectId,datasetId,tableId),location,type,schema(fields(${schemaFields(8)}))`,
}
const scalar = new Set(['STRING','INTEGER','INT64','NUMERIC','BIGNUMERIC','BOOLEAN','BOOL','DATE'])
const known = new Set([...scalar,'FLOAT','FLOAT64','TIMESTAMP','TIME','DATETIME','BYTES','GEOGRAPHY','JSON','RECORD','STRUCT','RANGE','INTERVAL'])
const pageLimit = 5, objectLimit = 250, pageSize = 50
export type CatalogField = { path: string; type: string; mode: string; readable: boolean; diagnostic: string | null }
function fields(value: unknown, prefix = '', depth = 0, result: CatalogField[] = []): CatalogField[] {
 requireValue(Array.isArray(value), 'bigquery_schema_mismatch', 502)
 requireValue(value.length <= objectLimit && depth <= 8, 'bigquery_schema_limit', 413)
 const names = new Set<string>()
 for (const field of value) {
  requireValue(object(field) && fieldName(field.name) && !names.has(field.name) && typeof field.type === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(field.type), 'bigquery_schema_mismatch', 502)
  names.add(field.name)
  const mode = field.mode ?? 'NULLABLE'
  requireValue(['NULLABLE','REQUIRED','REPEATED'].includes(String(mode)), 'bigquery_schema_mismatch', 502)
  const path = prefix + field.name, nested = ['RECORD','STRUCT'].includes(field.type)
  const readable = !prefix && objectId(field.name) && mode !== 'REPEATED' && scalar.has(field.type)
  requireValue(result.length < objectLimit, 'bigquery_schema_limit', 413)
  result.push({path,type:field.type,mode:String(mode),readable,diagnostic:readable ? null : !objectId(field.name) ? 'Field name is unsupported by the bounded scalar table read.' : !known.has(field.type) ? 'Unsupported provider type; select a supported scalar field.' : mode === 'REPEATED' ? 'Repeated values cannot enter the bounded scalar table read.' : nested || prefix ? 'Nested values cannot enter the bounded scalar table read.' : 'This type is inspectable but unsupported by the bounded scalar table read.'})
  if (nested) fields(field.fields, path + '.', depth + 1, result)
  else requireValue(field.fields === undefined, 'bigquery_schema_mismatch', 502)
 }
 return result
}
type CatalogObject = {id:string;location?:string;type?:string;selectable:boolean;diagnostic:string|null}
type CatalogResult = {project:string;observedAt:string;freshness:string;schemaRevision:string;dataset?:string;table?:string;location?:string;type?:string;diagnostic?:string|null;fields?:CatalogField[];pages?:CatalogObject[][];count?:number}
export async function browseBigQuery(input: Record<string, unknown>, grant: string, checkpoint: () => Promise<void> = async () => {}): Promise<CatalogResult> {
 requireValue(projectId(input.project), 'bigquery_project_required')
 const project = input.project, action = input.action
 requireValue(action === 'datasets' || action === 'tables' || action === 'schema', 'bigquery_catalog_action_required')
 requireValue(action === 'datasets' ? input.dataset === undefined && input.table === undefined : datasetName(input.dataset), 'bigquery_dataset_required')
 requireValue(action === 'schema' ? tableName(input.table) : input.table === undefined, 'bigquery_table_required')
 const dataset = String(input.dataset ?? ''), table = String(input.table ?? '')
 const observedAt = new Date().toISOString()
 const common = {project,observedAt,freshness:'unknown',schemaRevision:'20261009'}
 if (action === 'schema') {
  await checkpoint()
  const metadata = await providerJson(root + project + '/datasets/' + encodeURIComponent(dataset) + '/tables/' + encodeURIComponent(table) + '?' + new URLSearchParams({fields:projection.schema}), grant, undefined, {catalog:true})
  const ref = metadata.tableReference
  requireValue(object(ref) && ref.projectId === project && ref.datasetId === dataset && ref.tableId === table, 'bigquery_object_mismatch', 502)
  requireValue(metadata.location === 'US', 'bigquery_us_location_required', 422)
  const type = metadata.type ?? 'TABLE'
  requireValue(typeof type === 'string' && ['TABLE','VIEW','MATERIALIZED_VIEW','EXTERNAL','SNAPSHOT','CLONE'].includes(type), 'bigquery_table_type_unsupported', 422)
  requireValue(object(metadata.schema) && metadata.schema.fields !== undefined, 'bigquery_schema_unavailable', 422)
  return {...common,dataset,table,location:'US',type,diagnostic:type === 'TABLE' ? null : 'Only ordinary TABLE objects support the bounded scalar read; no SQL or external connection is executed.',fields:fields(metadata.schema.fields)}
 }
 if (action === 'tables') {
  const inventory = await browseBigQuery({action:'datasets',project}, grant, checkpoint)
  const selected = inventory.pages?.flat().find(row => row.id === dataset)
  requireValue(selected, 'bigquery_object_not_found', 404)
  requireValue(selected.location === 'US', 'bigquery_us_location_required', 422)
 }
 const pages: Array<Array<{id:string;location?:string;type?:string;selectable:boolean;diagnostic:string|null}>> = [], seen = new Set<string>(), cursors = new Set<string>()
 let cursor = '', count = 0
 for (let page = 0; page < pageLimit; page++) {
  const query = new URLSearchParams({maxResults:String(pageSize),fields:action === 'datasets' ? projection.datasets : projection.tables})
  if (cursor) query.set('pageToken', cursor)
  const path = root + project + '/datasets' + (action === 'tables' ? '/' + encodeURIComponent(dataset) + '/tables' : '')
  await checkpoint()
  const response = await providerJson(path + '?' + query, grant, undefined, {catalog:true})
  const items = response[String(action)] ?? []
  requireValue(Array.isArray(items) && items.length <= pageSize, 'bigquery_catalog_page_limit', 413)
  const rows = items.map(item => {
   requireValue(object(item), 'bigquery_catalog_schema_mismatch', 502)
   const ref = action === 'datasets' ? item.datasetReference : item.tableReference
   requireValue(object(ref) && ref.projectId === project && (action === 'datasets' || ref.datasetId === dataset), 'bigquery_object_mismatch', 502)
   const id = action === 'datasets' ? ref.datasetId : ref.tableId
   requireValue((action === 'datasets' ? datasetName(id) : tableName(id)) && !seen.has(String(id)), 'bigquery_duplicate_object', 502)
   seen.add(String(id)); count++
   requireValue(count <= objectLimit, 'bigquery_catalog_object_limit', 413)
   if (action === 'datasets') {
    requireValue(typeof item.location === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(item.location), 'bigquery_location_unavailable', 422)
    return {id:String(id),location:item.location,selectable:item.location === 'US',diagnostic:item.location === 'US' ? null : 'Unsupported location; select a US dataset.'}
   }
   requireValue(typeof item.type === 'string' && /^[A-Z_]{1,32}$/.test(item.type), 'bigquery_catalog_schema_mismatch', 502)
   return {id:String(id),type:item.type,selectable:true,diagnostic:item.type === 'TABLE' ? null : 'Inspect schema only; this object is unsupported by the bounded scalar read.'}
  })
  pages.push(rows)
  const next = response.nextPageToken
  requireValue(next === undefined || typeof next === 'string' && (next === '' || /^[A-Za-z0-9._~+\/=:-]{1,2048}$/.test(next) && !cursors.has(next)), 'bigquery_repeated_or_invalid_cursor', 502)
  if (next === undefined || next === '') return {...common,...(action === 'tables' ? {dataset} : {}),pages,count}
  cursors.add(next); cursor = next
 }
 requireValue(false, 'bigquery_catalog_page_limit', 413)
}
