import { evaluateCalculations, evaluateCalculatedField, type CalculationFilter, type Literal } from '../core'
import { decimal, divide } from '../../currency/decimal'
import { formattedAnswer } from './format'
import { fail } from '../../query/types'
import type { Library } from './types'
import type { CalculationScope } from './governance.server'
export type RunInput={filters?:CalculationFilter[];groupBy?:string[];parameters?:Record<string,Literal>;groups?:string[];fieldParameter?:{id:string;choice:string}}
export function runLibrary(library:Library,scope:CalculationScope,input:RunInput={}){
 if(Object.keys(input).some(k=>!['filters','groupBy','parameters','groups','fieldParameter'].includes(k)))fail('calculation_run_property',400)
 const parameters:Record<string,Literal>={}
 for(const supplied of Object.keys(input.parameters??{}))if(!library.input.parameters.some(p=>p.id===supplied))fail('parameter_not_declared',403)
 for(const p of library.input.parameters){const value=input.parameters?.[p.id]??p.default;if(value.type!=='number'||typeof value.value!=='string')fail('numeric_parameter_required',400);const n=decimal(value.value),min=decimal(p.min!),max=decimal(p.max!),step=decimal(p.step!);const compare=(a:typeof n,b:typeof n)=>a.numerator*b.denominator-b.numerator*a.denominator;if(compare(min,max)>0||step.numerator<=0n||compare(n,min)<0n||compare(n,max)>0n)fail('parameter_out_of_bounds',400);const delta={numerator:n.numerator*min.denominator-min.numerator*n.denominator,denominator:n.denominator*min.denominator};if(divide(delta,step).denominator!==1n)fail('parameter_step_required',400);parameters[p.id]=value}
 let groupBy=input.groupBy??[...new Set([...(library.input.window?.partitionBy??[]),...(library.input.window?.orderBy??[]).flatMap(o=>'field' in o?[o.field]:[])])]
 if(input.fieldParameter){const p=library.input.fieldParameters.find(p=>p.id===input.fieldParameter!.id);if(!p||!Object.hasOwn(p.choices,input.fieldParameter.choice))fail('field_parameter_choice_required',403);groupBy=p.choices[input.fieldParameter.choice]}
 const active=input.groups??[]
 if(!Array.isArray(active)||new Set(active).size!==active.length||active.some(id=>!library.groups.some(g=>g.id===id)))fail('calculation_group_selection_required',400)
 const schema={...scope.schema},rows=scope.rows.map(row=>({...row}))
 for(const field of library.fields){for(const row of rows){const value=evaluateCalculatedField(field.expression,row,schema,parameters);if(value.type!=='null'&&value.type!==field.dataType)fail('calculated_field_type_changed',422);row[field.id]=value.type==='null'?null:value.type==='number'?value:value.value}schema[field.id]=field.dataType!}
 return formattedAnswer(evaluateCalculations({authorizedRows:rows,schema,filters:input.filters??[],groupBy,parameters,measures:library.measures,calculationGroups:library.groups.filter(g=>active.includes(g.id))}))
}
