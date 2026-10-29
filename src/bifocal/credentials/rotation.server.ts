import { randomBytes, randomUUID } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import type { Authority } from '../catalog/authority.server'
import { assertion, sql, transact } from '../../modules/import-kit/src/door/store.ts'
import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { exactKeys, json, jsonBody } from '../models/validation/transport'
import { fail } from '../query/types'
import { credentialBindings } from './bindings.server'
import { credentialGuard, credentialHash, machineAudit, type Credential } from './store.server'

export async function rotationResponse(request: Request, env: Bindings, actor: Authority, path: string): Promise<Response | null> {
 const match = /^\/api\/operator\/credentials\/([a-f0-9-]{36})\/rotate(\/review)?$/.exec(path)
 if (!match) return null
 if (request.method !== 'POST') fail('method_not_allowed', 405)
 const input = await jsonBody(request)
 exactKeys(input, match[2] ? [] : ['reviewedAt', 'reviewedDigest'])
 const row = await env.DB.prepare('SELECT * FROM bf_machine_credentials WHERE id=? AND owner_id=?').bind(match[1], actor.id).first<Omit<Credential, 'scope'>>()
 if (!row) fail('credential_not_found', 404)
 const credential = {...row, scope: JSON.parse(row.definition_json)}, active = credentialGuard(credential)
 if (sha256(canonicalJson(credential.scope)) !== credential.digest) fail('credential_scope_changed', 409)
 if (!(await env.DB.prepare(`SELECT 1 AS ok WHERE (${active.sql})`).bind(...active.params ?? []).first())) fail('credential_inactive', 409)
 const {fences} = await credentialBindings(env, credential)
 const reviewedAt = match[2] ? new Date().toISOString() : input.reviewedAt
 const time = typeof reviewedAt === 'string' ? Date.parse(reviewedAt) : NaN
 if (!Number.isFinite(time) || new Date(time).toISOString() !== reviewedAt || time > Date.now() || time <= Date.now() - 300000) fail('fresh_rotation_review_required', 409)
 // Native session and its current membership version are part of this review.
 const digest = credentialHash(env, canonicalJson({action: 'rotate', id: credential.id, scope: credential.scope, ownerVersion: credential.owner_version, usedOperations: credential.used_operations, authority: actor, reviewedAt}))
 const guards = [active, ...fences, sql('EXISTS(SELECT 1 FROM bf_machine_credentials WHERE id=? AND used_operations=?)', credential.id, credential.used_operations), sql("? > strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes')", reviewedAt)]
 if (match[2]) {
  await transact(env.DB, actor, [...guards.map(assertion), machineAudit(credential.id, actor.id, 'human', 'rotation-reviewed')])
  return json({id: credential.id, scope: credential.scope, usedOperations: credential.used_operations, reviewedAt, reviewedDigest: digest})
 }
 if (input.reviewedDigest !== digest) fail('exact_rotation_review_required', 409)
 const token = Array.from(randomBytes(32), byte => byte.toString(16).padStart(2, '0')).join(''), id = randomUUID()
 // Copy accounting inside the same batch that retires the predecessor. A read
 // that reserved meanwhile invalidates the review; concurrent rotations lose.
 await transact(env.DB, actor, [
  ...guards.map(assertion),
  sql(`INSERT INTO bf_machine_credentials(id,owner_id,owner_version,token_hash,definition_json,digest,expires_at,max_operations,used_operations,created_at,predecessor_id)
   SELECT ?,owner_id,owner_version,?,definition_json,digest,expires_at,max_operations,used_operations,?,id FROM bf_machine_credentials WHERE id=?`, id, credentialHash(env, token), new Date().toISOString(), credential.id),
  sql('UPDATE bf_machine_credentials SET revoked=1 WHERE id=?', credential.id),
  machineAudit(credential.id, actor.id, 'human', 'rotated'),
  machineAudit(id, actor.id, 'human', 'issued-by-rotation'),
 ])
 return json({id, token, predecessorId: credential.id, scope: credential.scope, digest: credential.digest, usedOperations: credential.used_operations}, 201)
}
