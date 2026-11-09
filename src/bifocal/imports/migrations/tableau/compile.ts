import { canonicalJson, sha256 } from '../../../../modules/import-kit/src/provenance/identity.ts'
import { metricDefinition, type MetricDocument } from '../../../metrics/store.server'
import { queryInput } from '../../../query/validate'
import type { Filter, Source } from '../../../query/types'
import { readTableauMigration, obj, txt, list, type Diagnostic } from './read'
export type TableauMigration=ReturnType<typeof readTableauMigration>&{drafts:{sourceMetric:string;document:{version:1;id:string;definition:MetricDocument}}[];sources:{id:string;revision:string}[]}
const empty=(v:unknown)=>v===undefined||v===null||Array.isArray(v)&&!v.length||typeof v==='object'&&!Object.keys(v??{}).length
const physical=(field:string)=>{const parsed=/^\[((?:[^\]]|\]\])+)\]$/.exec(field);return parsed?parsed[1].replace(/\]\]/g,']'):field}
export function compileTableau(value:unknown,projectId:string,sources:Source[]):TableauMigration{
 const read=readTableauMigration(value),drafts:TableauMigration['drafts']=[],used=new Map<string,string>(),diagnostics=read.diagnostics
 const problem=(object:string,file:string,code:string,message:string)=>diagnostics.push({object,file,code,message,blocksPreview:true})
 const properties=(value:Record<string,unknown>,allowed:string[],object:string,file:string)=>{for(const key of Object.keys(value))if(!allowed.includes(key))problem(object,file,'unsupported_pulse_property','Translate source property '+key+' before native preview.')}
 // Retain dependencies even for refused definitions, so source erasure withdraws originals too.
 for(const raw of Object.values(read.input.bindings)){const binding=obj(raw);if(typeof binding.dataset==='string'){const source=sources.find(s=>s.id===binding.dataset);if(source)used.set(source.id,source.revision)}}
 for(const metric of read.records.filter(r=>r.kind==='pulse-metric')){
  const start=diagnostics.length
  try{
   const m=metric.value,definition=read.records.find(r=>r.id==='definition:'+m.definition_id),binding=obj(read.input.bindings[String(m.id)])
   if(!definition){problem(metric.id,metric.file,'pulse_definition_missing','Supply the original definition response.');continue}
   const d=definition.value,metadata=obj(d.metadata),spec=obj(d.specification),basic=obj(spec.basic_specification),measure=obj(basic.measure),time=obj(basic.time_dimension),datasource=obj(spec.datasource),ms=obj(m.specification)
   const sourceId=txt(datasource.id,128),model=read.models.find(m=>m.sourceId===sourceId),source=sources.find(s=>s.id===binding.dataset),columns=obj(binding.columns)
   if(Number(read.input.apiVersion.split('.')[1])<21)problem(metric.id,metric.file,'pulse_api_version_unsupported','Pulse requires Tableau Cloud REST API 3.21 or later; no Server capability is established.')
   if(metadata.schema_version!=='1.0.0'||m.schema_version!=='1.0.0'||typeof metadata.definition_version!=='string'||!/^\d+$/.test(metadata.definition_version)||typeof m.metric_version!=='string'||!/^\d+$/.test(m.metric_version))problem(metric.id,metric.file,'pulse_schema_version','Supply versioned 1.0.0 definition and metric responses.')
   if(datasource.id_type!=='DATASOURCE_ID_TYPE_LUID'||m.datasource_luid&&m.datasource_luid!==sourceId||!model||model.project.tables.length!==1)problem(metric.id,metric.file,'pulse_source_unresolved','Bind one original published-source LUID with a supplied supported TDS.')
   if(!source||binding.revision!==source.revision)problem(metric.id,metric.file,'pulse_snapshot_unreviewed','Map the exact revision of a separately reviewed native snapshot.')
   if(read.diagnostics.some(i=>i.blocksPreview&&(i.object==='source:'+sourceId||i.code==='missing_dependency'||i.code==='published_definition_missing'||i.code==='unmapped_tds'||i.code==='tds_definition_missing'||i.code==='incomplete_subscriptions')))problem(metric.id,metric.file,'pulse_package_unresolved','Resolve packaged definitions, security and dependency gaps before preview.')
   properties(binding,['dataset','revision','columns','grain','timezone','context'],metric.id,metric.file)
   properties(metadata,['id','name','description','schema_version','definition_version','metric_version','created_at','last_updated_user','related_links'],definition.id,definition.file)
   properties(m,['id','definition_id','datasource_luid','schema_version','metric_version','specification','is_default','is_followed','goals','tags'],metric.id,metric.file)
   properties(d,['metadata','specification','extension_options','representation_options','certification','metrics','total_metrics','datasource_goals','comparisons','insights_options','tags'],definition.id,definition.file)
   properties(spec,['basic_specification','datasource','is_running_total','temporality'],definition.id,definition.file)
   if(spec.is_running_total===true||spec.temporality&&!['TEMPORALITY_UNSPECIFIED','TEMPORALITY_OVER_TIME'].includes(String(spec.temporality)))problem(metric.id,metric.file,'pulse_temporality_unsupported','Running totals and point-in-time semantics require explicit translation.')
   properties(basic,['measure','time_dimension','filters'],definition.id,definition.file);properties(measure,['field','aggregation'],definition.id,definition.file);properties(time,['field'],definition.id,definition.file);properties(datasource,['id','id_type'],definition.id,definition.file)
   properties(ms,['filters','measurement_period','comparison'],metric.id,metric.file)
   if(!empty(ms.comparison))problem(metric.id,metric.file,'pulse_comparison_unsupported','Comparison semantics remain unresolved; no native value is presented.')
   const extension=d.extension_options?obj(d.extension_options):{}
   properties(extension,['allowed_dimensions','allowed_granularities'],definition.id,definition.file)
   const table=model?.project.tables[0],field=txt(measure.field),date=txt(time.field)
   const bind=(field:string)=>{const column=columns[field],original=table?.dimensions.find(d=>d.column===physical(field)),target=source?.table.columns.find(c=>c.name===column);if(typeof column!=='string'||!original||!target||original.type!==target.type&&!(original.type==='number'&&target.type==='money'))throw Error('physical');return column}
   const amount=bind(field),dateColumn=bind(date),operation=measure.aggregation==='AGGREGATION_SUM'?'sum':measure.aggregation==='AGGREGATION_COUNT_DISTINCT'?'count-distinct':null
   if(!operation)problem(metric.id,metric.file,'pulse_aggregation_unsupported','Only scalar SUM and count-distinct physical measures are translated.')
   if(source?.table.columns.find(c=>c.name===dateColumn)?.type!=='date')problem(metric.id,metric.file,'pulse_date_binding','Bind the physical date dimension to a native date column.')
   const period=obj(ms.measurement_period),specific=obj(period.specific_period)
   properties(period,['granularity','range','specific_period'],metric.id,metric.file);properties(specific,['date','end_date'],metric.id,metric.file)
   const from=txt(specific.date,10),to=txt(specific.end_date,10)
   if(period.range!=='RANGE_BY_CONFIG'||!['GRANULARITY_BY_DAY','GRANULARITY_BY_MONTH','GRANULARITY_BY_QUARTER','GRANULARITY_BY_YEAR'].includes(String(period.granularity))||!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||new Date(from).toISOString().slice(0,10)!==from||new Date(to).toISOString().slice(0,10)!==to||from>to)problem(metric.id,metric.file,'pulse_date_context','Supply a documented fixed specific-period range; relative periods are not inferred.')
   const filters:Filter[]=[{column:dateColumn,op:'gte',value:from},{column:dateColumn,op:'lte',value:to}]
   for(const [raw,instance] of [[basic.filters??[],false],[ms.filters??[],true]] as const)for(const value of list(raw,32)){
    const f=obj(value),name=txt(f.field),values=list(f.categorical_values,1)
    properties(f,['field','operator','categorical_values','include_null'],metric.id,metric.file)
    if(f.operator!=='OPERATOR_EQUAL'||values.length!==1)throw Error('filter')
    const v=obj(values[0]);if(Object.keys(v).length!==1)throw Error('filter')
    let literal:string|boolean|null
    if(typeof v.string_value==='string')literal=v.string_value
    else if(typeof v.bool_value==='boolean')literal=v.bool_value
    else if(v.null_value==='NULL_VALUE')literal=null
    else throw Error('filter')
    if(f.include_null!==undefined&&typeof f.include_null!=='boolean'||f.include_null===true&&literal!==null||literal===null&&f.include_null!==true)throw Error('filter')
    if(instance&&(!Array.isArray(extension.allowed_dimensions)||!extension.allowed_dimensions.includes(name)))throw Error('filter')
    filters.push({column:bind(name),op:literal===null?'is-null':'eq',...(literal===null?{}:{value:literal})})
   }
   const representation=d.representation_options?obj(d.representation_options):{}
   properties(representation,['type','currency_code','decimal_places','sentiment_type'],definition.id,definition.file)
   const money=representation.type==='NUMBER_FORMAT_TYPE_CURRENCY',unit=operation==='count-distinct'?'count':money?'money':'number',scale=operation==='count-distinct'?0:representation.decimal_places
   if(operation==='count-distinct'&&money||money&&representation.currency_code!=='CURRENCY_CODE_USD'||!money&&representation.type!=='NUMBER_FORMAT_TYPE_NUMBER')problem(metric.id,metric.file,'pulse_unit_unsupported','Supply explicit supported numeric or USD presentation semantics.')
   const query=queryInput({version:1,dataset:binding.dataset,joins:[],groupBy:[],filters,measures:[{id:'value',op:operation,column:amount,unit,scale,...money?{sourceCurrency:'USD'}:{},...operation==='sum'?{empty:'null'}:{}}],context:binding.context})
   if(!Array.isArray(binding.grain)||!binding.grain.length||binding.grain.some(k=>typeof k!=='string'))throw Error('grain')
   query.semantic={grain:binding.grain as string[],dimensions:source!.table.columns.map(c=>({column:c.name,type:c.type})),hierarchies:[],slowlyChanging:'reject-duplicate-grain'}
   // Native context enforces the installation timezone again at preview and save.
   const doc=metricDefinition({name:txt(metadata.name,160),description:'Inactive Tableau Pulse migration from '+String(m.id)+'. Source parity and delivery remain unproved.',grain:(binding.grain as string[]).join(', '),unit,timezone:txt(binding.timezone,100),accountingBasis:query.context.accountingBasis,query})
   // Encode the full pair's SHA-256 in base 36 to fit the native ID limit
   // without discarding any project characters or hash bits.
   if(!diagnostics.slice(start).some(d=>d.blocksPreview))drafts.push({sourceMetric:String(m.id),document:{version:1,id:('tableau-'+BigInt('0x'+sha256(canonicalJson([projectId,String(m.id)]))).toString(36)),definition:doc}})
  }catch{problem(metric.id,metric.file,'pulse_binding_or_semantics_unresolved','Supply explicit physical columns, current snapshot revision, unique grain, timezone, native calendar context, fixed dates and supported equality filters.')}
 }
 for(const def of read.records.filter(r=>r.kind==='pulse-definition')){
  if(!read.records.some(r=>r.kind==='pulse-metric'&&r.value.definition_id===obj(def.value.metadata).id))problem(def.id,def.file,'pulse_metric_missing','Supply an original metric response including its filters and measurement period.')
  diagnostics.push({object:def.id,file:def.file,code:'pulse_authority_inactive',message:'Source certification, ownership, goals, thresholds, comparisons and insights are inactive references. Human certification, recipient reauthorization and provider evidence remain required.',blocksPreview:false})
 }
 return {...read,diagnostics,drafts,sources:[...used].map(([id,revision])=>({id,revision}))}
}
