import { ToolRefusal, type ToolDefinition, type ToolContext } from '../../modules/agent-door/index.ts'
import type { Bindings } from '../../auth.server'
import { credentialOperation } from '../api/server'
import { credentialBindings } from '../credentials/bindings.server'
import { reviewedCredential, toolScope } from './grants.server'
import { outputSchemas } from './schemas'
import { admissionAuthority } from './admission.server'
import { assertion, transact } from '../../modules/import-kit/src/door/store.ts'
import { QueryError } from '../query/types'

export async function native<T>(fn: () => Promise<T>): Promise<T> {
 try { return await fn() } catch (error) {
  if (error instanceof QueryError) throw new ToolRefusal(error.code)
  for(let cause:unknown=error;cause instanceof Error;cause=cause.cause) if(cause.message.includes('IMPORT_ATOMIC_GUARD')) throw new ToolRefusal('native_state_conflict')
  throw error
 }
}
export function readTools(env: Bindings): ToolDefinition[] {
 return ['status','definitions','query'].map((name): ToolDefinition => ({
  name:`bifocal.analytics.${name}`,title:name === 'query' ? 'Query reviewed view' : 'Read reviewed definitions',
  description:'Read only the current native owner’s exactly reviewed published view, source bindings, fields, restrictions and lifetime allowance.',
  scope:toolScope(name === 'status' ? 'definitions' : name),readOnly:true,classes:name === 'status' ? ['standard'] : ['sensitive'],clauses:['BIF-027','BIF-035','BASE-AGENT-002','BASE-AGENT-006'],untrusted:name !== 'status',
  inputSchema:name !== 'query' ? {type:'object',properties:{},additionalProperties:false} : {type:'object',properties:{modelId:{type:'string'},revision:{type:'string'},viewId:{type:'string'},groupBy:{type:'array',items:{type:'string'}},filters:{type:'array',items:{type:'object'}},offset:{type:'integer',minimum:0}},required:['modelId','revision','viewId','groupBy','filters'],additionalProperties:false},
  outputSchema:outputSchemas[name],
  async classify(_args,ctx) { return native(async () => { const admission=await reviewedCredential(env,ctx); await credentialBindings(env,admission.credential); return name === 'status' ? [{class:'standard',facts:{measure:1}}] : [{class:'sensitive',facts:{measure:1,kind:'reviewed-analytical-answer'}}] }) },
  async target(_args,ctx) { return native(async () => ({kind:'model',id:(await reviewedCredential(env,ctx)).credential.scope.modelId})) },
  async run(args,ctx:ToolContext) { return native(async () => {
   const admission=await reviewedCredential(env,ctx)
   admission.authority=await admissionAuthority(env,ctx,admission.authority)
   if(name === 'status') {
    const {fences}=await credentialBindings(env,admission.credential)
    await transact(env.DB,admission.authority,fences.map(assertion))
    const c=admission.credential
    return {result:{credentialId:c.id,modelId:c.scope.modelId,revision:c.scope.revision,scopeDigest:c.digest,active:true}}
   }
   return {result:await credentialOperation(env,admission,name,args,{agentId:ctx.agent.id,agentName:ctx.agent.name,sponsorName:ctx.person.name})}
  }) },
 }))
}
