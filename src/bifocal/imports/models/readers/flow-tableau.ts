import { strFromU8, unzipSync } from 'fflate'
import { record } from './common'
import { flowJSON } from './flow-json'
import { flowLocation, type FlowDefinition, type FlowStep } from './flow-types'
import type { ProjectFile } from './types'

const common=['id','name','nodeType','baseType','nextNodes','serialize','description','beforeActionAnnotations','afterActionAnnotations']
const empty=(value:unknown)=>value===undefined||value===null||Array.isArray(value)&&value.length===0
const pointerKey=(key:string)=>key.replace(/~/g,'~0').replace(/\//g,'~1')
const nativeTypes:Record<string,string>={string:'text',decimal:'number',real:'number',integer:'number',int:'number',date:'date',bool:'boolean',boolean:'boolean'}
function tableauDocument(file:ProjectFile):{content:string;member?:string} {
 if(file.content.trimStart().startsWith('{'))return {content:file.content}
 if(!/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)||file.content.length%4)throw Error('Supply a TFL or TFLX archive encoded as base64, or its original flow JSON.')
 let bytes=0,count=0,unsafe=false
 const archive=Uint8Array.from(atob(file.content),c=>c.charCodeAt(0)),paths=new Set<string>()
 const extracted=unzipSync(archive,{filter(entry){
  count++;bytes+=entry.originalSize
  const path=entry.name
  if(count>64||bytes>1048576||entry.originalSize>262144||paths.has(path)||path.startsWith('/')||path.includes('\\')||path.split('/').some(part=>part==='.'||part==='..')||/[:\u0000-\u001f]/.test(path)){unsafe=true;return false}
  paths.add(path);return path==='flow'
 }})
 if(unsafe)throw Error('Unsafe flow archive path, duplicate member or expanded size. Nothing is extracted to disk.')
 if(!extracted.flow)throw Error('The archive must contain one root flow JSON member. Packaged data and scripts are retained only in the original archive.')
 if(extracted.flow.length>262144)throw Error('Expanded flow definition exceeds its bound.')
 return {content:strFromU8(extracted.flow),member:'flow'}
}
export function readTableauFlow(file:ProjectFile):FlowDefinition {
 const result:FlowDefinition={format:'tableau-prep',steps:[],output:null,errors:[]}
 try{
  const {content,member}=tableauDocument(file),{document,spans}=flowJSON(content)
  if(!record(document)||!record(document.nodes)||!Object.keys(document.nodes).length||Object.keys(document.nodes).length>32)throw Error('A flow needs between one and 32 top-level nodes.')
  const allowed=['parameters','initialNodes','nodes','connections','dataConnections','connectionIds','dataConnectionIds','nodeProperties','extensibility','selection','majorVersion','minorVersion','documentId','obfuscatorId']
  for(const key of Object.keys(document))if(!allowed.includes(key))result.errors.push({code:'unsupported_prep_property',message:'Unrecognized flow property '+key+' remains unresolved.'})
  if(!empty(document.parameters)&&!(record(document.parameters)&&Object.keys(document.parameters).length===0))result.errors.push({code:'unsupported_prep_parameters',message:'Parameterized source semantics need explicit translation.'})
  if(!empty(document.extensibility)&&!(record(document.extensibility)&&Object.keys(document.extensibility).length===0))result.errors.push({code:'unsupported_prep_extensibility',message:'External extensions remain inert and unresolved.'})
  const nodes=document.nodes,ids=Object.keys(nodes),dependencies=new Map(ids.map(id=>[id,[] as string[]])),outgoing=new Map<string,string[]>()
  for(const [id,node] of Object.entries(nodes)){
   if(!record(node)||typeof node.nodeType!=='string'||node.id!==undefined&&node.id!==id)throw Error('Each Prep node needs its original identity and node type.')
   const next=node.nextNodes??[]
   if(!Array.isArray(next))throw Error('Each Prep node needs an explicit edge list.')
   const targets:string[]=[]
   for(const edge of next){
    if(!record(edge)||typeof edge.nextNodeId!=='string'||!dependencies.has(edge.nextNodeId)){result.errors.push({code:'missing_prep_dependency',message:'Every outgoing edge must identify an included node.'});continue}
    if(edge.namespace!==undefined&&edge.namespace!=='Default'||edge.nextNamespace!==undefined&&edge.nextNamespace!=='Default')result.errors.push({code:'unsupported_prep_namespace',message:'Only the default sequential edge namespace is translated.'})
    targets.push(edge.nextNodeId);dependencies.get(edge.nextNodeId)!.push(id)
   }
   outgoing.set(id,targets)
  }
  const roots=ids.filter(id=>!dependencies.get(id)!.length),terminals=ids.filter(id=>!outgoing.get(id)!.length)
  if(roots.length!==1||terminals.length!==1||ids.some(id=>dependencies.get(id)!.length>1||outgoing.get(id)!.length>1))result.errors.push({code:'nonsequential_prep_graph',message:'Only a single sequential source chain is translated; branches, joins and unions remain unresolved.'})
  if(document.initialNodes!==undefined&&(!Array.isArray(document.initialNodes)||document.initialNodes.length!==1||document.initialNodes[0]!==roots[0]))result.errors.push({code:'invalid_prep_initial_nodes',message:'The initial node must match the single source root.'})
  const ordered:string[]=[],seen=new Set<string>(),visit=(id:string)=>{if(seen.has(id))return;seen.add(id);ordered.push(id);for(const target of outgoing.get(id)??[])visit(target)}
  roots.forEach(visit);ids.forEach(visit)
  const position=new Map(ordered.map((id,i)=>[id,i]))
  if(ids.some(id=>dependencies.get(id)!.some(dep=>position.get(dep)!>=position.get(id)!)))result.errors.push({code:'cyclic_prep_dependency',message:'Cycles cannot become a sequential native preparation.'})
  const add=(id:string,node:Record<string,unknown>,pointer:string,deps:string[],nested=false)=>{
   const span=spans.get(pointer)!;if(!span)throw Error('A source node location is unavailable.')
   const step:FlowStep={id:file.path+'#'+id,name:typeof node.name==='string'?node.name:id,dependencies:deps.map(dep=>file.path+'#'+dep),sourceExpression:content.slice(span.start,span.end),location:{...flowLocation(file.path,content,span.start,span.end,pointer),...member?{member}:{}},operation:'unsupported',nativeSteps:[]}
   const type=node.nodeType,annotations=!empty(node.beforeActionAnnotations)||!empty(node.afterActionAnnotations)
   if(!nested&&!annotations&&type==='.v1.LoadSql'&&!deps.length){
    const connection=record(document.connections)?document.connections[String(node.connectionId)]:null
    const attributes=record(connection)&&record(connection.connectionAttributes)?connection.connectionAttributes:null
    const relation=record(node.relation)?node.relation:null
    const sourceKeys=[...common,'connectionId','connectionAttributes','relation','fields']
    const fields=node.fields,fieldKeys=['name','type','collation','caption','ordinal','isGenerated','calc']
    const plainFields=Array.isArray(fields)&&fields.length>0&&fields.length<=64&&fields.every(f=>record(f)&&typeof f.name==='string'&&f.name.length>0&&f.name.length<=128&&nativeTypes[String(f.type)]&&empty(f.calc)&&f.isGenerated!==true&&Object.keys(f).every(key=>fieldKeys.includes(key)))
    if(attributes&&['textscan','excel-direct'].includes(String(attributes.class))&&relation?.type==='table'&&typeof relation.table==='string'&&Object.keys(relation).every(k=>['type','table','schema','catalog'].includes(k))&&Object.keys(node).every(k=>sourceKeys.includes(k))&&plainFields){step.operation='source';step.sourceSchema=fields.map(f=>({name:String(f.name),type:nativeTypes[String(f.type)]}))}
   }else if(!nested&&!annotations&&type==='.v1.ChangeColumnType'&&Object.keys(node).every(k=>[...common,'fields'].includes(k))&&record(node.fields)){
    const types:Record<string,string>={string:'text',decimal:'number',real:'number',date:'date',bool:'boolean',boolean:'boolean'}
    const entries=Object.entries(node.fields)
    if(entries.length>0&&entries.length<=32&&entries.every(([name,f])=>name.length>0&&name.length<=128&&record(f)&&types[String(f.type)]&&empty(f.calc)&&Object.keys(f).every(k=>['type','calc'].includes(k)))){
     step.operation='cast';step.nativeSteps=entries.map(([column,f])=>({op:'cast',column,type:types[String((f as Record<string,unknown>).type)]}))
    }
   }
   if(step.operation==='unsupported'){step.code=nested?'unsupported_nested_prep_step':'unsupported_prep_step';step.message='Only a separately bound local file table and standalone canonical type changes are translated. Containers, output destinations, calculations, filters, joins and scripts remain unresolved.'}
   result.steps.push(step)
   // Retain every nested node as its own unresolved source item. A container
   // cannot hide a script or transform behind a translated outer node.
   if(record(node.loomContainer)&&record(node.loomContainer.nodes))for(const [child,definition] of Object.entries(node.loomContainer.nodes))if(record(definition))add(id+'#'+child,definition,pointer+'/loomContainer/nodes/'+pointerKey(child),[id],true)
   if(record(node.actionNode))add(id+'#action',node.actionNode,pointer+'/actionNode',[id],true)
  }
  for(const id of ordered)add(id,nodes[id] as Record<string,unknown>,'/nodes/'+pointerKey(id),dependencies.get(id)!)
  result.output=terminals.length===1?file.path+'#'+terminals[0]:null
 }catch(error){result.errors.push({code:'invalid_prep_flow',message:error instanceof Error?error.message:'Invalid Prep flow.'})}
 return result
}
