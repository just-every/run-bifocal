import { decimal } from '../../currency/decimal'
import type { Cell, Filter, Source } from '../../query/types'

const identifier = '[A-Za-z_][A-Za-z0-9_$]*'
const columnPattern = new RegExp(`^(${identifier})(?:\\s+(?:as\\s+)?(${identifier}))?$`, 'i')
const reserved = new Set(['select','distinct','all','as','from','where','group','having','order','limit','offset','fetch','top','with','union','intersect','except','into','qualify','window'])
type Predicate = {column:string; op:Filter['op']; value?:Cell; type?:'text'|'number'|'boolean'}

/** A closed data language, never passed to a SQL or template interpreter. */
export function projection(sql:unknown) {
 if(typeof sql!=='string')return null
 const match=/^\s*select\s+([\s\S]+?)\s+from\s+\{\{\s*(ref|source)\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\3(?:\s*,\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\5)?\s*\)\s*\}\}(?:\s+where\s+([\s\S]+?))?\s*;?\s*$/i.exec(sql)
 if(!match||match[2].toLowerCase()==='source'&&!match[6]||match[2].toLowerCase()==='ref'&&match[6])return null
 const columns:{input:string;output:string}[]=[]
 for(const fragment of match[1].split(',')){
  const column=columnPattern.exec(fragment.trim())
  if(!column||reserved.has(column[1].toLowerCase())||column[2]&&reserved.has(column[2].toLowerCase())||columns.some(c=>c.output===(column[2]??column[1])))return null
  columns.push({input:column[1],output:column[2]??column[1]})
 }
 const predicates:Predicate[]=[],tokens:string[]=[]
 if(match[7]){
  const text=match[7],pattern=/\s+|'(?:[^']|'')*'|>=|<=|<>|!=|=|-?(?:0|[1-9]\d*)(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_$]*/gy
  let offset=0
  while(offset<text.length){pattern.lastIndex=offset;const token=pattern.exec(text);if(!token)return null;offset=pattern.lastIndex;if(!/^\s/.test(token[0]))tokens.push(token[0])}
  let i=0
  while(i<tokens.length){
   const column=tokens[i++],op=tokens[i++]?.toLowerCase()
   if(!new RegExp(`^${identifier}$`).test(column)||reserved.has(column.toLowerCase()))return null
   if(op==='is'){
    const not=tokens[i]?.toLowerCase()==='not';if(not)i++
    if(tokens[i++]?.toLowerCase()!=='null')return null
    predicates.push(not?{column,op:'ne',value:null}:{column,op:'is-null'})
   }else{
    if(!['=','<>','!=','>=','<='].includes(op))return null
    const token=tokens[i++];if(!token)return null
    let value:Cell,type:Predicate['type']
    if(token.startsWith("'")){value=token.slice(1,-1).replaceAll("''","'");type='text'}
    else if(/^(true|false)$/i.test(token)){value=token.toLowerCase()==='true';type='boolean'}
    else {try{decimal(token)}catch{return null}value=token;type='number'}
    if(['>=','<='].includes(op)&&type!=='number')return null
    // SQL comparisons with NULL are unknown. Native inequality also includes
    // nulls, so retain an explicit non-null predicate before translating it.
    if(op==='<>'||op==='!=')predicates.push({column,op:'ne',value:null})
    predicates.push({column,op:op==='='?'eq':op==='>='?'gte':op==='<='?'lte':'ne',value,type})
   }
   if(predicates.length>20)return null
   if(i<tokens.length&&(tokens[i++]?.toLowerCase()!=='and'||i===tokens.length))return null
  }
  if(!predicates.length)return null
 }
 return columns.length?{columns,kind:match[2].toLowerCase(),names:match[6]?[match[4],match[6]]:[match[4]],predicates}:null
}

export function bindPredicates(predicates:Predicate[],columns:Map<string,string>,source:Source):Filter[]|null {
 const filters:Filter[]=[]
 for(const predicate of predicates){
  const column=columns.get(predicate.column),physical=source.table.columns.find(c=>c.name===column)
  if(!physical||predicate.type&&(predicate.type==='number'?!['number','money'].includes(physical.type):predicate.type!==physical.type))return null
  filters.push({column:physical.name,op:predicate.op,...predicate.value===undefined?{}:{value:predicate.value}})
 }
 return filters
}

export function filteredRows(source:Source,rows:Source['table']['rows'],filters:Filter[]) {
 return rows.filter(row=>filters.every(filter=>{
  const index=source.table.columns.findIndex(c=>c.name===filter.column),a=row[index],b=filter.value as Cell
  if(filter.op==='is-null')return a===null
  if(a===null||b===null)return filter.op==='eq'?a===b:filter.op==='ne'&&a!==b
  let order:number
  if(['money','number'].includes(source.table.columns[index].type)){const x=decimal(a),y=decimal(b),difference=x.numerator*y.denominator-y.numerator*x.denominator;order=difference<0n?-1:difference>0n?1:0}
  else order=a===b?0:String(a)<String(b)?-1:1
  return filter.op==='eq'?order===0:filter.op==='ne'?order!==0:filter.op==='gte'?order>=0:order<=0
 }))
}
