import type { Bindings } from '../../auth.server'
import { resolveSchedule, scheduleDefinition, timeContext } from '../calendars/timezone'
import { body, ConventionsError, identifier, integer, object } from './protocol'
import { guarded, readVersion, saveVersion, versions, versionValue, type Authority } from './store'
export async function temporalRoute(request: Request, env: Bindings, owner: Authority, path: string): Promise<unknown> {
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
