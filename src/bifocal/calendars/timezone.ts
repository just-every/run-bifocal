import { object, requireValue, text } from '../company/protocol'
import { addDays, date } from './date'
export function timezone(value: unknown): string {
 const input = text(value, 'timezone', 100)
 requireValue(input === 'UTC' || input.includes('/'), 'iana_timezone_required')
 try { return new Intl.DateTimeFormat('en-US', { timeZone: input }).resolvedOptions().timeZone }
 catch { requireValue(false, 'invalid_timezone') }
}
export function clock(value: unknown, field = 'time'): string {
 requireValue(typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value), 'invalid_clock', { field, format: 'HH:mm' })
 return value
}
function formatter(zone: string) {
 return new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
}
function localParts(format: Intl.DateTimeFormat, instant: number) {
 const fields = Object.fromEntries(format.formatToParts(instant).map(part => [part.type, part.value]))
 const civil = `${fields.year.padStart(4, '0')}-${fields.month}-${fields.day}`
 return { date: civil, time: `${fields.hour}:${fields.minute}:${fields.second}`, stamp: Date.parse(`${civil}T${fields.hour}:${fields.minute}:${fields.second}Z`) }
}
function offsetLabel(seconds: number) {
 const absolute = Math.abs(seconds), hh = Math.floor(absolute / 3600).toString().padStart(2, '0'), mm = Math.floor(absolute % 3600 / 60).toString().padStart(2, '0')
 const ss = absolute % 60
 return `${seconds < 0 ? '-' : '+'}${hh}:${mm}${ss ? ':' + ss.toString().padStart(2, '0') : ''}`
}
export function instantDetails(instant: number, zone: string, cutoff: string) {
 const parts = localParts(formatter(zone), instant), offsetSeconds = (parts.stamp - Math.floor(instant / 1000) * 1000) / 1000
 return { instant: new Date(instant).toISOString(), timezone: zone, offset: offsetLabel(offsetSeconds), offsetSeconds, localDate: parts.date, localTime: parts.time, reportCutoff: cutoff,
  reportDate: parts.time.slice(0, 5) < cutoff ? addDays(parts.date, -1) : parts.date }
}
/** Parse an explicit-offset source timestamp without Date.parse's rollover of
 * impossible civil dates. Source bytes and numeric offset survive normalization. */
export function sourceInstant(value: unknown) {
 requireValue(typeof value === 'string', 'explicit_offset_instant_required')
 const match = /^(\d{4}-\d{2}-\d{2})T([0-2]\d:[0-5]\d:[0-5]\d)(\.\d{1,3})?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value)
 requireValue(match, 'explicit_offset_instant_required')
 date(match[1]); requireValue(Number(match[2].slice(0, 2)) < 24, 'invalid_instant')
 const milliseconds = Date.parse(value)
 requireValue(Number.isFinite(milliseconds), 'invalid_instant')
 return { sourceInstant: value, sourceOffset: match[4] === 'Z' ? '+00:00' : match[4], milliseconds }
}
export function timeContext(value: unknown) {
 const input = object(value, ['sourceInstant', 'timezone', 'reportCutoff'])
 const original = sourceInstant(input.sourceInstant), zone = timezone(input.timezone), cutoff = clock(input.reportCutoff, 'reportCutoff')
 return { sourceInstant: original.sourceInstant, sourceOffset: original.sourceOffset, ...instantDetails(original.milliseconds, zone, cutoff) }
}
export interface ScheduleDefinition {
 name: string; localDate: string; time: string; timezone: string; skipped: 'skip' | 'shift-forward' | 'reject'; repeated: 'earlier' | 'later' | 'both' | 'reject'; reportCutoff: string
}
export function scheduleDefinition(value: unknown): ScheduleDefinition {
 const input = object(value, ['name', 'localDate', 'time', 'timezone', 'skipped', 'repeated', 'reportCutoff'])
 requireValue(['skip', 'shift-forward', 'reject'].includes(String(input.skipped)), 'dst_skipped_policy_required')
 requireValue(['earlier', 'later', 'both', 'reject'].includes(String(input.repeated)), 'dst_repeated_policy_required')
 return { name: text(input.name, 'name'), localDate: date(input.localDate), time: clock(input.time), timezone: timezone(input.timezone), skipped: input.skipped as ScheduleDefinition['skipped'], repeated: input.repeated as ScheduleDefinition['repeated'], reportCutoff: clock(input.reportCutoff, 'reportCutoff') }
}
/** Derive possible instants from actual IANA offsets around this civil time.
 * Comparison roundtrips through Intl, so gaps never silently normalize and folds
 * retain both instants. Shift-forward preserves minutes by the actual gap size. */
export function resolveSchedule(definition: ScheduleDefinition) {
 const nominal = Date.parse(`${definition.localDate}T${definition.time}:00Z`), format = formatter(definition.timezone), offsets = new Set<number>()
 for (let hours = -72; hours <= 72; hours += 6) {
  const probe = nominal + hours * 3600000
  offsets.add(localParts(format, probe).stamp - probe)
 }
 const possibilities = [...offsets].map(offset => nominal - offset).filter(instant => localParts(format, instant).stamp === nominal).sort((a, b) => a - b)
 const context = (instant: number) => instantDetails(instant, definition.timezone, definition.reportCutoff)
 if (possibilities.length === 0) {
  requireValue(definition.skipped !== 'reject', 'dst_skipped_local_time', { localDate: definition.localDate, time: definition.time, timezone: definition.timezone })
  if (definition.skipped === 'skip') return { status: 'skipped' as const, instants: [], shiftSeconds: 0 }
  const shifted = [...offsets].map(offset => nominal - offset).map(instant => ({ instant, delta: localParts(format, instant).stamp - nominal })).filter(item => item.delta > 0).sort((a, b) => a.delta - b.delta)[0]
  requireValue(shifted, 'timezone_gap_unresolved')
  return { status: 'shifted' as const, instants: [context(shifted.instant)], shiftSeconds: shifted.delta / 1000 }
 }
 if (possibilities.length > 1) {
  requireValue(definition.repeated !== 'reject', 'dst_repeated_local_time', { candidates: possibilities.map(context) })
  const chosen = definition.repeated === 'both' ? possibilities : [possibilities[definition.repeated === 'earlier' ? 0 : possibilities.length - 1]]
  return { status: 'repeated' as const, instants: chosen.map(context), shiftSeconds: 0 }
 }
 return { status: 'unique' as const, instants: possibilities.map(context), shiftSeconds: 0 }
}
