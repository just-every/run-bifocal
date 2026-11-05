import type { Bindings } from '../../auth.server'
import type { AgentDoorOptions } from '../../modules/agent-door/index.ts'
import { readTools } from './tools.server'
import { analyticsPrompts } from './prompt'

/** The door and installed guide consume this same public configuration. */
export function analyticsRegistry(env: Bindings) {
 return {
  specialist:'analytics',
  capabilities:['tools','policy','pause','audit','idempotency','prompts'] as const,
  limits:{requestsPerMinute:600,maxBodyBytes:1048576},
  tools:readTools(env).sort((a,b)=>a.name.localeCompare(b.name)),
  resources:[] as NonNullable<AgentDoorOptions['resources']>,
  prompts:analyticsPrompts,
 }
}

export const readRefusals = {
 policy_unset:'A person must complete company policy at /agents before work can run.',
 policy_unavailable:'The current company policy is unavailable. Ask its administrator to restore it.',
 policy_blocked:'Company policy blocks this call. Do not retry to bypass it.',
 agents_paused:'Agents are paused. Only a person can resume them at /agents.',
 approval_required:'A named person must approve the exact request at the returned URL.',
 approval_rejected:'The person rejected the request. No analytical result is released.',
 approval_expired:'The approval expired. A new exact request requires fresh approval.',
 insufficient_scope:'The credential lacks the required scope. Ask the native owner for review.',
 credential_required:'Native read authority is absent, expired, retired or revoked. Fresh owner review is required.',
 reviewed_agent_grant_required:'The named agent has no current reviewed native grant.',
 credential_scope_changed:'Source or model evidence changed. The old activation is retired; obtain fresh owner review.',
 scope_not_permitted:'The requested model, revision or view is outside the exact reviewed grant.',
 dimension_not_permitted:'A grouping or filter field is outside the reviewed dimensions. No answer is released.',
 tool_not_permitted:'The native credential does not permit this read operation.',
 invalid_page_offset:'Use zero or the preceding answer’s nextOffset within the current result.',
 native_state_conflict:'Native authority or source evidence changed before release. Obtain fresh review.',
 capability_not_declared:'This installed capability is unavailable. Documentation grants no access.',
 invalid_arguments:'Use the tool’s declared input schema.',
 tool_not_found:'The named tool is not offered by this registry.',
 rate_limited:'Request capacity was exceeded. Honor Retry-After.',
} as const
