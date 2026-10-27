import {buildSchema,graphql,parse,validate} from 'graphql'
import {runtimeBindings,type Bindings} from '../../auth.server'
import {currentAuthority} from '../catalog/authority.server'
import {semanticResponse} from '../models/validation/server'
import {metricResponse} from '../metrics/store.server'
import {metricDefinitionResponse} from '../metrics/definitions.server'
import {catalogResponse} from '../catalog/server'
import {reportCustodyResponse} from '../reports/server'
import {exactKeys,json,jsonBody,discardBody} from '../models/validation/transport'
import {fail,QueryError} from '../query/types'
export const nativeSchema=`scalar JSON
 type Query { model(id:String!):JSON!, metric(id:String!):JSON!, metrics:JSON!, content(id:String!):JSON!, contentSearch(q:String,offset:Int):JSON! }
 type Mutation { createModel(definition:JSON!):JSON!, updateModel(modelId:String!,branchId:String!,previousVersion:Int!,definition:JSON!):JSON!, createMetric(input:JSON!):JSON!, proposeMetric(id:String!,input:JSON!):JSON!, createContent(input:JSON!):JSON!, updateContent(id:String!,previousVersion:Int!,input:JSON!):JSON! }`
const schema=buildSchema(nativeSchema)
const families={models:{path:'models',handler:semanticResponse},metrics:{path:'metrics',handler:metricResponse},'metric-definitions':{path:'metric-definitions',handler:metricDefinitionResponse},content:{path:'library',handler:catalogResponse},'report-runs':{path:'report-runs',handler:reportCustodyResponse}}
const identifier=(value:string,kind:'uuid'|'metric')=>{if(!(kind==='uuid'?/^[a-f0-9-]{36}$/:/^[a-z][a-z0-9-]{0,63}$/).test(value))fail('invalid_resource_id',400);return value}
/** Versioned native APIs reuse the same handlers, current sessions, exact review
 * and optimistic concurrency as the application. A bearer never selects them. */
export async function nativeApiResponse(request:Request,original:Bindings):Promise<Response>{
 const url=new URL(request.url),env=runtimeBindings(original)
 try{
  if(request.headers.has('authorization'))fail('human_session_required',403)
  const actor=await currentAuthority(request,env)
  if(!actor)fail('session_required',401)
  if(actor.role!=='owner')fail('owner_required',403)
  const route=async(path:string,method=request.method,body?:unknown)=>{
   const target=new URL(url);target.pathname='/api/operator/'+path.split('?')[0];target.search=path.includes('?')?path.slice(path.indexOf('?')):url.search
   const name=path.split('/')[0].split('?')[0] as keyof typeof families,family=families[name]
   if(!family)fail('not_found',404)
   target.pathname=target.pathname.replace('/api/operator/'+name,'/api/operator/'+family.path)
   const headers=new Headers(request.headers);headers.delete('content-length');headers.set('accept','application'+'/json')
   const forwarded=body!==undefined?new Request(target,{method,headers,body:JSON.stringify(body)}):['GET','HEAD'].includes(method)?new Request(target,{method,headers}):new Request(target,{method,headers,body:request.clone().body})
   return await family.handler(forwarded,env)??json({error:'not_found'},404)
  }
  const path=url.pathname.slice('/api/v1/native/'.length)
  if(path==='schema'&&request.method==='GET'){
   // Reuse a native read's transaction boundary for session and owner validity.
   const checked=await route('metrics','GET');if(!checked.ok)return checked;await checked.arrayBuffer()
   return json({version:1,graphql:nativeSchema,rest:Object.keys(families).map(name=>'/api/v1/native/'+name),authority:'current native owner session',machineAuthority:false})
  }
  if(path!=='graphql')return await route(path)
  if(request.method!=='POST')fail('method_not_allowed',405)
  if(url.search)fail('unsupported_input',400)
  const input=await jsonBody(request);exactKeys(input,['query','variables','operationName'])
  if(typeof input.query!=='string'||input.query.length>8192||input.variables!==undefined&&(!input.variables||typeof input.variables!=='object'||Array.isArray(input.variables))||input.operationName!==undefined&&typeof input.operationName!=='string')fail('invalid_graphql_request',400)
  let document;try{document=parse(input.query)}catch{fail('invalid_graphql_request',400)}
  if(document.definitions.length!==1||document.definitions[0].kind!=='OperationDefinition'||document.definitions[0].selectionSet.selections.length!==1||document.definitions[0].selectionSet.selections[0].kind!=='Field'||validate(schema,document).length)fail('single_native_operation_required',400)
  const invoke=async(path:string,method='GET',body?:unknown)=>{
   const response=await route(path,method,body),result=await response.json() as Record<string,unknown>
   if(!response.ok)fail(typeof result.error==='string'?result.error:'native_operation_refused',response.status)
   return result
  }
  const uuid=(id:string)=>identifier(id,'uuid'),metric=(id:string)=>identifier(id,'metric')
  const root={
   model:({id}:{id:string})=>invoke('models/'+uuid(id)),metric:({id}:{id:string})=>invoke('metrics/'+metric(id)),metrics:()=>invoke('metrics'),content:({id}:{id:string})=>invoke('content'+'/items/'+uuid(id)),
   contentSearch:({q='',offset=0}:{q?:string;offset?:number})=>invoke('content'+'/search?'+new URLSearchParams({q,offset:String(offset)})),
   createModel:({definition}:{definition:unknown})=>invoke('models','POST',{definition}),
   updateModel:({modelId,branchId,previousVersion,definition}:{modelId:string;branchId:string;previousVersion:number;definition:unknown})=>invoke('models/'+uuid(modelId)+'/branches/'+uuid(branchId),'PUT',{previousVersion,definition}),
   createMetric:({input}:{input:unknown})=>invoke('metrics','POST',input),proposeMetric:({id,input}:{id:string;input:unknown})=>invoke('metrics/'+metric(id)+'/propose','POST',input),
   createContent:({input}:{input:unknown})=>invoke('content'+'/items','POST',input),updateContent:({id,previousVersion,input}:{id:string;previousVersion:number;input:Record<string,unknown>})=>invoke('content'+'/items/'+uuid(id),'PUT',{...input,previousVersion})
  }
  const result=await graphql({schema,source:input.query,variableValues:input.variables as Record<string,unknown>|undefined,operationName:input.operationName as string|undefined,rootValue:root})
  if(result.errors){const error=result.errors[0].originalError;return json({errors:[{message:error instanceof QueryError?error.code:'native_operation_refused'}]},error instanceof QueryError?error.status:409)}
  return json(result)
 }catch(error){return json({error:error instanceof QueryError?error.code:'native_operation_refused'},error instanceof QueryError?error.status:409)}finally{await discardBody(request)}
}
