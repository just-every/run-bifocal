import type { Bindings } from '../../auth.server'
import type { ResourceDefinition } from '../../modules/agent-door/index.ts'
import type { Credential } from '../credentials/store.server'
import { credentialDefinitions, credentialOperation } from '../api/server'
import { reviewedCredential, toolScope } from './grants.server'
import { admissionAuthority } from './admission.server'
import { native } from './tools.server'

export const definitionTemplate = 'bifocal://models/{modelId}/revisions/{revision}/views/{viewId}/definition'
export const definitionUri = (c: Credential) => `bifocal://models/${encodeURIComponent(c.scope.modelId)}/revisions/${encodeURIComponent(c.scope.revision)}/views/${encodeURIComponent(c.scope.viewId)}/definition`
export const definitionLinks = (c: Credential) => c.scope.tools.includes('definitions') ? [{uri:definitionUri(c),name:'Reviewed view definition'}] : []

/** Each door request gets its own adapter. The shared door calls read for pure
 * classification, then classify, then read again only after policy admission.
 * Remember that classified operation, rather than charging preview or discovery.
 * The native service still fences admission and reserves exactly one lifetime read. */
export function definitionResources(env: Bindings): ResourceDefinition[] {
 const classified = new Set<string>()
 return [{
  uriTemplate:definitionTemplate,name:'Reviewed view definition',
  description:'Only the explicitly selected published model and view definition with permitted fields.',
  mimeType:'application/json',scope:toolScope('definitions'),classes:['sensitive'],
  classify(_record,ctx) {
   if(ctx.operationId) classified.add(ctx.operationId)
   return [{class:'sensitive',facts:{measure:1,kind:'reviewed-analytical-answer'}}]
  },
  async read(uri,ctx) {
   return native(async () => {
    const admitted=ctx.operationId !== undefined && classified.delete(ctx.operationId)
    const admission=await reviewedCredential(env,ctx),c=admission.credential
    if(!c.scope.tools.includes('definitions') || uri!==definitionUri(c)) return null
    if(!admitted) return {json:await credentialDefinitions(env,c),untrusted:true}
    // A classified record alone is never authority: only the shared door's
    // persisted admission can enter the existing native execution service.
    admission.authority=await admissionAuthority(env,{...ctx,operationId:ctx.operationId!},admission.authority)
    return {json:await credentialOperation(env,admission,'definitions',{}, {agentId:ctx.agent.id,agentName:ctx.agent.name,sponsorName:ctx.person.name}),untrusted:true}
   })
  },
 }]
}
