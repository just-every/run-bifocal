import type { ProjectFile } from './types'
import { flowLocation, type FlowDefinition, type FlowStep } from './flow-types'
import { mTokens, mIdentifier, mCall, mList, splitM, type MToken } from './flow-m-syntax'

const types:Record<string,string>={number:'number',text:'text',date:'date',logical:'boolean'}
function native(expression:MToken[]):Pick<FlowStep,'operation'|'nativeSteps'>|null {
 const distinct=mCall(expression,'Table.Distinct')
 if(distinct?.length===1&&mIdentifier(distinct[0]))return {operation:'dedupe',nativeSteps:[{op:'dedupe'}]}
 const cast=mCall(expression,'Table.TransformColumnTypes')
 if(!cast||cast.length!==2||!mIdentifier(cast[0]))return null
 const pairs=mList(cast[1]);if(!pairs?.length||pairs.length>32)return null
 const steps:Record<string,unknown>[]=[],columns=new Set<string>()
 for(const pair of pairs){
  const fields=mList(pair)
  if(!fields||fields.length!==2||fields[0].length!==1||fields[0][0].kind!=='text'||fields[0][0].value.includes('#('))return null
  const type=fields[1]
  if(type.length!==2||type[0].quoted||type[0].value!=='type'||type[1].quoted||!types[type[1].value])return null
  const column=fields[0][0].value;if(!column||column.length>128||columns.has(column))return null
  columns.add(column);steps.push({op:'cast',column,type:types[type[1].value]})
 }
 return {operation:'cast',nativeSteps:steps}
}
function source(tokens:MToken[]):boolean {
 // These source handles are bound to a separately reviewed snapshot. They are
 // never opened, fetched or evaluated, and cannot conceal a transformation.
 const shape=tokens.map(t=>t.kind==='text'?JSON.stringify(t.value):t.quoted?'#'+JSON.stringify(t.value):t.value).join('')
 return /^Excel\.CurrentWorkbook\(\)\{\[Name="(?:[^"\\]|\\.)+"\]\}\[Content\]$/.test(shape)&&!tokens.some(t=>t.value.includes('#('))
}
export function readMFlow(file:ProjectFile):FlowDefinition {
 const result:FlowDefinition={format:'powerquery',steps:[],output:null,errors:[]}
 try{
  const tokens=mTokens(file.content)
  if(tokens[0]?.value!=='let'||tokens[0].quoted)throw Error('Supply one original M let expression.')
  const halves=splitM(tokens.slice(1),'in')
  if(halves.length!==2)throw Error('Supply a bounded sequential let expression with a final identifier.')
  const declarations=splitM(halves[0],',')
  if(!declarations.length||declarations.length>32)throw Error('A flow supports between one and 32 source steps.')
  const names:string[]=[],expressions:MToken[][]=[]
  for(const declaration of declarations){
   const name=mIdentifier(declaration.slice(0,1))
   if(!name||name.length>128||['Excel.CurrentWorkbook','Table.Distinct','Table.TransformColumnTypes','let','in','type'].includes(name)||names.includes(name)||declaration[1]?.value!=='='||declaration.length<3)throw Error('Each M step requires a unique identifier and expression without shadowing supported functions.')
   names.push(name);expressions.push(declaration.slice(2))
  }
  for(const [index,expression] of expressions.entries()){
   const name=names[index],id=file.path+'#'+name,start=expression[0].start,end=expression.at(-1)!.end
   const dependencies=[...new Set(expression.filter(t=>t.kind==='id'&&names.includes(t.value)).map(t=>file.path+'#'+t.value))]
   const translated=index===0&&source(expression)?{operation:'source' as const,nativeSteps:[]}:native(expression)
   const sequential=index===0?dependencies.length===0:dependencies.length===1&&dependencies[0]===file.path+'#'+names[index-1]
   const step:FlowStep={id,name,dependencies,sourceExpression:file.content.slice(start,end),location:flowLocation(file.path,file.content,start,end),operation:'unsupported',nativeSteps:[]}
   if(translated&&sequential)Object.assign(step,translated)
   else {step.code=sequential?'unsupported_m_step':'nonsequential_m_dependency';step.message=sequential?'Only a bound workbook table, canonical type changes and complete-row distinct are translated. Functions, culture, selectors, scripts and external sources remain unresolved.':'Only a single sequential source chain can become a native preparation.'}
   result.steps.push(step)
  }
  const output=mIdentifier(halves[1]);result.output=output&&names.includes(output)?file.path+'#'+output:null
  if(output!==names.at(-1))result.errors.push({code:'m_output_not_final_step',message:'The final expression must name the final source step; every declared step remains in the report.'})
 }catch(error){result.errors.push({code:'invalid_m_flow',message:error instanceof Error?error.message:'Invalid M flow.'})}
 return result
}
