import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { exactKeys } from '../models/validation/transport'
import { fail, type Filter, type Query } from '../query/types'
export const kinds=['dashboard','report','question','scorecard'] as const
export type PageKind=typeof kinds[number]
export type Frozen={source:{kind:string;id:string;revision:string;digest:string};queries:{label:string;query:Query}[];target?:{title:string;amount:string;from:string;to:string}}
export type AppPage={key:string;title:string;kind:PageKind;ref:string;frozen?:Frozen}
export type Audience={key:string;name:string;landing:string;pages:string[];rows:Filter[];columns:string[]|null}
export type AppDocument={version:1;title:string;pages:AppPage[];audiences:Audience[]}
const object=(value:unknown,code:string):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))fail(code,400);return value as Record<string,unknown>}
export const key=(value:unknown,code='app_key_required'):string=>{if(typeof value!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(value))fail(code,400);return value}
export const appId=(value:unknown):string=>{if(typeof value!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value))fail('app_id_required',400);return value}
const label=(value:unknown,code:string):string=>{if(typeof value!=='string'||!value.trim()||value.trim()!==value||value.length>160||/[\u0000-\u001f]/.test(value))fail(code,400);return value}
const cell=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=200
function filter(value:unknown):Filter {
 const input=object(value,'audience_row_rule_required');exactKeys(input,['column','op','value'])
 if(!cell(input.column)||input.op==='eq'&&!cell(input.value)||input.op==='in'&&(!Array.isArray(input.value)||!input.value.length||input.value.length>20||!input.value.every(cell))||!['eq','in'].includes(String(input.op)))fail('audience_row_rule_required',400)
 return {column:input.column as string,op:input.op as 'eq'|'in',value:input.value as string|string[]}
}
/** The authored draft: content references only; frozen queries are added at publication. */
export function appDocument(value:unknown):AppDocument {
 const input=object(value,'app_document_required');exactKeys(input,['version','title','pages','audiences'])
 if(input.version!==1||!Array.isArray(input.pages)||!input.pages.length||input.pages.length>24||!Array.isArray(input.audiences)||!input.audiences.length||input.audiences.length>8)fail('app_document_required',400)
 const pages=input.pages.map((raw):AppPage=>{
  const page=object(raw,'app_page_required');exactKeys(page,['key','title','kind','ref'])
  const kind=page.kind as PageKind;if(!kinds.includes(kind))fail('app_page_kind_required',400)
  const ref=kind==='scorecard'?key(page.ref,'app_scorecard_goal_required'):appId(page.ref)
  return {key:key(page.key),title:label(page.title,'app_page_title_required'),kind,ref}
 })
 if(new Set(pages.map(p=>p.key)).size!==pages.length)fail('duplicate_app_page_key',400)
 const audiences=input.audiences.map((raw):Audience=>{
  const audience=object(raw,'app_audience_required');exactKeys(audience,['key','name','landing','pages','rows','columns'])
  if(!Array.isArray(audience.pages)||!audience.pages.length||new Set(audience.pages).size!==audience.pages.length||!audience.pages.every(p=>pages.some(page=>page.key===p))||!audience.pages.includes(audience.landing)||!Array.isArray(audience.rows)||audience.rows.length>8)fail('app_audience_navigation_required',400)
  if(audience.columns!==null&&(!Array.isArray(audience.columns)||!audience.columns.length||audience.columns.length>32||!audience.columns.every(cell)))fail('app_audience_columns_invalid',400)
  const rows=audience.rows.map(filter)
  return {key:key(audience.key),name:label(audience.name,'app_audience_name_required'),landing:audience.landing as string,pages:audience.pages as string[],rows,columns:audience.columns as string[]|null}
 })
 if(new Set(audiences.map(a=>a.key)).size!==audiences.length||new Set(audiences.map(a=>a.name)).size!==audiences.length)fail('duplicate_app_audience',400)
 return {version:1,title:label(input.title,'app_title_required'),pages,audiences}
}
export const documentDigest=(document:unknown)=>sha256(canonicalJson(document))
/** Columns an audience would see: grouping and measure columns of one query. */
export function visibleColumns(query:Query):string[] {
 const bare=(ref:string)=>ref.startsWith('base.')?ref.slice(5):ref
 return [...new Set([...query.groupBy,...query.measures.flatMap(m=>[m.column,m.numerator,m.denominator,m.weight,m.stateColumn,m.currencyColumn,m.rateDateColumn]).filter((c):c is string=>!!c)].map(bare))]
}
