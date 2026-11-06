import type { Bindings } from '../../auth.server'
import { bifocalAgentDoor } from '../agent-door/index.server'
import { machineAuthority } from '../credentials/store.server'
import { exactKeys, json } from '../models/validation/transport'
import { fail, QueryError } from '../query/types'

export class AgentReadRefusal extends QueryError {
 constructor(code:string,status:number,public details:Record<string,unknown>) { super(code,status) }
}

/** Adapt only the wire protocol. The shared handler owns identity, classification,
 * policy, approval and execution; its tool alone reserves a native read. */
export async function agentRead(request:Request,env:Bindings,name:'definitions'|'query',input:Record<string,unknown>={}) {
 const {credential}=await machineAuthority(request,env)
 if(!credential.scope.tools.includes(name))fail('tool_not_permitted',403)
 exactKeys(input,name==='definitions'?[]:['modelId','revision','viewId','groupBy','filters','offset'])
 const requestState=request.headers.get('X-Bifocal-Request-State')
 if(requestState!==null&&(!requestState||requestState.length>512||/[\x00-\x1f\x7f]/.test(requestState)))fail('invalid_arguments',400)
 const tool='bifocal.analytics.'+name,method='tools'+'/call',version='2026-07-28'
 const headers=new Headers(request.headers)
 headers.delete('content-length')
 headers.set('Content-Type','application/json')
 headers.set('MCP-Protocol-Version',version)
 headers.set('MCP-Method',method)
 headers.set('MCP-Name',tool)
 const response=await bifocalAgentDoor(env).handle(new Request(new URL('/api/v1/mcp',env.AUTH_ORIGIN),{
  method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{name:tool,arguments:input,
   ...(requestState===null?{}:{requestState}),_meta:{'io.modelcontextprotocol/protocolVersion':version,
    'io.modelcontextprotocol/clientCapabilities':{elicitation:{url:{}}},
    ...(request.headers.has('traceparent')?{traceparent:request.headers.get('traceparent')}:{})}}}),
 }))
 if(!response)fail('operation_refused',409)
 const rpc=await response.json() as {error?:{data?:{code?:string}};result?:{resultType:string;isError?:boolean;structuredContent?:unknown;_meta:Record<string,unknown>;requestState?:string;inputRequests?:unknown}}
 if(!response.ok||rpc.error)throw new AgentReadRefusal(rpc.error?.data?.code??'operation_refused',response.ok?409:response.status,{})
 const result=rpc.result
 if(!result)fail('operation_refused',409)
 const meta=result._meta
 if(result.resultType==='input_required')throw new AgentReadRefusal('approval_required',202,{
  resultType:result.resultType,requestState:result.requestState,approval:meta['com.runeditrun/approval'],inputRequests:result.inputRequests,_meta:meta,
 })
 if(result.isError){
  const error=meta['com.runeditrun/error'] as {code:string;status?:number}&Record<string,unknown>
  const {code,status,...fields}=error
  const policyStatus=code==='invalid_arguments'?400:['policy_blocked','agents_paused','insufficient_scope','self_escalation'].includes(code)?403:409
  throw new AgentReadRefusal(code,status??policyStatus,{...fields,_meta:meta})
 }
 return {value:result.structuredContent,meta}
}

/** Keep existing successful JSON bodies, including GraphQL projections, intact. */
export function agentReadResponse(value:unknown,meta:Record<string,unknown>) {
 const response=json(value)
 for(const key of ['decision','review','receipt']){
  const value=meta['com.runeditrun/'+key]
  if(value!==undefined)response.headers.set('X-Bifocal-Agent-'+key,JSON.stringify(value))
 }
 return response
}
