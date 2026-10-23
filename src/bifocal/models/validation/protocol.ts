import { queryInput } from '../../query/validate'
import { fail, type Filter, type Query } from '../../query/types'
export type View = {id:string;kind:'chart'|'notebook'|'report'|'subscription'|'portal'|'agent';query:Query;rowRules:Filter[]}
export type Definition = {views:View[];quality:{view:string;measure:string;expected:string}[]}
export function definitionInput(value:unknown):Definition {
 if(!value || typeof value!=='object' || Array.isArray(value))fail('semantic_definition_required',400)
 const input=value as Record<string,unknown>
 if(Object.keys(input).some(k=>!['views','quality'].includes(k)) || !Array.isArray(input.views) || !input.views.length || input.views.length>24 || !Array.isArray(input.quality) || input.quality.length>48)fail('bounded_views_and_quality_required',400)
 const views=input.views.map((value:unknown):View=>{
  if(!value || typeof value!=='object' || Array.isArray(value))fail('invalid_semantic_view',400)
  const v=value as Record<string,unknown>
  if(Object.keys(v).some(k=>!['id','kind','query','rowRules'].includes(k)) || typeof v.id!=='string' || !/^[a-z][a-z0-9-]{0,63}$/.test(v.id) || !['chart','notebook','report','subscription','portal','agent'].includes(String(v.kind)) || !Array.isArray(v.rowRules))fail('invalid_semantic_view',400)
  const query=queryInput(v.query), validated=queryInput({...query,filters:v.rowRules})
  return {id:v.id,kind:v.kind as View['kind'],query,rowRules:validated.filters}
 })
 if(new Set(views.map(v=>v.id)).size!==views.length)fail('duplicate_semantic_view',400)
 const quality=input.quality.map((value:unknown)=>{
  if(!value || typeof value!=='object' || Array.isArray(value))fail('invalid_quality_check',400)
  const q=value as Record<string,unknown>
  if(Object.keys(q).some(k=>!['view','measure','expected'].includes(k)) || typeof q.view!=='string' || typeof q.measure!=='string' || typeof q.expected!=='string' || q.expected.length>100 || !views.some(v=>v.id===q.view && v.query.measures.some(m=>m.id===q.measure)))fail('invalid_quality_check',400)
  return {view:q.view,measure:q.measure,expected:q.expected}
 })
 return {views,quality}
}
/** Row rules are appended server-side; callers cannot remove them with filters. */
export const scopedQuery=(view:View,revision:string):Query=>({...view.query,filters:[...view.query.filters,...view.rowRules],context:{...view.query.context,modelVersion:revision}})
