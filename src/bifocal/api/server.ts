import { nativeApiResponse } from './native.server'
import { buildSchema, graphql } from 'graphql'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { credentialResponse, machineAuthority, machineAudit, recordMachineRefusal } from '../credentials/store.server'
import { credentialBindings } from '../credentials/bindings.server'
import { scopedQuery } from '../models/validation/protocol'
import { intersectSources } from '../credentials/sources.server'
import { queryContext } from '../query/context'
import { queryInput } from '../query/validate'
import { execute } from '../query/execute'
import { fail, QueryError } from '../query/types'
import { exactKeys, json, jsonBody, discardBody } from '../models/validation/transport'
export const schemaText=`scalar JSON
input QueryInput { modelId: String!, revision: String!, viewId: String!, groupBy: [String!]!, filters: [JSON!]!, offset: Int }
type QueryPage { rows: JSON!, totals: JSON!, totalRows: Int!, offset: Int!, nextOffset: Int, citations: JSON!, query: JSON! }
type Query { definitions: JSON!, query(input: QueryInput!): QueryPage! }`
const schema=buildSchema(schemaText)
const tool={name:'query',description:'Read one explicitly permitted published semantic view. Fixed source and row restrictions always intersect request filters.',inputSchema:{type:'object',properties:{modelId:{type:'string'},revision:{type:'string'},viewId:{type:'string'},groupBy:{type:'array',items:{type:'string'}},filters:{type:'array',items:{type:'object'}},offset:{type:'integer',minimum:0}},required:['modelId','revision','viewId','groupBy','filters'],additionalProperties:false}}
async function machineOperation(request:Request,env:Bindings,name:string,input:Record<string,unknown>={}){
 const {credential:c,authority}=await machineAuthority(request,env),scope=c.scope
 if(!scope.tools.includes(name))fail('tool_not_permitted',403)
 const {model,view,sources,rules,fences}=await credentialBindings(env,c)
 const reserve=()=>transact(env.DB,authority,[...fences.map(assertion),assertion(sql('EXISTS(SELECT 1 FROM bf_machine_credentials WHERE id=? AND used_operations<max_operations)',c.id)),sql('UPDATE bf_machine_credentials SET used_operations=used_operations+1 WHERE id=?',c.id),machineAudit(c.id,c.owner_id,'machine','read-reserved')])
 let result:unknown
 if(name==='definitions'){
  exactKeys(input,[])
  intersectSources({...view.query,groupBy:scope.dimensions,filters:[...view.query.filters,...view.rowRules,...scope.filters],measures:view.query.measures.filter(m=>scope.measures.includes(m.id))},rules)
  await reserve()
  result={modelId:model.id,revision:scope.revision,viewId:scope.viewId,dimensions:scope.dimensions,measures:view.query.measures.filter(m=>scope.measures.includes(m.id)).map(m=>({id:m.id,unit:m.unit})),scopeDigest:c.digest,tools:scope.tools}
 }else{
  exactKeys(input,['modelId','revision','viewId','groupBy','filters','offset'])
  if(input.modelId!==scope.modelId||input.revision!==scope.revision||input.viewId!==scope.viewId)fail('scope_not_permitted',403)
  const candidate=queryInput({...view.query,groupBy:input.groupBy,filters:input.filters})
  if(candidate.groupBy.some(d=>!scope.dimensions.includes(d))||candidate.filters.some(f=>!scope.dimensions.includes(f.column)))fail('dimension_not_permitted',403)
  const offset=input.offset??0
  if(!Number.isSafeInteger(offset)||Number(offset)<0)fail('invalid_page_offset',400)
  const query=intersectSources(queryInput({...scopedQuery(view,scope.revision),groupBy:candidate.groupBy,filters:[...view.query.filters,...view.rowRules,...scope.filters,...candidate.filters],measures:view.query.measures.filter(m=>scope.measures.includes(m.id))}),rules)
  const context=await queryContext(env,query,c.owner_id)
  fences.push(...context.guards??[])
  await reserve()
  const answer=execute(query,sources,context)
  if(Number(offset)>answer.rows.length)fail('invalid_page_offset',400)
  result={rows:answer.rows.slice(Number(offset),Number(offset)+25),totals:answer.totals,totalRows:answer.rows.length,offset,nextOffset:Number(offset)+25<answer.rows.length?Number(offset)+25:null,
   citations:{modelId:model.id,revision:scope.revision,viewId:scope.viewId,scopeDigest:c.digest,definitionHash:answer.definitionHash,semanticsVersion:answer.semanticsVersion,sourceWatermarks:answer.sourceWatermarks,companyRevision:context.company.revision,calendar:query.context.calendar,credentialId:c.id},
   query:{modelId:model.id,revision:scope.revision,viewId:scope.viewId,groupBy:candidate.groupBy,filters:candidate.filters,measures:scope.measures,fiscal:query.fiscal??null}}
 }
 // Recheck the reserved activation and all current bindings before releasing data.
 // No raw source count, hidden schema, credential or source text enters diagnostics.
 await transact(env.DB,authority,[...fences.map(assertion),machineAudit(c.id,c.owner_id,'machine',name)])
 return result
}
export async function publicApiResponse(request:Request,original:Bindings):Promise<Response|null>{
 const path=new URL(request.url).pathname
 if(!/^\/api\/operator\/credentials(?:\/|$)/.test(path)&&!/^\/api\/v1(?:\/|$)/.test(path))return null
 if(path.startsWith('/api/v1/native/'))return nativeApiResponse(request,original)
 const env=runtimeBindings(original)
 try{
  const admin=await credentialResponse(request,env);if(admin)return admin
  if(new URL(request.url).search)fail('unsupported_input',400)
  // Even protocol discovery requires a current credential; cookies never substitute.
  await machineAuthority(request,env)
  if(path==='/api/v1/schema'&&request.method==='GET')return json({version:1,graphql:schemaText,rest:{definitions:{method:'GET',path:'/api/v1/definitions'},query:{method:'POST',path:'/api/v1/query',input:tool.inputSchema}},limits:{pageSize:25,maxBodyBytes:65536},mcp:{path:'/api/v1/mcp',protocolVersion:'2025-06-18'}})
  if(path==='/api/v1/definitions'&&request.method==='GET')return json(await machineOperation(request,env,'definitions'))
  if(path==='/api/v1/query'&&request.method==='POST')return json(await machineOperation(request,env,'query',await jsonBody(request)))
  if(path==='/api/v1/graphql'&&request.method==='POST'){
   const input=await jsonBody(request);exactKeys(input,['query','variables','operationName'])
   if(typeof input.query!=='string'||input.query.length>8192||input.variables!==undefined&&(!input.variables||typeof input.variables!=='object'||Array.isArray(input.variables))||input.operationName!==undefined&&typeof input.operationName!=='string')fail('invalid_graphql_request',400)
   // One root operation prevents alias amplification and partial release when a
   // later field exhausts a budget. Introspection remains on the explicit schema door.
   const {parse,validate,specifiedRules}=await import('graphql')
   let document
   try{document=parse(input.query)}catch{fail('invalid_graphql_request',400)}
   if(document.definitions.length!==1||document.definitions[0].kind!=='OperationDefinition'||document.definitions[0].operation!=='query'||document.definitions[0].selectionSet.selections.length!==1||document.definitions[0].selectionSet.selections[0].kind!=='Field'||!['query','definitions'].includes(document.definitions[0].selectionSet.selections[0].name.value))fail('single_read_operation_required',400)
   const root=document.definitions[0].selectionSet.selections[0]
   if(root.selectionSet&&(root.selectionSet.selections.length>8||root.selectionSet.selections.some(field=>field.kind!=='Field'||field.alias)))fail('bounded_result_selection_required',400)
   if(validate(schema,document,specifiedRules).length)fail('invalid_graphql_request',400)
   const result=await graphql({schema,source:input.query,variableValues:input.variables as Record<string,unknown>|undefined,operationName:input.operationName as string|undefined,rootValue:{definitions:()=>machineOperation(request,env,'definitions'),query:({input}:{input:Record<string,unknown>})=>machineOperation(request,env,'query',input)}})
   if(result.errors){await recordMachineRefusal(request,env).catch(()=>{});const error=result.errors[0].originalError,code=error instanceof QueryError?error.code:'operation_refused',status=error instanceof QueryError?error.status:409;return json({errors:[{message:code,extensions:{code}}]},status)}
   return json(result)
  }
  if(path==='/api/v1/mcp'&&request.method==='POST'){
   const body=await jsonBody(request);exactKeys(body,['jsonrpc','id','method','params'])
   if(body.jsonrpc!=='2.0'||typeof body.method!=='string'||body.id!==undefined&&typeof body.id!=='string'&&!(typeof body.id==='number'&&Number.isSafeInteger(body.id)))fail('invalid_rpc_request',400)
   if(body.method==='notifications'+'/initialized'&&body.id===undefined)return new Response(null,{status:202,headers:{'cache-control':'no-store'}})
   if(body.id===undefined)fail('rpc_id_required',400)
   const reply=(result:unknown)=>json({jsonrpc:'2.0',id:body.id,result})
   if(body.method==='initialize')return reply({protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'bifocal',version:'1'}})
   if(body.method==='ping')return reply({})
   if(body.method==='tools'+'/list'){
    const {credential}=await machineAuthority(request,env)
    await transact(env.DB,(await machineAuthority(request,env)).authority,[])
    return reply({tools:credential.scope.tools.includes('query')?[tool]:[]})
   }
   if(body.method==='tools'+'/call'){
    try{
    const params=body.params as Record<string,unknown>|undefined
    if(!params||typeof params!=='object'||Array.isArray(params))fail('invalid_tool_request',400)
    exactKeys(params,['name','arguments'])
    if(params.name!=='query')fail('tool_not_permitted',403)
    if(!params.arguments||typeof params.arguments!=='object'||Array.isArray(params.arguments))fail('invalid_tool_request',400)
    const result=await machineOperation(request,env,'query',params.arguments as Record<string,unknown>)
    return reply({content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:false})
    }catch(error){await recordMachineRefusal(request,env).catch(()=>{});const code=error instanceof QueryError?error.code:'operation_refused';return reply({content:[{type:'text',text:code}],isError:true})}
   }
   return json({jsonrpc:'2.0',id:body.id,error:{code:-32601,message:'Method not found'}})
  }
  fail('not_found',404)
 }catch(error){await recordMachineRefusal(request,env).catch(()=>{});if(error instanceof QueryError)return json({error:error.code},error.status);return json({error:'operation_refused',reason:'Check current authority, scope and remaining operation budget.'},409)}finally{await discardBody(request)}
}
