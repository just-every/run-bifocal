import type { Bindings } from '../../auth.server'
import { body, ConventionsError, identifier, integer, object } from '../company/protocol'
import { readVersion, saveVersion, versions, versionValue, type Authority } from '../company/store'
import { calendarDefinition, classifyDate, fiscalYear, type CalendarDefinition } from './fiscal'
import { workingDays } from './holidays'
export async function calendarRoute(request: Request, env: Bindings, owner: Authority, parts: string[]): Promise<unknown> {
 if (!parts.length) {
  if (request.method === 'GET') return { calendars: await versions(env, owner, 'bf_calendars') }
  if (request.method !== 'POST') throw new ConventionsError('method_not_allowed', 405)
  const input = object(await body(request), ['id', 'previousVersion', 'definition'])
  return saveVersion(env, owner, 'bf_calendars', identifier(input.id), input.previousVersion, calendarDefinition(input.definition))
 }
 if (parts.length === 1 && request.method === 'GET') return { versions: await versions(env, owner, 'bf_calendars', identifier(parts[0])) }
 const id = identifier(parts[0]), version = integer(Number(parts[1]), 'version', 1, 1000000000)
 const row = await readVersion(env, owner, 'bf_calendars', id, version), definition = JSON.parse(row.value_json) as CalendarDefinition
 if (parts.length === 2 && request.method === 'GET') return versionValue(row)
 if (parts.length === 4 && parts[2] === 'year' && request.method === 'GET') return { calendar: { id, version }, ...fiscalYear(definition, Number(parts[3])) }
 if (parts.length === 4 && parts[2] === 'date' && request.method === 'GET') return { calendar: { id, version }, ...classifyDate(definition, parts[3]) }
 if (parts.length === 3 && parts[2] === 'working-days' && request.method === 'POST') {
  const input = object(await body(request), ['start', 'end'])
  return { calendar: { id, version }, ...workingDays(input.start, input.end, { closed: definition.closed, open: definition.open }) }
 }
 throw new ConventionsError('not_found', 404)
}
