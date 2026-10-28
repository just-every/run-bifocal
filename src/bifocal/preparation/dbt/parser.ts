import { fail } from '../../query/types'

export type Expr = { op:'column'; name:string; qualifier?:string }|{ op:'literal'; value:string|null; type:'number'|'text' }|{ op:'cast'; type:string; value:Expr }|{ op:'+'|'-'|'*'; left:Expr; right:Expr }
export type Predicate = {op:'and'; left:Predicate; right:Predicate}|{op:'or'; left:Predicate; right:Predicate}|{op:'null'; value:Expr; negate:boolean}|{op:'compare'; operator:string; left:Expr; right:Expr}|{op:'in'; value:Expr; values:Expr[]; negate:boolean}
export type Relation = {relation:string; alias?:string}
export type Select = Relation & { join?:Relation & {kind:'inner'|'left'; left:Expr; right:Expr}; where?:Predicate; projections:({name:string; expression:Expr}|{star:true})[] }
const identifier=/^(?:[A-Za-z_][A-Za-z0-9_]*|"(?:[^"]|"")+")$/
const unquote=(v:string)=>v.startsWith('"')?v.slice(1,-1).replaceAll('""','"'):v

/** A closed SELECT grammar. This parser never compiles templates or passes SQL
 * to a database. Templates admit only literal relation references. */
export function dbtSelect(sql:unknown):Select {
 if(typeof sql!=='string'||sql.length>48000)fail('bounded_dbt_select_required')
 const tokens:string[]=[],pattern=/\s+|\{\{\s*(?:source|ref)\(\s*(['"])[A-Za-z_][A-Za-z0-9_]*\1(?:\s*,\s*(['"])[A-Za-z_][A-Za-z0-9_]*\2)?\s*\)\s*\}\}|"(?:[^"]|"")*"|'(?:[^']|'')*'|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|<=|>=|<>|!=|[=<>(),.*+;\-]/gy
 let offset=0
 while(offset<sql.length){pattern.lastIndex=offset;const match=pattern.exec(sql);if(!match)fail('unsupported_dbt_sql');offset=pattern.lastIndex;if(!/^\s/.test(match[0]))tokens.push(match[0]);if(tokens.length>8000)fail('bounded_dbt_select_required')}
 let i=0,atoms=0
 const aliases=new Set<string>()
 const is=(v:string)=>tokens[i]?.toUpperCase()===v
 const take=(v:string)=>{if(!is(v))fail('unsupported_dbt_sql');i++}
 const id=()=>{const token=tokens[i++];if(!token||!identifier.test(token))fail('dbt_identifier_required');const name=unquote(token);if(name.length>128)fail('dbt_identifier_required');return name}
 const relation=():Relation=>{
  const token=tokens[i++],match=/^\{\{\s*(source|ref)\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\2(?:\s*,\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\4)?\s*\)\s*\}\}$/.exec(token??'')
  if(!match||match[1]==='source'&&!match[5]||match[1]==='ref'&&match[5])fail('dbt_literal_relation_required')
  let alias:string|undefined
  if(is('AS')){take('AS');alias=id();if(aliases.has(alias))fail('dbt_duplicate_relation_alias');aliases.add(alias)}
  return {relation:match[1]==='source'?`source.${match[3]}.${match[5]}`:`model.${match[3]}`,alias}
 }
 // Resolve relation aliases before parsing projections and predicates.
 const from=tokens.findIndex(t=>t.toUpperCase()==='FROM')
 if(from<0)fail('dbt_literal_relation_required')
 i=from+1
 const source=relation()
 let join:Select['join']
 if(is('JOIN')||is('INNER')||is('LEFT')){
  const kind=is('LEFT')?'left':'inner'
  if(is('LEFT')||is('INNER'))i++
  take('JOIN');const target=relation()
  if(!source.alias||!target.alias)fail('dbt_join_aliases_required')
  take('ON')
  const column=():Expr=>{const qualifier=id();take('.');const name=id();return {op:'column',name,qualifier}}
  const left=column();take('=');const right=column()
  if(left.op!=='column'||right.op!=='column'||left.qualifier===right.qualifier||![source.alias,target.alias].includes(left.qualifier!)||![source.alias,target.alias].includes(right.qualifier!))fail('dbt_join_columns_required')
  join={...target,kind,left,right}
 }
 const afterRelations=i
 i=0
 const atom=(depth:number):Expr=>{
  if(depth>32||++atoms>128)fail('bounded_dbt_expression_required')
  if(is('(')){take('(');const value=expression(depth+1);take(')');return value}
  if(is('CAST')){take('CAST');take('(');const value=expression(depth+1);take('AS');const type=id().toLowerCase();if(!['text','varchar','string','number','numeric','decimal','integer','int','money','date','boolean'].includes(type))fail('unsupported_dbt_cast');take(')');return {op:'cast',type,value}}
  if(is('TRUE')||is('FALSE')){const value=is('TRUE')?'true':'false';i++;return {op:'cast',type:'boolean',value:{op:'literal',value,type:'text'}}}
  if(is('NULL')){take('NULL');return {op:'literal',value:null,type:'text'}}
  if(is('-')){take('-');const value=tokens[i++];if(!value||!/^\d+(?:\.\d+)?$/.test(value))fail('unsupported_dbt_expression');return {op:'literal',value:'-'+value,type:'number'}}
  const token=tokens[i]
  if(token?.startsWith("'")){i++;return {op:'literal',value:token.slice(1,-1).replaceAll("''","'"),type:'text'}}
  if(token&&/^\d+(?:\.\d+)?$/.test(token)){i++;return {op:'literal',value:token,type:'number'}}
  let name=id(),qualifier:string|undefined
  if(is('.')){take('.');if(!aliases.has(name))fail('dbt_relation_alias_required');qualifier=name;name=id()}
  return {op:'column',name,qualifier}
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
 i=afterRelations
 const condition=(depth:number):Predicate=>{
  if(depth>16)fail('bounded_dbt_predicate_required')
  if(is('(')){take('(');const value=disjunction(depth+1);take(')');return value}
  const left=expression(0)
  if(is('IS')){take('IS');const negate=is('NOT');if(negate)take('NOT');take('NULL');return {op:'null',value:left,negate}}
  const negate=is('NOT');if(negate)take('NOT')
  if(is('IN')){take('IN');take('(');const values=[expression(0)];while(is(',')){take(',');values.push(expression(0))}take(')');return {op:'in',value:left,values,negate}}
  if(negate)fail('unsupported_dbt_predicate')
  const operator=tokens[i++]
  if(!['=','!=','<>','<','<=','>','>='].includes(operator))fail('unsupported_dbt_predicate')
  return {op:'compare',operator,left,right:expression(0)}
 }
 const conjunction=(depth:number):Predicate=>{let left=condition(depth);while(is('AND')){take('AND');left={op:'and',left,right:condition(depth)}}return left}
 const disjunction=(depth:number):Predicate=>{let left=conjunction(depth);while(is('OR')){take('OR');left={op:'or',left,right:conjunction(depth)}}return left}
 let where:Predicate|undefined
 if(is('WHERE')){take('WHERE');where=disjunction(0)}
 if(is(';'))take(';')
 if(i!==tokens.length)fail('unsupported_dbt_sql')
 return {...source,join,where,projections}
}
