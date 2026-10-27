import { issue, physical, provenance, record, text, unknownKeys, yaml } from './common'
import type { Dimension, Project, ProjectFile, ProjectResource } from './types'
import { metabaseField, metabaseOutputs, metabaseQuery } from './metabase-query'

/** Serialization YAML and individual API response objects, never live API calls. */
export function readMetabase(p: Project, files: ProjectFile[]) {
 const resources: ProjectResource[] = []
 for (const file of files) {
  const at = provenance(file, file.content)
  let root: unknown
  if (/\.ya?ml$/i.test(file.path)) root = yaml(p, file)
  else if (/\.json$/i.test(file.path)) { try { root = JSON.parse(file.content) } catch { /* report below */ } }
  else { issue(p, at, file.path, 'unsupported_metabase_file', 'Supply serialization YAML or an individual JSON API export.'); continue }
  if (!record(root)) { issue(p, at, file.path, 'invalid_metabase_object', 'Expected a serialized object mapping.'); continue }
  const metadata = root[['serdes','meta'].join('/')], last = Array.isArray(metadata) ? metadata.at(-1) : null
  const declared = record(last) ? last.model : null
  const kind = record(root.dataset_query) ? 'Card' : declared ?? (Array.isArray(root.fields) ? 'Table' : text(root.engine) && record(root.details) ? 'Database' : root.table_id !== undefined && text(root.base_type) ? 'Field' : Array.isArray(root.dashcards) ? 'Dashboard' : null)
  if (!['Card','Table','Field','Database','Collection','Dashboard'].includes(String(kind))) { issue(p, at, file.path, 'unsupported_metabase_object', 'Include the native object kind or its serialization metadata.'); continue }
  const identity = root.entity_id ?? root.id ?? (record(last) ? last.id : null), name = text(root.name)
  if (!['string','number'].includes(typeof identity) || !name) { issue(p, at, file.path, 'metabase_identity_required', 'Preserve the original object identity and name.'); continue }
  const id = `${kind}.${identity}`, dependencies: string[] = []
  if (root.collection_id !== undefined && root.collection_id !== null) dependencies.push(`Collection.${root.collection_id}`)
  if (kind === 'Card') {
   const query = root.dataset_query
   if (!record(query)) { issue(p, at, id, 'metabase_query_required', 'Include the complete dataset query.'); continue }
   if (query.database !== undefined) dependencies.push(`Database.${query.database}`)
   const walk = (value: unknown, depth = 0): void => {
    if (depth > 64) { issue(p, at, id, 'metabase_query_depth', 'Query nesting exceeds 64 levels.'); return }
    if (Array.isArray(value)) { for (const entry of value) walk(entry, depth + 1); return }
    if (!record(value)) return
    for (const [key, entry] of Object.entries(value)) {
     if (key === 'source-table') {
      if (typeof entry === 'string' && /^card__\d+$/.test(entry)) dependencies.push(`Card.${entry.slice(6)}`)
      else if (typeof entry === 'string' || typeof entry === 'number') dependencies.push(`Table.${entry}`)
      else issue(p, at, id, 'unsupported_metabase_source', 'Resolve this source table reference explicitly.')
     }
     walk(entry, depth + 1)
    }
   }
   walk(query)
   p.tables.push({...at, name, sourceTable: null, dimensions: [], measures: []})
   p.explores.push({...at, name, table: name, joins: []})
  }
  if (kind === 'Table' && root.db_id !== undefined) dependencies.push(`Database.${root.db_id}`)
  if (kind === 'Field' && root.table_id !== undefined) dependencies.push(`Table.${root.table_id}`)
  if (resources.some(r => r.id === id)) issue(p, at, id, 'duplicate_metabase_object', 'Resolve duplicate source identities before rebuilding the model.')
  resources.push({...provenance(file, root), id, name, kind: `metabase-${String(kind).toLowerCase()}`, definition: root, dependencies: [...new Set(dependencies)]})
  if(!['Card','Table','Database'].includes(String(kind)))issue(p, at, id, 'metabase_execution_pending', 'The source definition is retained. MBQL, native SQL, permissions and visualization semantics require explicit translation; no database is contacted and no expression runs.')
 }
 for (const resource of resources) for (const dependency of resource.dependencies) if (!resources.some(r => r.id === dependency)) issue(p, resource, resource.id, 'missing_metabase_dependency', `Include ${dependency}; missing source objects are not fetched or treated as translated.`)
 // Resolve MBQL field ids against the uploaded catalog only. Unsupported
 // clauses remain diagnostic and prevent a wider native query from publishing.
 const metadataKey=['serdes','meta'].join('/')
 for(const resource of resources){
  const value=resource.definition
  if(resource.kind==='metabase-database'){
   unknownKeys(p,resource,resource.id,value,['id','entity_id','name','engine','details',metadataKey])
   if(!record(value.details)||Object.keys(value.details).length)issue(p,resource,resource.id,'metabase_execution_pending','Connection settings require review; no credential or database connection is executed.')
  }
  if(resource.kind==='metabase-table')unknownKeys(p,resource,resource.id,value,['id','entity_id','name','db_id','fields',metadataKey])
  if(resource.kind!=='metabase-card')continue
  unknownKeys(p,resource,resource.id,value,['id','entity_id','name','dataset_query','result_metadata',metadataKey])
  const dataset=value.dataset_query,table=p.tables.find(t=>t.name===resource.name)!
  if(!record(dataset)){continue}
  unknownKeys(p,resource,resource.id+'.dataset_query',dataset,['database','type','query'])
  const query=dataset.query
  if(dataset.type!=='query'||!record(query)||typeof query['source-table']!=='number'||!Array.isArray(query.aggregation)||!query.aggregation.length||query.aggregation.length>64){issue(p,resource,resource.id,'metabase_execution_pending','Only an explicit uploaded table and bounded aggregate MBQL query are translated.');continue}
  unknownKeys(p,resource,resource.id+'.query',query,['source-table','aggregation','filter','breakout'])
  const source=resources.find(r=>r.id==='Table.'+query['source-table']),database=resources.find(r=>r.id==='Database.'+dataset.database)
  if(!source||!database||source.definition.db_id!==dataset.database||!Array.isArray(source.definition.fields)){issue(p,resource,resource.id,'metabase_execution_pending','Include the matching table field catalog and database identity.');continue}
  table.sourceTable=String(source.definition.name)
  const fields=new Map<unknown,{name:string;type:Dimension['type']}>()
  for(const field of source.definition.fields){
   if(!record(field)||typeof field.id!=='number'||!physical(field.name)||typeof field.base_type!=='string'){issue(p,resource,source.id,'unsupported_metabase_field','Each field needs an original numeric id, physical name and declared type.');continue}
   unknownKeys(p,resource,source.id+'.'+field.id,field,['id','name','base_type'])
   const sourceType=field.base_type.split('/').at(-1)!,type=({Integer:'number',BigInteger:'number',Float:'number',Decimal:'number',Text:'text',Boolean:'boolean',Date:'date'} as Record<string,Dimension['type']>)[sourceType]
   if(!type||fields.has(field.id)||table.dimensions.some(d=>d.name===field.name)){issue(p,resource,source.id,'unsupported_metabase_field','Resolve duplicate fields and unsupported source types.');continue}
   fields.set(field.id,{name:String(field.name),type});table.dimensions.push({...resource,name:String(field.name),column:String(field.name),type,sourceType,primaryKey:false,sourceExpression:JSON.stringify(['field',field.id,null])})
  }
  const groups=metabaseQuery(p,resource,query,fields,p.explores.find(e=>e.name===resource.name)!)
  const outputs=metabaseOutputs(p,resource,value.result_metadata,groups,query.aggregation.length)
  if(!outputs)continue
  for(const [index,aggregate] of query.aggregation.entries()){
   const output=outputs[index],resolved=Array.isArray(aggregate)?metabaseField(aggregate[1],fields):null,rowCount=Array.isArray(aggregate)&&aggregate.length===1&&aggregate[0]==='count'
   if(!Array.isArray(aggregate)||!rowCount&&(aggregate.length!==2||!['sum','distinct','count'].includes(aggregate[0])||!resolved)||!record(output)||!physical(output.name)||aggregate[0]==='sum'&&!['number','money'].includes(resolved!.type)){issue(p,resource,resource.id,'metabase_execution_pending','Translate this aggregate expression; only sum, distinct and count of physical fields or row count are supported.');continue}
   table.measures.push({...resource,name:String(output.name),...(resolved?{column:resolved.name}:{}),op:aggregate[0]==='sum'?'sum':aggregate[0]==='count'?'count':'count-distinct',sourceExpression:JSON.stringify(aggregate)})
  }
  issue(p,resource,table.name,'source_table_binding','Map this source table to reviewed native records; source permissions never grant native access.')
 }
 p.resources = resources
}
