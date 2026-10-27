import { fail } from '../../query/types'

export type Expr = { op:'column'; name:string }|{ op:'literal'; value:string|null; type:'number'|'text' }|{ op:'cast'; type:string; value:Expr }|{ op:'+'|'-'|'*'; left:Expr; right:Expr }
export type Select = { relation:string; projections:({name:string; expression:Expr}|{star:true})[] }
const identifier=/^(?:[A-Za-z_][A-Za-z0-9_]*|"(?:[^"]|"")+")$/
const unquote=(v:string)=>v.startsWith('"')?v.slice(1,-1).replaceAll('""','"'):v

/** A closed SELECT grammar. This parser never compiles templates or passes SQL
 * to a database. The sole template admitted is the literal FROM relation. */
export function dbtSelect(sql:unknown):Select {
 if(typeof sql!=='string'||sql.length>48000)fail('bounded_dbt_select_required')
 const tokens:string[]=[],pattern=/\s+|\{\{\s*(?:source|ref)\(\s*(['"])[A-Za-z_][A-Za-z0-9_]*\1(?:\s*,\s*(['"])[A-Za-z_][A-Za-z0-9_]*\2)?\s*\)\s*\}\}|"(?:[^"]|"")*"|'(?:[^']|'')*'|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|[(),.*+;\-]/gy
 let offset=0
 while(offset<sql.length){pattern.lastIndex=offset;const match=pattern.exec(sql);if(!match)fail('unsupported_dbt_sql');offset=pattern.lastIndex;if(!/^\s/.test(match[0]))tokens.push(match[0]);if(tokens.length>8000)fail('bounded_dbt_select_required')}
 let i=0,atoms=0,alias:string|undefined
 const is=(v:string)=>tokens[i]?.toUpperCase()===v
 const take=(v:string)=>{if(!is(v))fail('unsupported_dbt_sql');i++}
 const id=()=>{const token=tokens[i++];if(!token||!identifier.test(token))fail('dbt_identifier_required');const name=unquote(token);if(name.length>128)fail('dbt_identifier_required');return name}
 // Resolve FROM before expressions so qualified columns can be checked.
 const from=tokens.findIndex(t=>t.toUpperCase()==='FROM')
 if(from<0)fail('dbt_literal_relation_required')
 const relation=tokens[from+1],match=/^\{\{\s*(source|ref)\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\2(?:\s*,\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\4)?\s*\)\s*\}\}$/.exec(relation??'')
 if(!match||match[1]==='source'&&!match[5]||match[1]==='ref'&&match[5])fail('dbt_literal_relation_required')
 let end=from+2
 if(tokens[end]?.toUpperCase()==='AS'){end++;const token=tokens[end++];if(!token||!identifier.test(token))fail('dbt_identifier_required');alias=unquote(token)}
 if(tokens[end]===';')end++
 if(end!==tokens.length)fail('unsupported_dbt_sql')
 const atom=(depth:number):Expr=>{
  if(depth>32||++atoms>128)fail('bounded_dbt_expression_required')
  if(is('(')){take('(');const value=expression(depth+1);take(')');return value}
  if(is('CAST')){take('CAST');take('(');const value=expression(depth+1);take('AS');const type=id().toLowerCase();if(!['text','varchar','string','number','numeric','decimal','integer','int','money','date','boolean'].includes(type))fail('unsupported_dbt_cast');take(')');return {op:'cast',type,value}}
  if(is('NULL')){take('NULL');return {op:'literal',value:null,type:'text'}}
  if(is('-')){take('-');const value=tokens[i++];if(!value||!/^\d+(?:\.\d+)?$/.test(value))fail('unsupported_dbt_expression');return {op:'literal',value:'-'+value,type:'number'}}
  const token=tokens[i]
  if(token?.startsWith("'")){i++;return {op:'literal',value:token.slice(1,-1).replaceAll("''","'"),type:'text'}}
  if(token&&/^\d+(?:\.\d+)?$/.test(token)){i++;return {op:'literal',value:token,type:'number'}}
  let name=id()
  if(is('.')){take('.');if(name!==alias)fail('dbt_relation_alias_required');name=id()}
  return {op:'column',name}
 }
 const product=(depth:number):Expr=>{let left=atom(depth);while(is('*')){take('*');left={op:'*',left,right:atom(depth)}}return left}
 const expression=(depth:number):Expr=>{let left=product(depth);while(is('+')||is('-')){const op=tokens[i++] as '+'|'-';left={op,left,right:product(depth)}}return left}
 take('SELECT')
 const projections:Select['projections']=[]
 do{
  if(is(','))take(',')
  if(is('*')){take('*');projections.push({star:true})}
  else {const value=expression(0);let name:string;if(is('AS')){take('AS');name=id()}else if(value.op==='column')name=value.name;else fail('dbt_expression_alias_required');projections.push({name,expression:value})}
  if(projections.length>64)fail('dbt_result_limit')
 }while(is(','))
 if(i!==from)fail('unsupported_dbt_sql')
 return {relation:match[1]==='source'?`source.${match[3]}.${match[5]}`:`model.${match[3]}`,projections}
}
