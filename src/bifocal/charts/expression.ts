import { decimal, divide, plus, rational, times, type Rational } from '../currency/decimal'
import { fail } from '../query/types'

export type Expression = {kind:'field';field:string}|{kind:'constant';value:string}|{kind:'binary';op:string;left:Expression;right:Expression}
// A small arithmetic grammar, interpreted with exact rationals. No JS evaluation.
export function arithmetic(source:unknown,fields:Set<string>):Expression {
 if(typeof source!=='string'||!source.length||source.length>512)fail('chart_arithmetic_required',400)
 const tokens=source.match(/datum\.[A-Za-z_][A-Za-z0-9_]*|datum\["[A-Za-z_][A-Za-z0-9_.]*"\]|(?:0|[1-9]\d*)(?:\.\d+)?|[()+*/-]|\s+|./g)!.filter(token=>!/^\s+$/.test(token))
 if(tokens.length>100)fail('chart_arithmetic_too_complex',400)
 let index=0
 const primary=():Expression=>{
  const token=tokens[index++]
  if(token==='('){const expression=sum();if(tokens[index++]!==')')fail('chart_unsafe_expression',400);return expression}
  if(token==='-')return {kind:'binary',op:'-',left:{kind:'constant',value:'0'},right:primary()}
  if(token&&/^\d+(?:\.\d+)?$/.test(token)){if(token.length>36||(token.split('.')[1]?.length??0)>12)fail('chart_constant_too_large',400);return {kind:'constant',value:token}}
  if(token?.startsWith('datum.')){const field=token.slice(6);if(fields.has(field))return {kind:'field',field}}
  if(token?.startsWith('datum["')){const field=token.slice(7,-2);if(fields.has(field))return {kind:'field',field}}
  return fail('chart_unsafe_expression',400)
 }
 const product=():Expression=>{let left=primary();while(tokens[index]==='*'||tokens[index]==='/'){const op=tokens[index++];left={kind:'binary',op,left,right:primary()}}return left}
 const sum=():Expression=>{let left=product();while(tokens[index]==='+'||tokens[index]==='-'){const op=tokens[index++];left={kind:'binary',op,left,right:product()}}return left}
 const result=sum();if(index!==tokens.length)fail('chart_unsafe_expression',400);return result
}
export function evaluate(expression:Expression,get:(field:string)=>Rational|null):Rational|null {
 if(expression.kind==='field')return get(expression.field)
 if(expression.kind==='constant')return decimal(expression.value)
 const left=evaluate(expression.left,get),right=evaluate(expression.right,get)
 if(!left||!right)return null
 if(expression.op==='+')return plus(left,right)
 if(expression.op==='-')return plus(left,times(right,rational(-1n)))
 if(expression.op==='*')return times(left,right)
 return right.numerator===0n?null:divide(left,right)
}
export function expressionFields(expression:Expression):string[] {
 return expression.kind==='field'?[expression.field]:expression.kind==='constant'?[]:[...expressionFields(expression.left),...expressionFields(expression.right)]
}
