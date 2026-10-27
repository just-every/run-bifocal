import { exactKeys } from '../models/validation/transport'
import { fail, type Filter } from '../query/types'
export type TenantDocument={schema:1;sdk:1;name:string;color:string;modelId:string;revision:string;viewId:string;rows:Filter[];dimensions:string[];budget:{queries:number;exports:number}}
const id=(value:unknown)=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value)
const column=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(value)
export function documentInput(value:unknown):TenantDocument {
 if(!value||typeof value!=='object'||Array.isArray(value))fail('tenant_document_required',400)
 const v=value as Record<string,unknown>;exactKeys(v,['schema','sdk','name','color','modelId','revision','viewId','rows','dimensions','budget'])
 if(v.schema!==1||v.sdk!==1)fail('unsupported_portal_schema_or_sdk',400)
 if(typeof v.name!=='string'||!v.name.trim()||v.name.length>120||/[\u0000-\u001f]/.test(v.name)||typeof v.color!=='string'||!/^#[0-9a-f]{6}$/i.test(v.color))fail('tenant_branding_required',400)
 if(!id(v.modelId)||!id(v.revision)||typeof v.viewId!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(v.viewId))fail('tenant_model_required',400)
 if(!Array.isArray(v.rows)||!v.rows.length||v.rows.length>8||!Array.isArray(v.dimensions)||v.dimensions.length>16||!v.dimensions.every(column)||new Set(v.dimensions).size!==v.dimensions.length)fail('tenant_scope_required',400)
 const rows=v.rows.map((raw):Filter=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('tenant_row_rule_required',400)
  const r=raw as Record<string,unknown>;exactKeys(r,['column','op','value'])
  if(!column(r.column)||r.op!=='eq'||typeof r.value!=='string'||!r.value||r.value.length>200)fail('tenant_row_rule_required',400)
  return {column:r.column,op:'eq',value:r.value}
 })
 const b=v.budget as Record<string,unknown>
 if(!b||typeof b!=='object'||Array.isArray(b))fail('tenant_budget_required',400)
 exactKeys(b,['queries','exports'])
 if(![b.queries,b.exports].every(n=>Number.isSafeInteger(n)&&Number(n)>0&&Number(n)<=10000))fail('tenant_budget_required',400)
 return {...v,rows} as TenantDocument
}
export function parameters(input:Record<string,unknown>,doc:TenantDocument) {
 exactKeys(input,['groupBy','filters'])
 const groupBy=input.groupBy??[],filters=input.filters??[]
 if(!Array.isArray(groupBy)||groupBy.length>8||!groupBy.every(c=>doc.dimensions.includes(c))||new Set(groupBy).size!==groupBy.length||!Array.isArray(filters)||filters.length>8)fail('tenant_dimension_not_permitted',403)
 const rules=filters.map((raw):Filter=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('tenant_filter_not_permitted',403)
  const f=raw as Record<string,unknown>;exactKeys(f,['column','op','value'])
  if(typeof f.column!=='string'||!doc.dimensions.includes(f.column)||f.op!=='eq'||typeof f.value!=='string'||f.value.length>200)fail('tenant_filter_not_permitted',403)
  return {column:f.column,op:'eq',value:f.value}
 })
 return {groupBy:groupBy as string[],filters:rules}
}
