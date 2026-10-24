import { rounded, rational, times } from '../../currency/decimal'
import type { CalculationAnswer, CalculationValue } from '../core'
export function formattedAnswer(answer:CalculationAnswer){
 const format=(value:CalculationValue,pattern:string|null)=>{
  if(value.type==='null')return null
  if(value.type!=='number')return value.value
  if(!pattern)return value.denominator==='1'?value.numerator:value.numerator+' ÷ '+value.denominator
  let exact=rational(BigInt(value.numerator),BigInt(value.denominator))
  if(pattern.endsWith('%'))exact=times(exact,rational(100n))
  const scale=pattern.match(/\.([0]+)/)?.[1].length??0,decimal=rounded(exact,scale,'half-away-from-zero'),[whole,fraction]=decimal.split('.')
  return (pattern.startsWith('$')?'$':'')+(pattern.includes(',')?whole.replace(/\B(?=(\d{3})+(?!\d))/g,','):whole)+(fraction?'.'+fraction:'')+(pattern.endsWith('%')?'%':'')
 }
 const values=(v:Record<string,CalculationValue>)=>Object.fromEntries(Object.entries(v).map(([id,value])=>[id,format(value,answer.formats[id])]))
 return {...answer,formatted:{rows:answer.rows.map(row=>({dimensions:row.dimensions,values:values(row.values)})),totals:values(answer.totals)},semantics:{...answer.semantics,formats:'Explicit supported source numeric patterns; half away from zero for display only; exact values remain unchanged'}}
}
