import { DOMParser } from '@xmldom/xmldom'
import { unzipSync, strFromU8 } from 'fflate'
import { canonicalJson, sha256 } from '../../../../modules/import-kit/src/provenance/identity.ts'
import { assertNoCredentials, CredentialError, decodedCredentialText } from '../../../../modules/import-kit/src/provenance/credentials.ts'
import { readProject, type Project } from '../../models/readers'
import { fail } from '../../../query/types'

export type RecordItem={id:string;kind:string;file:string;digest:string;dependencies:string[];value:Record<string,unknown>}
export type Diagnostic={object:string;file:string;code:string;message:string;blocksPreview:boolean}
export type TableauInput={siteId:string;apiVersion:string;files:{path:string;content:string}[];publishedSources:{id:string;file:string;owner?:unknown;refresh?:unknown;dependencies?:string[]}[];bindings:Record<string,unknown>}
export type ReadTableau={input:TableauInput;records:RecordItem[];diagnostics:Diagnostic[];models:{sourceId:string;project:Project}[]}
export const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))fail('tableau_object_required',400);return v as Record<string,unknown>}
export const txt=(v:unknown,max=1024)=>{if(typeof v!=='string'||!v||v.length>max||/[\u0000-\u001f]/.test(v))fail('tableau_text_required',400);return v}
export const list=(v:unknown,max=100):unknown[]=>{if(!Array.isArray(v)||v.length>max)fail('tableau_list_required',400);return v}
const safePath=(p:string)=>p.length<=240&&!p.startsWith('/')&&!p.includes('\\')&&!/[:\u0000-\u001f]/.test(p)&&!p.split('/').some(s=>!s||s==='.'||s==='..')
/** Search decoded original text as well as structured fields. Refusals never echo a value. */
export function screenTableau(value:unknown):void{
 assertNoCredentials(value)
 if(typeof value==='string'){
  const text=decodedCredentialText(value)
  if(/(?:password|passwd|pwd|api[_-]?key|client[_-]?secret|access[_-]?token)\s*[=:]\s*["']?[^\s"'<>{},;]+|\bBearer\s+[a-z0-9._-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(text))throw new CredentialError('CREDENTIAL_IN_DURABLE_DATA',{kind:'field',name:'embedded credential'})
 }else if(Array.isArray(value))value.forEach(screenTableau)
 else if(value&&typeof value==='object')Object.values(value).forEach(screenTableau)
}
export function readTableauMigration(value:unknown):ReadTableau{
 const input=obj(value) as unknown as TableauInput
 txt(input.siteId,128);if(!/^3\.\d+$/.test(txt(input.apiVersion,12)))fail('tableau_api_version_required',400)
 list(input.files,32);list(input.publishedSources,32);obj(input.bindings);screenTableau(input)
 if(Object.keys(input).some(k=>!['siteId','apiVersion','files','publishedSources','bindings'].includes(k)))fail('tableau_unsupported_intake_property',400)
 const records:RecordItem[]=[],diagnostics:Diagnostic[]=[],models:ReadTableau['models']=[],documents=new Map<string,string>(),seen=new Set<string>()
 const problem=(object:string,file:string,code:string,message:string,blocksPreview=true)=>diagnostics.push({object,file,code,message,blocksPreview})
 const add=(id:string,kind:string,file:string,value:Record<string,unknown>,dependencies:string[]=[])=>{if(records.some(r=>r.id===id))fail('tableau_duplicate_identity',400);records.push({id,kind,file,digest:sha256(canonicalJson(value)),dependencies,value})}
 let total=0
 for(const file of input.files){
  txt(file.path,240);if(!safePath(file.path)||seen.has(file.path)||typeof file.content!=='string')fail('tableau_file_required',400)
  seen.add(file.path);total+=new TextEncoder().encode(file.content).length;if(total>786432)fail('tableau_file_limit',413)
  add('file:'+file.path,'original',file.path,{sha256:sha256(/\.tdsx$/i.test(file.path)?Uint8Array.from(atob(file.content),c=>c.charCodeAt(0)):file.content),encoding:/\.tdsx$/i.test(file.path)?'base64':'utf-8'})
  if(/\.tdsx$/i.test(file.path)){
   let size=0,count=0,unsafe=false
   try{
    if(!/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)||file.content.length%4)throw Error('base64')
    const archive=Uint8Array.from(atob(file.content),c=>c.charCodeAt(0)),names=new Set<string>()
    const extracted=unzipSync(archive,{filter(entry){if(entry.name.endsWith('/'))return false;size+=entry.originalSize;count++;if(!safePath(entry.name)||names.has(entry.name)||size>4194304||count>64||entry.originalSize>1048576){unsafe=true;return false}names.add(entry.name);return true}})
    if(unsafe)fail('unsafe_tableau_archive',422)
    let definitions=0
    for(const [path,bytes] of Object.entries(extracted)){
     screenTableau(strFromU8(bytes,true))
     const full=file.path+'/'+path,kind=/\.tds$/i.test(path)?'tds':/\.hyper$/i.test(path)?'extract':'unsupported-package-item'
     add('package:'+full,kind,full,{bytes:bytes.length,sha256:sha256(bytes)},['file:'+file.path])
     if(kind==='tds'){if(bytes.length>262144)fail('tableau_definition_limit',413);documents.set(full,strFromU8(bytes));definitions++}
     else problem('package:'+full,full,kind==='extract'?'hyper_not_loaded':'unsupported_package_item',kind==='extract'?'Extract retained in original package only. Supply a separately reviewed snapshot; Hyper schema, rows and cutoff parity are unproved.':'This packaged item is retained but is not interpreted.',false)
    }
    if(!definitions)problem('file:'+file.path,file.path,'tds_definition_missing','Supply the packaged TDS definition; the archive alone does not establish source semantics.')
   }catch(error){if(error instanceof CredentialError)throw error;fail('unsafe_tableau_archive',422)}
  }else if(/\.tds$/i.test(file.path))documents.set(file.path,file.content)
  else if(/\.json$/i.test(file.path)){
   let response:Record<string,unknown>;try{response=obj(JSON.parse(file.content))}catch{fail('tableau_response_json_required',400)}
   screenTableau(response)
   if(response.definition){const def=obj(response.definition),metadata=obj(def.metadata);add('definition:'+txt(metadata.id,128),'pulse-definition',file.path,def);for(const raw of list(def.metrics??[])){const metric=obj(raw);add('metric:'+txt(metric.id,128),'pulse-metric',file.path,metric,['definition:'+txt(metric.definition_id,128)])};if(response.candidate_definitions)problem('file:'+file.path,file.path,'candidate_definitions_unresolved','Candidate definitions remain unresolved; supply and review each dependency.')}
   else if(response.metric){const metric=obj(response.metric);add('metric:'+txt(metric.id,128),'pulse-metric',file.path,metric,['definition:'+txt(metric.definition_id,128)])}
   else if(response.subscriptions){for(const subscription of list(response.subscriptions)){const sub=obj(subscription);add('follower:'+txt(sub.id,128),'follower',file.path,sub,['metric:'+txt(sub.metric_id,128)]);problem('follower:'+sub.id,file.path,'follower_reauthorization_required','Inactive follower reference only; fresh native recipient authorization and delivery are unproved.',false)}if(response.next_page_token)problem('file:'+file.path,file.path,'incomplete_subscriptions','Supply all authorized subscription pages; this response is incomplete.')}
   else{add('response:'+file.path,'unsupported-response',file.path,response);problem('file:'+file.path,file.path,'unsupported_tableau_response','Supply an original GetDefinitionResponse, GetMetricResponse or ListSubscriptionsResponse.')}
   for(const key of Object.keys(response))if(!['definition','metric','subscriptions','next_page_token','candidate_definitions'].includes(key))problem('file:'+file.path,file.path,'unsupported_response_property','Untranslated response property: '+key)
  }else problem('file:'+file.path,file.path,'unsupported_tableau_file','Supply a TDSX, TDS or original documented Pulse JSON response.')
 }
 const sourceIds=new Set<string>()
 for(const source of input.publishedSources){
  if(Object.keys(source).some(k=>!['id','file','owner','refresh','dependencies'].includes(k)))fail('tableau_unsupported_source_property',400)
  txt(source.id,128);txt(source.file,240);if(sourceIds.has(source.id))fail('tableau_duplicate_source',400);sourceIds.add(source.id)
  const dependencies=source.dependencies??[];list(dependencies);dependencies.forEach(d=>txt(d,128))
  add('source:'+source.id,'published-source',source.file,{...source},dependencies.map(id=>'source:'+id))
  problem('source:'+source.id,source.file,'ownership_refresh_inactive','Ownership and refresh references confer no authority and do not run. Provider permission, cutoff and refresh parity remain unproved.',false)
  if(!source.owner)problem('source:'+source.id,source.file,'ownership_evidence_missing','Supply the original ownership reference; it never grants native authority.',false)
  if(!source.refresh)problem('source:'+source.id,source.file,'refresh_evidence_missing','Supply full or incremental refresh settings and schedules; none executes.',false)
  const xml=documents.get(source.file)
  if(!xml){problem('source:'+source.id,source.file,'published_definition_missing','Supply the exact TDS path inside the package or the standalone file.');continue}
  screenTableau(xml)
  if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))fail('unsafe_tableau_xml',422)
  try{const root=new DOMParser({onError:()=>{throw Error('xml')}}).parseFromString(xml,'application'+'/'+'xml').documentElement;if(!root||root.tagName!=='datasource')throw Error('root');for(const element of [root,...Array.from(root.getElementsByTagName('*'))])screenTableau(Object.fromEntries(Array.from(element.attributes).map(a=>[a.name,a.value])))}catch(error){if(error instanceof CredentialError)throw error;fail('unsafe_tableau_xml',422)}
  const project=readProject('tableau',[{path:source.file,content:xml}]);models.push({sourceId:source.id,project})
  for(const resource of project.resources??[])add('tds:'+source.id+':'+resource.id,resource.kind,source.file,resource.definition,resource.dependencies.map(d=>'tds:'+source.id+':'+d))
  for(const issue of project.issues)if(issue.code!=='source_table_binding')problem('source:'+source.id,issue.file,issue.code,issue.message)
 }
 for(const [path,xml] of documents){screenTableau(xml);if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))fail('unsafe_tableau_xml',422);if(!input.publishedSources.some(s=>s.file===path))problem('file:'+path,path,'unmapped_tds','Map every packaged TDS to its original published-source ID.')}
 for(const r of records)for(const dependency of r.dependencies)if(!records.some(d=>d.id===dependency))problem(r.id,r.file,'missing_dependency','Supply referenced '+dependency+'; no dependency is fetched.')
 if(!input.publishedSources.length)problem('project','','published_sources_missing','Supply original source IDs and packaged definition paths.')
 if(!input.files.some(f=>/\.json$/i.test(f.path)&&f.content.includes('\"subscriptions\"')))problem('project','','follower_evidence_missing','No follower response supplied; follower migration and reauthorization remain unproved.',false)
 if(records.length>100)fail('tableau_inventory_limit',413)
 return {input,records,diagnostics,models}
}
