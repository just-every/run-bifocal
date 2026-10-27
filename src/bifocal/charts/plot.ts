import { decimal, rational, type Rational } from '../currency/decimal'
import type { Value } from '../query/types'
import type { ChartView } from './view'

const compare=(a:Rational,b:Rational)=>a.numerator*b.denominator-b.numerator*a.denominator
const amount=(value:Value)=>value.state==='value'&&value.value!==null?decimal(value.value):null
// Exact rational values become bounded pixel coordinates only at this boundary.
export function chartPlot(view:ChartView):{points:{start:number|null;end:number|null}[];zero:number} {
 const values=view.rows.map(row=>({start:view.end?amount(row.values[view.measure]):rational(0n),end:amount(row.values[view.end??view.measure])}))
 const domainValues=view.scale.domainField?view.rows.map(row=>amount(row.values[view.scale.domainField!])):values.flatMap(point=>view.mark==='point'?[point.end]:[point.start,point.end])
 let low=rational(0n),high=rational(0n)
 if(!view.scale.zero){const first=domainValues.find(value=>value!==null);if(first)low=high=first}
 for(const value of domainValues)if(value){if(compare(value,low)<0n)low=value;if(compare(value,high)>0n)high=value}
 if(view.scale.domain)[low,high]=view.scale.domain.map(decimal)
 const coordinate=(value:Rational)=>{
  const range=high.numerator*low.denominator-low.numerator*high.denominator
  if(!range)return 300
  const n=(value.numerator*low.denominator-low.numerator*value.denominator)*high.denominator*600000n,d=value.denominator*range
  const pixel=Number(n/d)/1000
  return view.scale.reverse?600-pixel:pixel
 }
 return {points:values.map(point=>({start:point.start?coordinate(point.start):null,end:point.end?coordinate(point.end):null})),zero:coordinate(rational(0n))}
}
