import type { Bindings } from '../../auth.server'
import { ToolRefusal, type ToolContext } from '../../modules/agent-door/index.ts'
import { sql } from '../../modules/import-kit/src/door/store.ts'
import type { Authority } from '../catalog/authority.server'

/** The public door retains admission before entering the native service. Fence
 * its policy revision, agent and consent alongside the native response commit. */
export async function admissionAuthority(env: Bindings, ctx: ToolContext, native: Authority): Promise<Authority> {
 const state=await env.DB.prepare('SELECT envelope,local_document,local_revision,local_paused FROM agent_door_state WHERE id=1').first<{envelope:string|null;local_document:string|null;local_revision:number;local_paused:number}>()
 const admission=await env.DB.prepare('SELECT row FROM agent_door_audit WHERE id=?').bind(ctx.operationId).first<{row:string}>()
 if(!state || !admission) throw new ToolRefusal('operation_mismatch')
 const managed=Boolean(env.RER_OWNER_CLAIM_PUBLIC_KEYS)
 const row=JSON.parse(admission.row), envelope=state.envelope ? JSON.parse(state.envelope) : null
 if(row.sponsor.id!==ctx.person.id || row.agent.id!==ctx.agent.id || row.consent!==(ctx.consent??null)) throw new ToolRefusal('operation_mismatch')
 if(state.local_paused || envelope?.paused) throw new ToolRefusal('agents_paused')
 if(envelope?.revoked?.agents?.includes(ctx.agent.id)) throw new ToolRefusal('agent_revoked')
 if(ctx.consent && envelope?.revoked?.consents?.includes(ctx.consent)) throw new ToolRefusal('consent_revoked')
 if(managed && (!envelope?.document || envelope.exp*1000<=Date.now())) throw new ToolRefusal('policy_unavailable')
 if((managed ? envelope?.revision : state.local_revision)!==row.revision) throw new ToolRefusal('policy_changed')
 const guard=sql(`(${native.sql}) AND EXISTS(SELECT 1 FROM agent_door_state WHERE id=1 AND local_paused=0 AND envelope IS ? AND local_document IS ? AND local_revision=? ${managed ? "AND json_extract(envelope,'$.exp')*1000>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)" : ''})
  AND EXISTS(SELECT 1 FROM agent_door_agents WHERE id=? AND sponsor=? AND revoked=0)`,...native.params??[],state.envelope,state.local_document,state.local_revision,ctx.agent.id,ctx.person.id)
 return {...native,...guard}
}
