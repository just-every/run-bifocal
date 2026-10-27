import { compilePreparation, preparationFormats, type FlowReport } from './preparation'
import { readProject, type ProjectFile, type ProjectFormat, type ReadIssue } from './readers'
import { queryInput } from '../../query/validate'
import { definitionInput, type Definition } from '../../models/validation/protocol'
import type { Source, Query, Measure } from '../../query/types'
import { canonicalJson, sha256 } from '../../../modules/import-kit/src/provenance/identity.ts'
import { executeDBT } from './dbt-execution'

export type Binding={dataset:string;grain:string[];columns?:Record<string,string>}
export type ModelImportInput={version:1;projectId:string;format:ProjectFormat;files:ProjectFile[];bindings:Record<string,Binding>;context:Query['context'];sourceOutputs?:import('../../preparation/compare').SourceStepOutput[];formats:Record<string,{unit:Measure['unit'];scale:number;sourceCurrency?:string}>}
export type CompiledProject={ownerId:string;input:ModelImportInput;digest:string;report:{project:ReturnType<typeof readProject>;issues:ReadIssue[];compatible:boolean;translations:{sourceObject:string;sourceExpression:string;view:string;measure:Measure}[]};preparation?:FlowReport[];definition:Definition|null;sources:{id:string;revision:string}[]}
const nativeName=(name:string)=>{const normalized=name.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');const id=/^[a-z]/.test(normalized)?normalized:'source-'+normalized;return id.length<=64?id:id.slice(0,50)+'-'+sha256(name).slice(0,12)}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
export function compileProject(value:unknown,id:string,ownerId:string,sources:Source[]):CompiledProject {
 if(!object(value)||Object.keys(value).some(k=>!['version','projectId','format','files','bindings','context','formats','sourceOutputs'].includes(k))||value.version!==1||value.projectId!==id||!object(value.bindings)||!object(value.formats)||!object(value.context))throw Error('MODEL_PROJECT_ENVELOPE_REQUIRED')
 const input=value as unknown as ModelImportInput,project=readProject(input.format,input.files)
 if((preparationFormats as readonly string[]).includes(input.format)){
  const preparation=compilePreparation(input,sources),issues=[...project.issues]
  if(!preparation.length)issues.push({file:'',sourceExpression:'',object:'project',code:'preparation_flow_required',message:'No source preparation flow was found.'})
  for(const flow of preparation)for(const step of flow.steps)if(!['translated','parameter'].includes(step.status))issues.push({file:step.file,sourceExpression:step.sourceExpression,object:flow.id+'::'+step.id,code:step.status==='blocked'?'preparation_dependency_blocked':'unsupported_preparation_step',message:step.reason??'Translate this source step.'})
  const used=[...new Set(preparation.flatMap(f=>f.steps.flatMap(s=>s.document?[s.document.dataset,...s.document.steps.filter(op=>['join','lookup','union'].includes(String(op.op))).map(op=>String(op.dataset))]:[])).concat(Object.values(input.bindings).map(b=>b?.dataset)))].filter(id=>sources.some(s=>s.id===id))
  return {ownerId,input,digest:sha256(canonicalJson(input)),preparation,report:{project,issues,translations:[],compatible:preparation.length>0&&issues.length===0&&preparation.every(f=>f.compatible)},definition:null,sources:used.map(id=>({id,revision:sources.find(s=>s.id===id)!.revision}))}
 }
 if(input.sourceOutputs!==undefined)throw Error('Source step outputs apply only to preparation formats.')
 executeDBT(project,input.bindings,sources)
 const issues=[...project.issues],used=new Map<string,string>(),views:Definition['views']=[],translations:CompiledProject['report']['translations']=[]
 // Even an unresolved source definition owes custody to every explicitly bound
 // dataset. Erasure must reach its originals before it can ever be executable.
 for(const binding of Object.values(input.bindings))if(object(binding)&&typeof binding.dataset==='string'){const source=sources.find(s=>s.id===binding.dataset);if(source)used.set(source.id,source.revision)}
 const problem=(object:string,code:string,message:string,sourceExpression='')=>issues.push({file:'',object,code,message,sourceExpression})
 if(Object.keys(input.bindings).some(name=>!project.tables.some(t=>t.name===name)))problem('bindings','unknown_table_binding','Every binding must identify a source model table.')
 const bind=(tableName:string)=>{
  const table=project.tables.find(t=>t.name===tableName),binding=input.bindings[tableName]
  if(!table||!object(binding)||Object.keys(binding).some(k=>!['dataset','grain','columns'].includes(k))||typeof binding.dataset!=='string'||!Array.isArray(binding.grain)||!binding.grain.length||binding.grain.some(c=>typeof c!=='string')||binding.columns!==undefined&&(!object(binding.columns)||Object.values(binding.columns).some(c=>typeof c!=='string'))){problem(tableName,'source_binding_required','Map the logical table to an imported dataset with explicit physical grain.');return null}
  const source=sources.find(s=>s.id===binding.dataset)
  if(!source){problem(tableName,'source_unavailable','Import and review the bound source records first.');return null}
  used.set(source.id,source.revision)
  const column=(name:string)=>binding.columns?.[name]??name
  for(const dimension of table.dimensions){const target=source.table.columns.find(c=>c.name===column(dimension.column));if(!target)problem(tableName+'.'+dimension.name,'dimension_unavailable','Map this physical source column.',dimension.sourceExpression);else if(dimension.type!=='unknown'&&dimension.type!==target.type&&!(dimension.type==='number'&&target.type==='money'))problem(tableName+'.'+dimension.name,'dimension_type_mismatch','Review the source and imported column types.',dimension.sourceExpression)}
  return {table,binding,source,column}
 }
 for(const explore of project.explores){
  const base=bind(explore.table);if(!base)continue
  const viewId=nativeName(explore.name)
  if(views.some(v=>v.id===viewId)){problem(explore.name,'native_identifier_conflict','Two source objects normalize to the same native ID. Resolve their identities explicitly; neither is merged.');continue}
  const measures:Measure[]=[]
  for(const m of base.table.measures){
   const format=input.formats[base.table.name+'.'+m.name]
   if(!object(format)||Object.keys(format).some(k=>!['unit','scale','sourceCurrency'].includes(k))){problem(base.table.name+'.'+m.name,'measure_format_required','Supply the exact native unit, scale and source currency for this measure.',m.sourceExpression);continue}
   if(m.sourceTable&&m.sourceTable!==base.table.name){problem(base.table.name+'.'+m.name,'cross_table_measure','A measure from another logical table needs its own explicit model view.',m.sourceExpression);continue}
   const measureId=nativeName(m.name)
   if(measures.some(v=>v.id===measureId)){problem(base.table.name+'.'+m.name,'native_identifier_conflict','Two source measures normalize to the same native ID; no definitions are merged.');continue}
   const measure={id:measureId,op:m.op,...(m.empty?{empty:m.empty}:{}),...(m.column?{column:base.column(m.column)}:{}),...format} as Measure
   measures.push(measure)
   translations.push({sourceObject:base.table.name+'.'+m.name,sourceExpression:m.sourceExpression,view:viewId,measure})
  }
  const joins:Query['joins']=[]
  for(const j of explore.joins){const target=bind(j.table);if(target)joins.push({dataset:target.source.id,as:nativeName(j.name),left:base.column(j.left),right:target.column(j.right),duplicates:'reject',cardinality:j.cardinality})}
  if(!measures.length){problem(explore.name,'no_supported_measures','Implement at least one measure and its exact format before publication.');continue}
  try{
   const query=queryInput({version:1,dataset:base.source.id,joins,filters:[...(explore.filters??[]).map(f=>({...f,column:base.column(f.column)})),...(explore.boundFilters??[])],groupBy:(explore.groupBy??[]).map(base.column),measures,context:input.context,semantic:{grain:base.binding.grain,dimensions:[...new Set([...base.table.dimensions.map(d=>base.column(d.column)),...base.binding.grain])].map(name=>{const column=base.source.table.columns.find(c=>c.name===name);if(!column)throw Error('MODEL_DIMENSION_UNAVAILABLE');return {column:column.name,type:column.type}}),hierarchies:[],slowlyChanging:'reject-duplicate-grain'}})
   views.push({id:viewId,kind:'chart',query,rowRules:[]})
  }catch{problem(explore.name,'invalid_native_query','The selected source mapping, grain, relationships, formats or calendar cannot compile into an exact native query.')}
 }
 // These are explicit reviewed mapping obligations, resolved by the supplied
 // physical binding, not source-expression translations or inferred defaults.
 if(!views.length)problem('project','no_executable_explores','Include an Explore with a supported mapped measure.')
 const unresolved=issues.filter(i=>i.code!=='source_table_binding'||!input.bindings[i.object])
 const definition=views.length?definitionInput({views,quality:[]}):null
 return {ownerId,input,digest:sha256(canonicalJson(input)),report:{project,issues:unresolved,translations,compatible:views.length>0&&unresolved.length===0},definition,sources:[...used].map(([id,revision])=>({id,revision}))}
}
