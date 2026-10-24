import { issue, name, objects, physical, provenance, record, text, unknownKeys, yaml } from './common'
import type { ModelTable, Project, ProjectFile } from './types'

/** dbt's semantic_models spec is shared by MetricFlow. New column-level
 * specifications are reported, never reinterpreted as the older schema. */
export function readSemanticYAML(p: Project, files: ProjectFile[]) {
 const entities: {table: ModelTable; name: string; column: string; type: string}[] = []
 for (const file of files) {
  if (!/\.ya?ml$/i.test(file.path)) { issue(p, provenance(file,file.content), file.path, 'yaml_file_required', 'Supply semantic model YAML; SQL and project execution are unsupported.'); continue }
  const root = yaml(p,file); if (!root) continue
  const at = provenance(file,root)
  unknownKeys(p,at,file.path,root,['semantic_models','metrics','version'])
  if (root.version !== undefined && root.version !== 2) issue(p,at,file.path,'unsupported_schema_version','Only the documented version 2 YAML envelope is recognized.',root.version)
  for (const metric of objects(p,at,'metrics',root.metrics)) issue(p,provenance(file,metric),String(metric.name ?? 'metric'),'metric_definition_requires_translation','Metric definitions require explicit context and dependency translation; source measures alone do not implement them.')
  for (const model of objects(p,at,'semantic_models',root.semantic_models)) {
   const loc = provenance(file,model), modelName = name(p,loc,model.name,'semantic model'); if (!modelName) continue
   unknownKeys(p,loc,modelName,model,['name','model','description','label','entities','dimensions','measures','defaults','primary_entity'])
   const ref = typeof model.model === 'string' ? /^ref\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*\)$/.exec(model.model.trim()) : null
   if (!ref) issue(p,loc,modelName,'unsupported_model_reference','Bind a single documented ref(name); packages, versions, source macros and SQL need explicit implementation.',model.model)
   const table: ModelTable = {...loc,name:modelName,sourceTable:ref?.[2]??null,dimensions:[],measures:[]}; p.tables.push(table)
   p.explores.push({...loc,name:modelName,table:modelName,joins:[]})
   if (model.defaults !== undefined) {
    if (!record(model.defaults)) issue(p,loc,modelName,'invalid_defaults','Expected defaults mapping.',model.defaults)
    else { unknownKeys(p,loc,`${modelName}.defaults`,model.defaults,['agg_time_dimension']); if (model.defaults.agg_time_dimension !== undefined) issue(p,loc,modelName,'aggregation_calendar_binding','Bind the aggregation time dimension and fiscal calendar explicitly.',model.defaults) }
   }
   if (model.primary_entity !== undefined) issue(p,loc,modelName,'primary_entity_binding','Resolve the declared primary entity to its physical unique grain.',model.primary_entity)
   for (const entity of objects(p,loc,`${modelName}.entities`,model.entities)) {
    const e = provenance(file,entity), n = name(p,e,entity.name,`${modelName}.entity`); if (!n) continue
    unknownKeys(p,e,`${modelName}.${n}`,entity,['name','type','expr','description','label'])
    const column = physical(entity.expr ?? n), kind = text(entity.type)
    if (!column || !kind || !['primary','unique','foreign','natural'].includes(kind)) { issue(p,e,`${modelName}.${n}`,'unsupported_entity','Entity needs a physical-column expression and a documented entity type.'); continue }
    if (kind === 'natural') issue(p,e,`${modelName}.${n}`,'natural_entity_history','Natural entities require explicit slowly-changing-dimension validity handling.')
    table.dimensions.push({...e,name:n,column,type:'unknown',sourceType:'entity',primaryKey:kind==='primary',sourceExpression:String(entity.expr??n)})
    entities.push({table,name:n,column,type:kind})
   }
   for (const dimension of objects(p,loc,`${modelName}.dimensions`,model.dimensions)) {
    const d = provenance(file,dimension), n = name(p,d,dimension.name,`${modelName}.dimension`); if (!n) continue
    unknownKeys(p,d,`${modelName}.${n}`,dimension,['name','type','expr','description','label','type_params'])
    const column = physical(dimension.expr??n), sourceType = text(dimension.type)
    if (!column || !sourceType || !['categorical','time'].includes(sourceType)) { issue(p,d,`${modelName}.${n}`,'unsupported_dimension','Expected a physical column and categorical or time type.'); continue }
    if (dimension.type_params !== undefined) issue(p,d,`${modelName}.${n}`,'time_dimension_parameters','Time granularity and validity parameters need explicit native calendar and date-type mapping.',dimension.type_params)
    table.dimensions.push({...d,name:n,column,type:'unknown',sourceType,primaryKey:false,sourceExpression:String(dimension.expr??n)})
   }
   for (const measure of objects(p,loc,`${modelName}.measures`,model.measures)) {
    const m = provenance(file,measure), n = name(p,m,measure.name,`${modelName}.measure`); if (!n) continue
    unknownKeys(p,m,`${modelName}.${n}`,measure,['name','agg','expr','description','label'])
    const column = physical(measure.expr??n), op = measure.agg === 'sum' ? 'sum' : measure.agg === 'count_distinct' ? 'count-distinct' : null
    if (!column || !op) { issue(p,m,`${modelName}.${n}`,'unsupported_measure','Implement this aggregation or expression; only sum and count_distinct on physical columns are translated.'); continue }
    table.measures.push({...m,name:n,op,column,sourceExpression:String(measure.expr??n)})
   }
  }
 }
 for (const from of entities.filter(e=>e.type==='foreign')) {
  const targets = entities.filter(e=>e.name===from.name && e.table!==from.table && ['primary','unique'].includes(e.type))
  if (targets.length > 1) { issue(p,from.table,`${from.table.name}.${from.name}`,'ambiguous_entity_join','Select an explicit entity join target.'); continue }
  if (targets.length === 1) {
   const target=targets[0], explore=p.explores.find(e=>e.table===from.table.name)!
   explore.joins.push({file:from.table.file,sourceExpression:`${from.name}: ${from.column} = ${target.table.name}.${target.column}`,name:target.table.name,table:target.table.name,left:from.column,right:target.column,cardinality:'many-to-one'})
  }
 }
}
