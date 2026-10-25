import {exactKeys} from '../models/validation/transport'
import {fail} from '../query/types'
export type ResourceKind='model'|'metric'|'chart'|'dashboard'|'report'|'policy'|'schedule'
export type ResourceRef={key:string;kind:ResourceKind;id:string;branchId?:string;revisionId?:string;revision?:number;version?:number}
export type EstateDocument={version:1;id:string;name:string;resources:ResourceRef[]}
const ident=(v:unknown):v is string=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(v)
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v)
export function estateDocument(value:unknown):EstateDocument{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('environment_document_required',400)
 const v=value as Record<string,unknown>;exactKeys(v,['version','id','name','resources'])
 if(v.version!==1||!ident(v.id)||typeof v.name!=='string'||!v.name.trim()||v.name.length>160||!Array.isArray(v.resources)||!v.resources.length||v.resources.length>24)fail('bounded_environment_resources_required',400)
 const resources=v.resources.map((value:unknown):ResourceRef=>{
  if(!value||typeof value!=='object'||Array.isArray(value))fail('environment_resource_required',400)
  const r=value as Record<string,unknown>
  if(!ident(r.key)||!['model','metric','chart','dashboard','report','policy','schedule'].includes(String(r.kind)))fail('environment_resource_required',400)
  const kind=r.kind as ResourceKind,allowed=['key','kind','id',...(kind==='model'?['branchId','revisionId']:kind==='metric'||kind==='policy'?['revision']:kind==='schedule'?['version']:[])]
  exactKeys(r,allowed)
  if(['model','chart','dashboard','report'].includes(kind)?!uuid(r.id):!ident(r.id))fail('environment_resource_id_required',400)
  if(kind==='model'&&(!uuid(r.branchId)||!uuid(r.revisionId)))fail('exact_model_branch_revision_required',400)
  if(['metric','policy'].includes(kind)&&(!Number.isSafeInteger(r.revision)||Number(r.revision)<1)||kind==='schedule'&&(!Number.isSafeInteger(r.version)||Number(r.version)<1))fail('exact_resource_revision_required',400)
  return {...r} as ResourceRef
 })
 if(new Set(resources.map(r=>r.key)).size!==resources.length||new Set(resources.map(r=>r.kind+':'+r.id)).size!==resources.length)fail('duplicate_environment_resource',400)
 return {version:1,id:v.id,name:v.name.trim(),resources}
}
export const positiveVersion=(value:unknown)=>{if(!Number.isSafeInteger(value)||Number(value)<1)fail('environment_version_required',400);return Number(value)}
