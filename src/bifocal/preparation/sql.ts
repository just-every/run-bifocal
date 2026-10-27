import { fail } from '../query/types'
import type { Preparation } from './execute'

const quote=(value:unknown)=>'"'+String(value).replaceAll('"','""')+'"'
const literal=(value:unknown)=>"'"+String(value).replaceAll("'","''")+"'"
/** A closed SQL dialect for the native preparation operations. It never sends
 * user SQL to D1, invokes a provider, resolves a URL or evaluates source code. */
export function preparationSQL(document:Preparation):string {
 return document.steps.map(s=>{
  if(s.op==='dedupe')return 'SELECT DISTINCT * FROM INPUT'
  if(s.op==='cast')return `SELECT * REPLACE (CAST(${quote(s.column)} AS ${String(s.type).toUpperCase()}) AS ${quote(s.column)}) FROM INPUT`
  if(s.op==='calculate')return `SELECT *, (${quote(s.left)} ${{add:'+',subtract:'-',multiply:'*'}[String(s.operator)]} ${quote(s.right)}) AS ${quote(s.name)} FROM INPUT`
  if(s.op==='union')return `SELECT * FROM INPUT UNION ALL SELECT * FROM ${quote(s.dataset)}`
  if(s.op==='join'||s.op==='lookup')return `SELECT * FROM INPUT ${s.kind==='left'?'LEFT':'INNER'} JOIN ${quote(s.dataset)} AS ${quote(s.prefix)} ON INPUT.${quote(s.left)} = ${quote(s.prefix)}.${quote(s.right)}`
  if(s.op==='unpivot')return `SELECT * FROM INPUT UNPIVOT INCLUDE NULLS (${quote(s.value)} FOR ${quote(s.name)} IN (${(s.columns as string[]).map(quote).join(', ')}))`
  if(s.op==='pivot')return `SELECT ${(s.groupBy as string[]).map(quote).join(', ')}, ${(s.values as string[]).map(quote).join(', ')} FROM INPUT PIVOT (SINGLE(${quote(s.value)}) FOR ${quote(s.column)} IN (${(s.values as string[]).map(literal).join(', ')}))`
  fail('unsupported_preparation_step',400)
 }).join(';\n')+(document.steps.length?';':'')
}
export function preparationFromSQL(dataset:unknown,sql:unknown):Preparation {
 if(typeof dataset!=='string'||typeof sql!=='string'||sql.length>48000)fail('bounded_preparation_sql_required',400)
 // Tokenize quoted identifiers and literals before splitting statements, so
 // punctuation inside a quoted source column is always inert data.
 const tokens:string[][]=[[]],pattern=/\s+|"(?:[^"]|"")*"|'(?:[^']|'')*'|[A-Za-z_][A-Za-z_0-9]*|[(),.*+=;\-]/gy
 let offset=0
 while(offset<sql.length){pattern.lastIndex=offset;const m=pattern.exec(sql);if(!m)fail('unsupported_preparation_sql',400);offset=pattern.lastIndex;if(/^\s/.test(m[0]))continue;if(m[0]===';'){if(!tokens.at(-1)!.length)fail('unsupported_preparation_sql',400);tokens.push([])}else tokens.at(-1)!.push(m[0])}
 if(!tokens.at(-1)!.length)tokens.pop()
 if(tokens.length>32)fail('bounded_preparation_document_required',400)
 const steps:Preparation['steps']=[]
 for(const statement of tokens){
  let i=0
  const take=(wanted:string)=>{if(statement[i++]?.toUpperCase()!==wanted)fail('unsupported_preparation_sql',400)}
  const is=(wanted:string)=>statement[i]?.toUpperCase()===wanted
  const identifier=()=>{const token=statement[i++];if(!token?.startsWith('"'))fail('quoted_preparation_identifier_required',400);return token.slice(1,-1).replaceAll('""','"')}
  const list=(read:()=>string)=>{const out=[read()];while(is(',')){take(',');out.push(read())}return out}
  take('SELECT')
  if(is('DISTINCT')){take('DISTINCT');take('*');take('FROM');take('INPUT');steps.push({op:'dedupe'})}
  else if(is('*')){
   take('*')
   if(is('REPLACE')){take('REPLACE');take('(');take('CAST');take('(');const column=identifier();take('AS');const type=statement[i++]?.toLowerCase();take(')');take('AS');if(identifier()!==column)fail('preparation_cast_rename_refused',400);take(')');take('FROM');take('INPUT');steps.push({op:'cast',column,type})}
   else if(is(',')){take(',');take('(');const left=identifier(),operator={'+':'add','-':'subtract','*':'multiply'}[statement[i++]];const right=identifier();take(')');take('AS');const name=identifier();take('FROM');take('INPUT');steps.push({op:'calculate',left,right,operator,name})}
   else {
    take('FROM');take('INPUT')
    if(is('UNION')){take('UNION');take('ALL');take('SELECT');take('*');take('FROM');steps.push({op:'union',dataset:identifier()})}
    else if(is('LEFT')||is('INNER')){const kind=statement[i++].toLowerCase();take('JOIN');const target=identifier();take('AS');const prefix=identifier();take('ON');take('INPUT');take('.');const left=identifier();take('=');if(identifier()!==prefix)fail('preparation_join_alias_mismatch',400);take('.');const right=identifier();steps.push({op:'join',dataset:target,kind,prefix,left,right})}
    else if(is('UNPIVOT')){take('UNPIVOT');take('INCLUDE');take('NULLS');take('(');const value=identifier();take('FOR');const name=identifier();take('IN');take('(');const columns=list(identifier);take(')');take(')');steps.push({op:'unpivot',columns,name,value})}
    else fail('unsupported_preparation_sql',400)
   }
  }else {
   const projection=list(identifier);take('FROM');take('INPUT');take('PIVOT');take('(');take('SINGLE');take('(');const value=identifier();take(')');take('FOR');const column=identifier();take('IN');take('(')
   const values=list(()=>{const token=statement[i++];if(!token?.startsWith("'"))fail('preparation_pivot_literal_required',400);return token.slice(1,-1).replaceAll("''","'")});take(')');take(')')
   if(projection.length<=values.length||projection.slice(-values.length).some((v,index)=>v!==values[index]))fail('preparation_pivot_projection_required',400)
   steps.push({op:'pivot',groupBy:projection.slice(0,-values.length),column,value,values})
  }
  if(i!==statement.length)fail('unsupported_preparation_sql',400)
 }
 return {version:1,dataset,steps}
}
