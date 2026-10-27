import { shapePreparation } from './shape'
import { canonicalJson } from '../../modules/import-kit/src/provenance/identity.ts'
import { plus, times } from '../currency/decimal'
import { preparationDecimal as decimal, exactDecimal } from './decimal'
import { date } from '../calendars/date'
import { fail, QueryError, type Source, type Cell } from '../query/types'
import type { Column } from '../imports/files/csv'

type Ref = { dataset:string; revision:string; column:string }
export type Frame = { columns:Column[]; rows:Cell[][]; lineage:Record<string,Ref[]> }
export type Preparation = { version:1; dataset:string; steps:Record<string,unknown>[]; imported?:{project:string;revision:string;flow:string} }
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const keys=(v:Record<string,unknown>,allowed:string[])=>{if(Object.keys(v).some(k=>!allowed.includes(k)))fail('unsupported_preparation_input',400)}
const name=(v:unknown):string=>{if(typeof v!=='string'||!v||v.length>128||/[\u0000-\u001f]/.test(v))fail('preparation_name_required',400);return v}
const names=(v:unknown):string[]=>{if(!Array.isArray(v)||!v.length||v.length>64)fail('preparation_columns_required',400);const result=v.map(name);if(new Set(result).size!==result.length)fail('duplicate_preparation_column',400);return result}
export function preparationInput(v:unknown):Preparation {
 if(!object(v))fail('preparation_document_required',400)
 keys(v,['version','dataset','steps','imported'])
 if(v.imported!==undefined){const ref=v.imported;if(!object(ref)||Object.keys(ref).some(k=>!['project','revision','flow'].includes(k))||!['project','revision','flow'].every(k=>typeof ref[k]==='string'&&String(ref[k]).length>0&&String(ref[k]).length<=512))fail('preparation_import_reference_required',400)}
 if(v.version!==1||typeof v.dataset!=='string'||!Array.isArray(v.steps)||v.steps.length>32||!v.steps.every(object))fail('bounded_preparation_document_required',400)
 const document=v as Preparation
 for(const id of preparationDatasets(document))if(!/^[a-z][a-z0-9-]{0,63}$/.test(id))fail('preparation_dataset_required',400)
 return document
}
export function preparationDatasets(v:Preparation):string[]{return [...new Set([v.dataset,...v.steps.filter(s=>['join','lookup','union'].includes(String(s.op))).map(s=>String(s.dataset))])]}
const column=(f:Frame,v:unknown)=>{const n=name(v),i=f.columns.findIndex(c=>c.name===n);if(i<0)fail('preparation_column_not_found');return i}
const bounds=(f:Frame)=>{if(f.columns.length>64||f.rows.length>10000||new TextEncoder().encode(canonicalJson(f)).length>1500000)fail('preparation_result_limit',413);return f}
const refs=(...groups:Ref[][])=>[...new Map(groups.flat().map(r=>[canonicalJson(r),r])).values()]
const typedKey=(columns:Column[],row:Cell[])=>canonicalJson(row.map((v,i)=>v!==null&&['number','money'].includes(columns[i].type)?exactDecimal(decimal(v)):v))
function convert(value:Cell,type:Column['type']):Cell {
 if(value===null)return null
 const text=String(value)
 if(type==='text')return text
 if(type==='number'||type==='money'){const d=decimal(text);if(type==='money'&&d.denominator!==1n&&100n%d.denominator!==0n)fail('preparation_money_precision');return exactDecimal(d)}
 if(type==='date')return date(text)
 if(text==='true'||text==='false')return text==='true'
 fail('preparation_type_conversion_failed')
}
export function executePreparation(document:Preparation,sources:Source[]) {
 const source=(id:string):Frame=>{const s=sources.find(s=>s.id===id);if(!s)fail('preparation_source_unavailable',404);return bounds({columns:structuredClone(s.table.columns),rows:structuredClone(s.table.rows) as Cell[][],lineage:Object.fromEntries(s.table.columns.map(c=>[c.name,[{dataset:s.id,revision:s.revision,column:c.name}]]))})}
 let frame=source(document.dataset)
 const diagnostics:{step:number;operation:string;inputRows:number;outputRows:number}[]=[]
 for(const [index,s] of document.steps.entries()){
  const before=frame.rows.length,op=String(s.op)
  try {
   if(shapePreparation(frame,s)){
    // Shape operations have already preserved rows and lineage.
   }else if(op==='dedupe'){
    keys(s,['op']);const seen=new Set<string>();frame.rows=frame.rows.filter(row=>{const k=typedKey(frame.columns,row);if(seen.has(k))return false;seen.add(k);return true})
   }else if(op==='cast'){
    keys(s,['op','column','type']);const i=column(frame,s.column)
    if(!['text','number','money','date','boolean'].includes(String(s.type)))fail('preparation_type_required',400)
    frame.rows=frame.rows.map(row=>row.map((v,j)=>j===i?convert(v,s.type as Column['type']):v));frame.columns[i].type=s.type as Column['type']
   }else if(op==='calculate'){
    keys(s,['op','name','operator','left','right']);const output=name(s.name),left=column(frame,s.left),right=column(frame,s.right)
    if(frame.columns.some(c=>c.name===output)||!['add','subtract','multiply'].includes(String(s.operator))||[left,right].some(i=>frame.columns[i].type!=='number'))fail('preparation_numeric_calculation_required')
    frame.rows=frame.rows.map(row=>{const a=row[left],b=row[right];return [...row,a===null||b===null?null:exactDecimal(s.operator==='multiply'?times(decimal(a),decimal(b)):plus(decimal(a),s.operator==='subtract'?times(decimal(b),{numerator:-1n,denominator:1n}):decimal(b)))]})
    frame.columns.push({name:output,type:'number'});frame.lineage[output]=refs(frame.lineage[String(s.left)],frame.lineage[String(s.right)])
   }else if(op==='union'){
    keys(s,['op','dataset']);const other=source(String(s.dataset));if(canonicalJson(frame.columns)!==canonicalJson(other.columns))fail('preparation_union_schema_mismatch')
    if(frame.rows.length+other.rows.length>10000)fail('preparation_result_limit',413)
    frame.rows.push(...other.rows);for(const c of frame.columns)frame.lineage[c.name]=refs(frame.lineage[c.name],other.lineage[c.name])
   }else if(op==='join'||op==='lookup'){
    keys(s,['op','dataset','left','right','prefix','kind']);const other=source(String(s.dataset)),left=column(frame,s.left),right=column(other,s.right),prefix=name(s.prefix)
    if(frame.columns[left].type!==other.columns[right].type||!['inner','left'].includes(String(s.kind)))fail('preparation_join_type_required')
    const additions=other.columns.map(c=>({name:prefix+c.name,type:c.type}));if(additions.some(c=>frame.columns.some(existing=>existing.name===c.name))||additions.some(c=>c.name.length>128))fail('preparation_join_name_conflict')
    const lookup=new Map<string,Cell[]>()
    for(const row of other.rows){if(row[right]===null)continue;const k=typedKey([other.columns[right]],[row[right]]);if(lookup.has(k))fail('preparation_join_fanout_refused');lookup.set(k,row)}
    frame.rows=frame.rows.flatMap(row=>{const match=row[left]===null?undefined:lookup.get(typedKey([frame.columns[left]],[row[left]]));return match?[[...row,...match]]:s.kind==='left'?[[...row,...other.columns.map(()=>null)]]:[]})
    for(const c of other.columns)frame.lineage[prefix+c.name]=refs(other.lineage[c.name],frame.lineage[String(s.left)],other.lineage[String(s.right)])
    frame.columns.push(...additions)
   }else if(op==='unpivot'){
    keys(s,['op','columns','name','value','omitNulls']);if(s.omitNulls!==undefined&&typeof s.omitNulls!=='boolean')fail('preparation_unpivot_null_policy_required',400);const selected=names(s.columns),indices=selected.map(c=>column(frame,c)),label=name(s.name),value=name(s.value),keep=frame.columns.map((_,i)=>i).filter(i=>!indices.includes(i))
    if(new Set(indices.map(i=>frame.columns[i].type)).size!==1||label===value||keep.some(i=>[label,value].includes(frame.columns[i].name)))fail('preparation_unpivot_schema_mismatch')
    if(frame.rows.length*indices.length>10000)fail('preparation_result_limit',413)
    frame.rows=frame.rows.flatMap(row=>indices.filter(i=>!s.omitNulls||row[i]!==null).map(i=>[...keep.map(j=>row[j]),frame.columns[i].name,row[i]]))
    const lineage=refs(...selected.map(c=>frame.lineage[c]));frame.columns=[...keep.map(i=>frame.columns[i]),{name:label,type:'text'},{name:value,type:frame.columns[indices[0]].type}];frame.lineage=Object.fromEntries(frame.columns.map(c=>[c.name,c.name===label||c.name===value?lineage:frame.lineage[c.name]]))
   }else if(op==='pivot'){
    keys(s,['op','groupBy','column','value','values']);const group=names(s.groupBy),indices=group.map(c=>column(frame,c)),label=column(frame,s.column),value=column(frame,s.value),values=names(s.values)
    if(group.includes(String(s.column))||group.includes(String(s.value))||label===value||frame.columns[label].type!=='text'||values.some(v=>group.includes(v)))fail('preparation_pivot_schema_mismatch')
    const grouped=new Map<string,Cell[]>(),occupied=new Set<string>()
    for(const row of frame.rows){const at=values.indexOf(String(row[label]));if(row[label]===null||at<0)fail('preparation_pivot_domain_mismatch');const dimensions=indices.map(i=>row[i]),k=typedKey(indices.map(i=>frame.columns[i]),dimensions),cell=k+':'+at;if(occupied.has(cell))fail('preparation_pivot_duplicate_cell');occupied.add(cell);let target=grouped.get(k);if(!target){target=[...dimensions,...values.map(()=>null)];grouped.set(k,target)}target[indices.length+at]=row[value]}
    frame.rows=[...grouped.values()];const lineage=refs(frame.lineage[String(s.column)],frame.lineage[String(s.value)]);frame.columns=[...indices.map(i=>frame.columns[i]),...values.map(name=>({name,type:frame.columns[value].type}))];frame.lineage=Object.fromEntries(frame.columns.map(c=>[c.name,values.includes(c.name)?lineage:frame.lineage[c.name]]))
   }else fail('unsupported_preparation_step',400)
   bounds(frame);diagnostics.push({step:index+1,operation:op,inputRows:before,outputRows:frame.rows.length})
  }catch(error){return {compatible:false,error:{step:index+1,operation:op,code:error instanceof QueryError?error.code:'preparation_type_conversion_failed'},diagnostics,output:null}}
 }
 return {compatible:true,error:null,diagnostics,output:frame}
}
