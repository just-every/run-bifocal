import { queryInput, id } from '../query/validate'
import { fail, type Filter, type Query } from '../query/types'

/** Portable intent only. A definition cannot carry or activate authority. */
export type PolicyDocument = {version:1;id:string;name:string;modelId:string;viewId:string;filters:Filter[];dimensions:string[];underlying:boolean;summaryExport:boolean;underlyingExport:boolean;maxAgeSeconds:number}
const fields=['version','id','name','modelId','viewId','filters','dimensions','underlying','summaryExport','underlyingExport','maxAgeSeconds']
export function policyInput(value:unknown):PolicyDocument {
 if(!value||typeof value!=='object'||Array.isArray(value))fail('policy_document_required',400)
 const v=value as Record<string,unknown>
 if(Object.keys(v).length!==fields.length||Object.keys(v).some(k=>!fields.includes(k)))fail('unsupported_policy_document',400)
 if(v.version!==1||!id(v.id)||typeof v.name!=='string'||!v.name.trim()||v.name!==v.name.trim()||v.name.length>160||/[\u0000-\u001f]/.test(v.name)||typeof v.modelId!=='string'||!/^[a-f0-9-]{36}$/.test(v.modelId)||!id(v.viewId))fail('invalid_policy_document',400)
 if(!['underlying','summaryExport','underlyingExport'].every(k=>typeof v[k]==='boolean')||v.underlyingExport&&!v.underlying)fail('explicit_policy_permissions_required',400)
 if(!Number.isSafeInteger(v.maxAgeSeconds)||Number(v.maxAgeSeconds)<1||Number(v.maxAgeSeconds)>604800)fail('policy_expiry_within_seven_days_required',400)
 if(!Array.isArray(v.filters)||!Array.isArray(v.dimensions)||v.dimensions.length>4||v.dimensions.some(d=>typeof d!=='string')||new Set(v.dimensions).size!==v.dimensions.length)fail('invalid_policy_scope',400)
 return {version:1,id:v.id,name:v.name,modelId:v.modelId,viewId:v.viewId,filters:v.filters as Filter[],dimensions:v.dimensions as string[],underlying:v.underlying as boolean,summaryExport:v.summaryExport as boolean,underlyingExport:v.underlyingExport as boolean,maxAgeSeconds:Number(v.maxAgeSeconds)}
}
export function validatePolicyScope(document:PolicyDocument,query:Query):PolicyDocument {
 if(!query.semantic)fail('governed_view_required',404)
 const candidate=queryInput({...query,filters:document.filters}),allowed=new Set(query.semantic.dimensions.map(d=>d.column))
 if(candidate.filters.some(f=>!allowed.has(f.column))||document.dimensions.some(d=>!allowed.has(d)))fail('dimension_not_permitted',403)
 return {...document,filters:candidate.filters}
}
export function previousRevision(value:unknown):number|null {
 if(value===null)return null
 if(!Number.isSafeInteger(value)||Number(value)<1)fail('previous_policy_revision_required',400)
 return Number(value)
}
