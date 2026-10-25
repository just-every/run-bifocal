import { canonicalJson, sha256 } from '../../modules/import-kit/src/provenance/identity.ts'
import { ownerIdentity } from '../data/snapshots/store'
import type { Bindings } from '../../auth.server'
import { resolveSchedule, scheduleDefinition, timeContext } from '../calendars/timezone'
import { body, ConventionsError, identifier, integer, object } from './protocol'
import { guarded, readVersion, saveVersion, versions, versionValue, type Authority } from './store'
export async function temporalRoute(request: Request, env: Bindings, owner: Authority, path: string): Promise<unknown> {
 if (path === '/api/operator/schedule-definitions/review' || path === '/api/operator/schedule-definitions/apply') {
  if (request.method !== 'POST') throw new ConventionsError('method_not_allowed', 405)
  const input = object(await body(request), ['document', 'previousVersion', 'reviewedDigest'])
  const document = object(input.document, ['version', 'id', 'definition'])
  if (document.version !== 1) throw new ConventionsError('schedule_document_required', 400)
  const id = identifier(document.id), definition = scheduleDefinition(document.definition)
  const current = (await versions(env, owner, 'bf_schedules', id))[0]?.version ?? null
  if (current !== input.previousVersion) throw new ConventionsError('stale_schedule_version', 409)
  const normalized = { version: 1, id, definition }, resolution = resolveSchedule(definition)
  const ownerId = await ownerIdentity(env, owner)
  const digest = sha256(canonicalJson({ ownerId, document: normalized, previousVersion: current, resolution }))
  if (path.endsWith('/review')) {
   await guarded(env, owner, [])
   return { document: normalized, previousVersion: current, digest, resolution, productionSends: 0, sourceWrites: 0, dispatcher: 'unavailable' }
  }
  if (input.reviewedDigest !== digest) throw new ConventionsError('exact_schedule_review_required', 409)
  return saveVersion(env, owner, 'bf_schedules', id, current, { ...definition, resolution, dispatcher: 'unavailable' })
 }
 if (path === '/api/operator/time/context' || path === '/api/operator/time/resolve') {
  if (request.method !== 'POST') throw new ConventionsError('method_not_allowed', 405)
  const input = await body(request)
  const result = path.endsWith('/context') ? timeContext(input) : (() => { const definition = scheduleDefinition(input); return { definition, resolution: resolveSchedule(definition), dispatcher: 'unavailable' } })()
  await guarded(env, owner, [])
  return result
 }
 if (path === '/api/operator/schedules') {
  if (request.method === 'GET') return { schedules: await versions(env, owner, 'bf_schedules'), dispatcher: 'unavailable' }
  if (request.method !== 'POST') throw new ConventionsError('method_not_allowed', 405)
  const input = object(await body(request), ['id', 'previousVersion', 'definition']), definition = scheduleDefinition(input.definition)
  const saved = { ...definition, resolution: resolveSchedule(definition), dispatcher: 'unavailable' }
  return saveVersion(env, owner, 'bf_schedules', identifier(input.id), input.previousVersion, saved)
 }
 const parts = path.slice('/api/operator/schedules/'.length).split('/')
 if (parts.length === 1 && request.method === 'GET') return { versions: await versions(env, owner, 'bf_schedules', identifier(parts[0])) }
 if (parts.length === 2 && request.method === 'GET') return versionValue(await readVersion(env, owner, 'bf_schedules', identifier(parts[0]), integer(Number(parts[1]), 'version', 1, 1000000000)))
 throw new ConventionsError('not_found', 404)
}
