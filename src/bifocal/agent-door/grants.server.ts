import type { Bindings } from '../../auth.server'
import type { Principal } from '../../modules/agent-door/index.ts'
import { currentAuthority, type Authority } from '../catalog/authority.server'
import { credentialGuard, type Credential } from '../credentials/store.server'
import { credentialBindings } from '../credentials/bindings.server'
import { machineAudit } from '../credentials/store.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { discardBody, exactKeys, json, jsonBody } from '../models/validation/transport'
import { fail, QueryError } from '../query/types'

export const toolScope = (name: string) => `bifocal:${name}`
export async function reviewedCredential(env: Bindings, principal: Pick<Principal, 'person' | 'agent' | 'clientId' | 'consent'>) {
 const id = principal.consent === undefined && principal.clientId?.startsWith('native:') ? principal.clientId.slice(7) : null
 const row = await env.DB.prepare(`SELECT c.* FROM bf_machine_credentials c
  WHERE c.owner_id=? AND ${id ? 'c.id=?' : 'EXISTS(SELECT 1 FROM bf_agent_grants g WHERE g.credential_id=c.id AND g.owner_id=c.owner_id AND g.agent_id=?)'}`)
  .bind(principal.person.id, id ?? principal.agent.id).first<Credential>()
 if (!row) fail('reviewed_agent_grant_required', 403)
 const credential = {...row, scope: JSON.parse(row.definition_json) as Credential['scope']}
 if (sha256(canonicalJson(credential.scope)) !== credential.digest) fail('credential_required', 401)
 const guard = credentialGuard(credential)
 const binding = id ? guard : sql(`(${guard.sql}) AND EXISTS(SELECT 1 FROM bf_agent_grants WHERE agent_id=? AND credential_id=? AND owner_id=?)`, ...guard.params ?? [], principal.agent.id, row.id, principal.person.id)
 if (!await env.DB.prepare(`SELECT 1 WHERE (${binding.sql})`).bind(...binding.params ?? []).first()) fail('credential_required', 401)
 const authority: Authority = {...binding, id: principal.person.id, email: principal.person.email, role: principal.person.role}
 return {credential, authority}
}

/** Human account session and exact current scope review; a company policy or
 * agent bearer cannot create, inherit or approve this native grant. */
export async function agentBindingResponse(request: Request, env: Bindings): Promise<Response | null> {
 const match = /^\/api\/operator\/credentials\/([a-f0-9-]{36})\/(agent-review|agent-bind)$/.exec(new URL(request.url).pathname)
 if (!match) return null
 try {
  if (request.headers.has('authorization')) fail('human_session_required',403)
  const actor = await currentAuthority(request,env)
  if (!actor || actor.role !== 'owner') fail('owner_required',403)
  if (request.method !== 'POST') fail('method_not_allowed',405)
  const input = await jsonBody(request); exactKeys(input,['agentId','reviewedDigest'])
  if (typeof input.agentId !== 'string' || !input.agentId.trim() || input.agentId.length > 200 || /[\x00-\x1f]/.test(input.agentId)) fail('invalid_agent_id',400)
  const row = await env.DB.prepare('SELECT * FROM bf_machine_credentials WHERE id=? AND owner_id=?').bind(match[1],actor.id).first<Credential>()
  if (!row) fail('credential_required',404)
  const credential = {...row,scope:JSON.parse(row.definition_json) as Credential['scope']}, guard = credentialGuard(credential)
  const {fences} = await credentialBindings(env,credential)
  const review = {agentId:input.agentId,credentialId:row.id,ownerId:actor.id,scope:credential.scope,scopeDigest:row.digest}
  const digest = sha256(canonicalJson(review))
  const checks = [guard,...fences].map(assertion)
  if (match[2] === 'agent-review') { await transact(env.DB,actor,checks); return json({...review,digest}) }
  if (input.reviewedDigest !== digest) fail('exact_agent_review_required',409)
  await transact(env.DB,actor,[...checks,sql(`INSERT INTO bf_agent_grants(agent_id,credential_id,owner_id,reviewed_digest,reviewed_at) VALUES(?,?,?,?,?)
   ON CONFLICT(agent_id) DO UPDATE SET credential_id=excluded.credential_id,owner_id=excluded.owner_id,reviewed_digest=excluded.reviewed_digest,reviewed_at=excluded.reviewed_at`, input.agentId,row.id,actor.id,digest,new Date().toISOString()),machineAudit(row.id,actor.id,'human','agent-bound-exact-review')])
  return json({agentId:input.agentId,credentialId:row.id,bound:true})
 } catch (error) { return json({code:error instanceof QueryError ? error.code : 'agent_binding_refused'},error instanceof QueryError ? error.status : 409) }
 finally { await discardBody(request) }
}
