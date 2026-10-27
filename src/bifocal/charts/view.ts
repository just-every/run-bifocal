import { decimal, exact, plus, rational, rounded, type Rational } from '../currency/decimal'
import { fail, type Answer, type Cell, type Context, type Query, type Value } from '../query/types'
import { compileSpecification, type Plan, type Column } from './declarative'
import { evaluate, expressionFields } from './expression'
import type { Visual } from './protocol'

export type ChartInput={definition:Query;visual:Visual;answer:Answer;context:Context}
export type Selection={field:string;value:Cell}
export type ChartView=Omit<Plan,'transforms'>&{rows:{label:Cell;values:Record<string,Value>}[];totals:Record<string,Value>}
export function chartPlan(chart:Pick<ChartInput,'visual'|'definition'>):Plan {
 if(chart.visual.specification)return compileSpecification(chart.visual.specification,chart.definition).plan
 return {mark:'bar',dimension:chart.visual.dimension,measure:chart.visual.measure,scale:{zero:true,reverse:false},columns:chart.definition.measures.map(m=>({id:m.id,unit:m.unit,scale:m.scale})),transforms:[]}
}
const amount=(value:Value):Rational|null=>value.state!=='value'||value.value===null?null:value.exact?rational(BigInt(value.exact.numerator),BigInt(value.exact.denominator)):decimal(value.value)
export function chartView(chart:ChartInput,selection?:Selection):ChartView {
 const plan=chartPlan(chart),rounding=chart.definition.context.rounding
 const result=(column:Column,value:Rational|null,inputs:Value[]):Value=>{
  const unavailable=inputs.find(value=>value.state==='suppressed')??inputs.find(value=>value.state==='unknown')??inputs.find(value=>value.state==='incomplete')??inputs.find(value=>value.state==='null')
  return {state:value?'value':unavailable?.state??'unknown',value:value?rounded(value,column.scale,rounding):null,exact:value?exact(value):null,unit:column.unit,nulls:inputs.reduce((n,v)=>n+v.nulls,0),excluded:inputs.reduce((n,v)=>n+v.excluded,0),...(!value?{reason:unavailable?.reason??'chart_calculation_unavailable'}:{})}
 }
 let rows=chart.answer.rows.map(row=>({dimensions:Object.fromEntries(chart.definition.groupBy.map((field,index)=>[field,row.dimensions[index]])),values:{...row.values}})),totals={...chart.answer.totals}
 for(const transform of plan.transforms){
  if(transform.kind==='calculate'){
   const {expression,as}=transform,column=plan.columns.find(c=>c.id===as)!,calculate=(values:Record<string,Value>)=>result(column,evaluate(expression,field=>amount(values[field])),expressionFields(expression).map(field=>values[field]))
   rows=rows.map(row=>({...row,values:{...row.values,[as]:calculate(row.values)}}));totals[as]=calculate(totals)
  }else if(transform.kind==='sum'){
   const inputs=rows.map(row=>row.values[transform.field]),column=plan.columns.find(c=>c.id===transform.as)!
   let sum=rational(0n),valid=true;const aggregated:Value[]=[]
   const aggregate=(values:Value[])=>{for(const value of values){aggregated.push(value);const number=amount(value);if(number)sum=plus(sum,number);else valid=false}return result(column,valid?sum:null,aggregated)}
   if(transform.cumulative){const seen:Value[]=[];rows=rows.map(row=>{seen.push(row.values[transform.field]);return {...row,values:{...row.values,[transform.as]:aggregate([row.values[transform.field]])}}});totals[transform.as]=result(column,valid?sum:null,seen)}
   else {const value=aggregate(inputs);rows=rows.map(row=>({...row,values:{...row.values,[transform.as]:value}}));totals[transform.as]=value}
  }else{
   const predicate=transform.predicate
   rows=rows.filter(row=>{
    const numeric=row.values[predicate.field],value=numeric?numeric.value:row.dimensions[predicate.field]
    const equal=(other:Cell)=>{if(numeric&&value!==null&&typeof other==='string'&&/^-?\d+(?:\.\d+)?$/.test(other)){const left=amount(numeric),right=decimal(other);return left!==null&&left.numerator*right.denominator===right.numerator*left.denominator}return value===other}
    if(Object.hasOwn(predicate,'equal'))return equal(predicate.equal!)
    if(Object.hasOwn(predicate,'notEqual'))return !equal(predicate.notEqual!)
    if(predicate.gte!==undefined||predicate.lte!==undefined){const number=numeric?amount(numeric):null;if(!number)return false;const boundary=decimal(predicate.gte??predicate.lte!);const difference=number.numerator*boundary.denominator-boundary.numerator*number.denominator;return predicate.gte!==undefined?difference>=0n:difference<=0n}
    if(predicate.oneOf)return predicate.oneOf.some(equal)
    if(predicate.range){const number=numeric?amount(numeric):null;if(!number)return false;const [low,high]=predicate.range.map(decimal);return number.numerator*low.denominator>=low.numerator*number.denominator&&number.numerator*high.denominator<=high.numerator*number.denominator}
    return false
   })
  }
 }
 if(selection){
  if(!plan.selection||selection.field!==plan.selection.field||!rows.some(row=>row.dimensions[selection.field]===selection.value))fail('chart_selection_not_permitted',400)
  rows=rows.filter(row=>row.dimensions[selection.field]===selection.value)
 }
 // Retained totals remain clearly labeled as the complete query's totals.
 const {transforms:_,...view}=plan
 return {...view,rows:rows.map(row=>({label:row.dimensions[plan.dimension],values:row.values})),totals}
}
