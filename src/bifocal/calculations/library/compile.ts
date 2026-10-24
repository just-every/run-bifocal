import { translateFormula, readTMDLCalculations, readTableauCalculations, type TranslationOptions } from '../../imports/calculations'
import { validateExpression, evaluateCalculations, evaluateCalculatedField, type CalculationExpr } from '../core'
import { fail } from '../../query/types'
import type { CalculationScope } from './governance.server'
import type { Formula, Library, LibraryInput } from './types'
import { readTMDLParameters } from '../../imports/calculations/parameters'
import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import { decimal } from '../../currency/decimal'
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(v)
const formats=/^(?:0|0\.0{1,8}|#,##0(?:\.0{1,8})?|0(?:\.0{1,8})?%|\$#,##0(?:\.0{1,8})?)$/
export function compileLibrary(raw:unknown,expectedId:string,ownerId:string,scope:CalculationScope):Library{
 const input=structuredClone(raw) as LibraryInput,schema={...scope.schema},rows=scope.rows.map(row=>({...row}))
 if(!input||input.version!==1||input.id!==expectedId||!id(input.id)||typeof input.label!=='string'||input.label.length>160||input.modelId!==scope.model.id||input.modelRevision!==scope.model.production||input.viewId!==scope.view.id)fail('calculation_binding_changed',409)
 if(Object.keys(input).some(k=>!['version','id','label','modelId','modelRevision','viewId','calculations','groups','parameters','fieldParameters','source','table','window'].includes(k)))fail('calculation_input_property',400)
 input.calculations??=[];input.groups??=[];input.parameters??=[];input.fieldParameters??=[]
 if(!Array.isArray(input.calculations)||input.calculations.length>64||!Array.isArray(input.groups)||input.groups.length>16||!Array.isArray(input.parameters)||input.parameters.length>16||!Array.isArray(input.fieldParameters)||input.fieldParameters.length>8)fail('calculation_library_limit',413)
 const fields=Object.fromEntries(Object.keys(schema).flatMap(field=>[[field,field],...(input.table?[[input.table+'.'+field,field]]:[])])),resolved:Record<string,CalculationExpr>={},parameterValues=Object.fromEntries(input.parameters.map(p=>[p.id,p.default]))
 for(const p of input.parameters){if(!id(p.id)||p.default?.type!=='number'||typeof p.default.value!=='string')fail('numeric_parameter_required',400);for(const n of [p.default.value,p.min,p.max,p.step])if(n!==undefined)decimal(n);if(p.min===undefined||p.max===undefined||p.step===undefined)fail('bounded_parameter_required',400)}
 if(new Set(input.parameters.map(p=>p.id)).size!==input.parameters.length)fail('duplicate_parameter',400)
 for(const p of input.fieldParameters)if(!id(p.id)||!p.choices||Object.keys(p.choices).length>32||!Object.hasOwn(p.choices,p.default)||Object.values(p.choices).some(fields=>!Array.isArray(fields)||fields.length>8||fields.some(f=>!Object.hasOwn(schema,f))))fail('invalid_field_parameter',400)
 const options:TranslationOptions={fields,measures:resolved,fieldTypes:schema,table:input.table,fiscal:scope.fiscal,window:input.window,fixedContextBound:true}
 let formulas=input.calculations,groupFormulas=input.groups
 const dependencies:unknown[]=[],issues:Library['report']['issues']=[]
 if(input.source){
  if(!['tmdl','tableau'].includes(input.source.format)||typeof input.source.content!=='string')fail('source_calculation_container_required',400)
  if(input.source.format==='tmdl'){
   const extracted=readTMDLParameters(input.source.content,fields)
   issues.push(...extracted.issues)
   if(input.parameters.length&&canonicalJson(input.parameters)!==canonicalJson(extracted.parameters)||input.fieldParameters.length&&canonicalJson(input.fieldParameters)!==canonicalJson(extracted.fieldParameters))fail('source_parameter_definition_conflict',409)
   input.parameters=extracted.parameters;input.fieldParameters=extracted.fieldParameters
   for(const parameter of input.parameters)parameterValues[parameter.id]=parameter.default
   options.parameterBindings=extracted.bindings
  }
  const container=(input.source.format==='tmdl'?readTMDLCalculations:readTableauCalculations)(input.source.content,options)
  issues.push(...container.issues.filter(issue=>issue.code!=='tmdl_parameter_dependency'||!container.dependencies.every(d=>input.parameters.some(p=>p.id===d.name.toLowerCase())||input.fieldParameters.some(p=>p.id===d.name.toLowerCase()))));dependencies.push(...container.dependencies)
  if(input.calculations.length||input.groups.length)fail('source_container_or_formulas_required',400)
  formulas=container.calculations.filter(c=>c.kind!=='calculation-item').map(c=>({id:c.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),sourceName:c.name,language:input.source!.format==='tmdl'?'dax':'tableau',sourceExpression:c.sourceExpression,...(c.format?{format:c.format}:{})}))
  groupFormulas=container.calculations.filter(c=>c.kind==='calculation-item'&&c.group?.precedence!==null).map(c=>({id:c.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''),language:'dax',sourceExpression:c.sourceExpression,precedence:c.group!.precedence!,...(c.format?{format:c.format}:{})}))
  for(const c of container.calculations)issues.push(...c.issues.filter(issue=>!['unmapped_reference','parameter_selection_binding'].includes(issue.code)))
 }
 const calculatedFields:Library['fields']=[]
 const translations:Library['report']['translations']=[],measures:Library['measures']=[],groups:Library['groups']=[]
 const translate=(formula:Formula,group=false)=>{
  if(!id(formula.id)||!['excel','dax','tableau','native'].includes(formula.language)||typeof formula.sourceExpression!=='string'||formula.sourceExpression.length>16384)fail('bounded_calculation_required',400)
  const result=formula.language==='native'?{sourceExpression:formula.sourceExpression,targetExpression:formula.expression??null,issues:[]}:translateFormula(formula.language,formula.sourceExpression,options)
  if(result.targetExpression)try{validateExpression(result.targetExpression,schema,parameterValues,group)}catch(error){result.issues.push({code:'native_context_gap',message:String(error),sourceExpression:formula.sourceExpression});result.targetExpression=null}
  if(formula.format!==undefined&&!formats.test(formula.format)){result.issues.push({code:'format_string_gap',message:'Implement and verify this source format string before activation.',sourceExpression:formula.format});result.targetExpression=null}
  translations.push({...formula,...result});if(result.targetExpression&&formula.kind!=='field'){resolved[formula.id]=result.targetExpression;const sourceName=(formula as Formula&{sourceName?:string}).sourceName;if(sourceName)resolved[sourceName]=result.targetExpression}
  return result.targetExpression
 }
 for(const formula of formulas){const expression=translate(formula);if(expression){if(formula.kind==='field'){if(Object.hasOwn(schema,formula.id)||!['number','text','date','boolean'].includes(formula.dataType??''))fail('new_typed_calculated_field_required',400);calculatedFields.push({...formula,expression});schema[formula.id]=formula.dataType!;fields[formula.id]=formula.id;for(const row of rows){const value=evaluateCalculatedField(expression,row,schema,parameterValues);if(value.type!=='null'&&value.type!==formula.dataType)fail('calculated_field_type_changed',422);(row as Record<string,import('../core').InputCell>)[formula.id]=value.type==='null'?null:value.type==='number'?value:value.value}}else measures.push({id:formula.id,expression,...(formula.format===undefined?{}:{format:formula.format})})}}
 for(const formula of groupFormulas){const expression=translate(formula,true);if(expression)groups.push({id:formula.id,precedence:formula.precedence,expression,...(formula.format===undefined?{}:{format:formula.format})})}
 if(!formulas.length||new Set([...formulas,...groupFormulas].map(f=>f.id)).size!==formulas.length+groupFormulas.length)fail('unique_calculation_library_required',400)
 const compatible=!issues.length&&translations.every(t=>!t.issues.length&&!!t.targetExpression)
 if(compatible)evaluateCalculations({authorizedRows:rows,schema:schema,filters:[],groupBy:[...new Set([...(input.window?.partitionBy??[]),...(input.window?.orderBy??[]).flatMap(o=>'field' in o?[o.field]:[])])],measures,parameters:parameterValues})
 return {ownerId,input,fields:calculatedFields,report:{compatible,translations,issues,dependencies},measures,groups,schema:schema,guards:scope.guards,sources:scope.sources.map(s=>({id:s.id,revision:s.revision}))}
}
