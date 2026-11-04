import { JSON_SCHEMA, load } from 'js-yaml'
import { canonicalJson, sha256 } from '../../../../modules/import-kit/src/provenance/identity.ts'
import { exactKeys } from '../../../models/validation/transport'
import { fail } from '../../../query/types'
import { object, text, type InventoryItem } from '../compile'

export const lookerReferences = [
 {url:'https://docs.cloud.google.com/looker/docs/reference/param-lookml-dashboard',sha256:'fd061b3ae135dd22b1c91a1c0292b0bee0d5fc93aa6ef00788d9449f65f46c31'},
 {url:'https://docs.cloud.google.com/looker/docs/reference/param-lookml-dashboard-table-chart',sha256:'7147a16c45134b5253e6e01492d054e2740b24e97c112ad3bf6ff68a39f60ba7'},
]
export type LookerIssue={location:string;code:string;expression:string;resolution:string}
export type LookerBinding={modelId:string;revision:string;viewId:string;dataset:string;sourceRevision:string;fields:Record<string,string>}
export type LookerDashboard={file:string;fileDigest:string;source:Record<string,unknown>;bindings:Record<string,LookerBinding>;document:unknown|null}
export const stableId=(kind:string,value:string)=>kind+'-'+sha256(value).slice(0,32)
export function lookerItems(value:unknown):InventoryItem[]{
 const v=object(value);exactKeys(v,['version','projectId','source','cutoff','rollbackPlan','files','bindings'])
 const bindings=object(v.bindings)
 if(Object.keys(bindings).length>24)fail('looker_binding_limit',413)
 for(const value of Object.values(bindings)){
  const b=object(value);exactKeys(b,['modelId','revision','viewId','dataset','sourceRevision','fields'])
  for(const key of ['modelId','revision','viewId','dataset','sourceRevision'])if(!text(b[key],128).trim())fail('looker_exact_binding_required',400)
  const fields=object(b.fields);if(Object.keys(fields).length>48||Object.entries(fields).some(([key,value])=>!/^\w+\.\w+$/.test(key)||typeof value!=='string'||!value||value.length>200))fail('looker_physical_mapping_required',400)
 }
 if(!Array.isArray(v.files)||!v.files.length||v.files.length>8)fail('looker_dashboard_files_required',400)
 const files=v.files.map(value=>{const f=object(value);exactKeys(f,['path','content']);const path=text(f.path,128),content=text(f.content,32768);if(!/^[a-zA-Z0-9_.-]+\.dashboard\.lookml$/.test(path)||new TextEncoder().encode(content).length>32768)fail('looker_dashboard_file_required',400);return {path,content,sha256:sha256(content)}})
 if(new Set(files.map(f=>f.path)).size!==files.length)fail('looker_duplicate_file',400)
 const items:InventoryItem[]=[{id:'looker-originals',kind:'schema',sourceRevision:sha256(canonicalJson({files,bindings})),original:canonicalJson({files,bindings,references:lookerReferences,qualification:'Original format intake only; source parity and cutover remain unproved.'}),mapping:'Original filenames, bytes, digests and explicit inactive model mappings',gap:'Real authorized source estate and source-output reconciliation remain required.'}]
 for(const file of files){
  let dashboards:unknown,depth=0
  try{
   if(/(^|[\s,[{])[*&][A-Za-z0-9_-]+/m.test(file.content))throw Error('aliases')
   dashboards=load(file.content,{schema:JSON_SCHEMA,listener(event){if(event==='open'&&++depth>32)throw Error('depth');if(event==='close')depth--}})
  }catch{fail('looker_dashboard_yaml_required',400)}
  if(!Array.isArray(dashboards)||!dashboards.length||dashboards.length>8)fail('looker_dashboard_list_required',400)
  for(const value of dashboards){
   const source=object(value),id=text(source.dashboard,128)
   if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(id))fail('looker_dashboard_id_required',400)
   const document:LookerDashboard={file:file.path,fileDigest:file.sha256,source,bindings:bindings as Record<string,LookerBinding>,document:null}
   items.push({id:stableId('dashboard',id),kind:'dashboard',sourceRevision:sha256(canonicalJson(document)),original:canonicalJson(document),mapping:'Editable inactive native dashboard draft; exact current owner preview only',gap:'Review every dependency and unsupported item before preview; no publication, grants or schedules.'})
  }
 }
 if(new Set(items.map(i=>i.id)).size!==items.length)fail('looker_duplicate_dashboard',400)
 return items
}
export function dashboardIssues(document:LookerDashboard):LookerIssue[]{
 const issues:LookerIssue[]=[],root=document.source
 const add=(location:string,code:string,value:unknown,resolution:string)=>issues.push({location:document.file+':'+location,code,expression:canonicalJson(value??null),resolution})
 const keys=(value:Record<string,unknown>,allowed:string[],at:string)=>{for(const [key,v] of Object.entries(value))if(!allowed.includes(key))add(at+'.'+key,'unsupported_property',v,'Implement and reconcile this source property before rebuilding the dashboard.')}
 keys(root,['dashboard','title','layout','elements'],String(root.dashboard))
 if(root.layout!=='newspaper')add('layout','unsupported_layout',root.layout,'Supply supported newspaper placements; other layouts require implementation.')
 if(typeof root.title!=='string'||!root.title.trim()||root.title.length>160)add('title','dashboard_title_required',root.title,'Supply a bounded title.')
 if(!Array.isArray(root.elements)||root.elements.length<2||root.elements.length>4){add('elements','bounded_table_elements_required',root.elements,'Rebuild two to four table elements; all other elements remain unsupported.');return issues}
 const names=new Set<string>()
 for(const [index,value] of root.elements.entries()){
  let e:Record<string,unknown>;try{e=object(value)}catch{add('elements.'+index,'element_object_required',value,'Supply a named table element.');continue}
  const at='elements.'+index
  keys(e,['name','title','model','explore','type','fields','filters','sorts','limit','row','col','width','height'],at)
  if(typeof e.name!=='string'||!e.name||e.name.length>128||names.has(e.name))add(at+'.name','stable_element_id_required',e.name,'Supply a unique source element name.')
  names.add(String(e.name))
  if(e.type!=='looker_grid')add(at+'.type','unsupported_visual',e.type,'Implement this visual; only looker_grid tables are rebuilt.')
  if(typeof e.model!=='string'||typeof e.explore!=='string'||!document.bindings[e.model+'.'+e.explore])add(at+'.model','explicit_model_mapping_required',[e.model,e.explore],'Map this exact source model and Explore to an existing reviewed native view.')
  if(!Array.isArray(e.fields)||!e.fields.length||e.fields.length>12||e.fields.some(f=>typeof f!=='string')||new Set(e.fields).size!==e.fields.length)add(at+'.fields','physical_fields_required',e.fields,'Select unique explicitly mapped physical fields and measures.')
  if(e.filters!==undefined&&(!e.filters||typeof e.filters!=='object'||Array.isArray(e.filters)))add(at+'.filters','literal_filters_required',e.filters,'Use literal equality filters only.')
  if(!Number.isSafeInteger(e.limit)||Number(e.limit)<1||Number(e.limit)>5000)add(at+'.limit','explicit_limit_required',e.limit,'Specify a bounded row limit; preview refuses rather than truncates.')
  if(!['row','col','width','height'].every(k=>Number.isSafeInteger(e[k]))||Number(e.row)<0||Number(e.col)<0||Number(e.width)<2||Number(e.col)%2||Number(e.width)%2||Number(e.col)+Number(e.width)>24||Number(e.height)<1||Number(e.height)>1000||Number(e.row)+Number(e.height)>10000)add(at+'.placement','unsupported_placement',[e.row,e.col,e.width,e.height],'Use nonoverlapping even newspaper columns within the 24-column layout.')
 }
 return issues
}
