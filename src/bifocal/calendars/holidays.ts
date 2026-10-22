import { addDays, date, dayNumber, monthDate, weekday, yearOf } from './date'
import { integer, requireValue } from '../company/protocol'
export const HOLIDAY_RULES = 'us-federal-1971-v1'
export interface Holiday { name: string; actual: string; observed: string }
const nth = (year: number, month: number, day: number, n: number) => {
 const first = monthDate(year, month, 1)
 return addDays(first, (day - weekday(first) + 7) % 7 + (n - 1) * 7)
}
const observed = (actual: string) => addDays(actual, weekday(actual) === 6 ? -1 : weekday(actual) === 0 ? 1 : 0)
/** Statutory nationwide Monday-Friday schedule. Local inauguration and one-off
 * executive closures are explicit additions, never silently guessed. */
export function holidays(year: number): Holiday[] {
 integer(year, 'year', 1971, 9998)
 const list: Holiday[] = []
 const fixed = (name: string, month: number, day: number) => { const actual = monthDate(year, month, day); list.push({ name, actual, observed: observed(actual) }) }
 const monday = (name: string, month: number, n: number) => { const actual = nth(year, month, 1, n); list.push({ name, actual, observed: actual }) }
 fixed("New Year's Day", 1, 1)
 if (year >= 1986) monday('Birthday of Martin Luther King, Jr.', 1, 3)
 monday("Washington's Birthday", 2, 3)
 const may31 = monthDate(year, 5, 31), memorial = addDays(may31, -((weekday(may31) + 6) % 7))
 list.push({ name: 'Memorial Day', actual: memorial, observed: memorial })
 if (year >= 2021) fixed('Juneteenth National Independence Day', 6, 19)
 fixed('Independence Day', 7, 4); monday('Labor Day', 9, 1); monday('Columbus Day', 10, 2)
 if (year >= 1971 && year <= 1977) monday('Veterans Day', 10, 4)
 else fixed('Veterans Day', 11, 11)
 const thanksgiving = nth(year, 11, 4, 4)
 list.push({ name: 'Thanksgiving Day', actual: thanksgiving, observed: thanksgiving }); fixed('Christmas Day', 12, 25)
 return list.sort((a, b) => a.observed.localeCompare(b.observed))
}
export function workingDays(startInput: unknown, endInput: unknown, adjustments: { closed?: string[]; open?: string[] } = {}) {
 const start = date(startInput), end = date(endInput)
 requireValue(start <= end && dayNumber(end) - dayNumber(start) <= 3660, 'invalid_working_day_range', { maxDays: 3660, interval: '[start,end)' })
 const closed = new Set((adjustments.closed ?? []).map(date)), open = new Set((adjustments.open ?? []).map(date))
 requireValue(![...open].some(day => closed.has(day)), 'conflicting_working_day_adjustment')
 const excluded = new Map<string, string>()
 for (let year = Math.max(1971, yearOf(start) - 1); year <= Math.min(9998, yearOf(end) + 1); year++) {
  for (const holiday of holidays(year)) excluded.set(holiday.observed, holiday.name)
 }
 const days: { date: string; working: boolean; reason: string }[] = []
 for (let day = start; day < end; day = addDays(day, 1)) {
  const weekend = [0, 6].includes(weekday(day)), holiday = excluded.get(day)
  const reason = open.has(day) ? 'owner-open' : closed.has(day) ? 'owner-closed' : holiday ?? (weekend ? 'weekend' : 'weekday')
  days.push({ date: day, working: open.has(day) || (!closed.has(day) && !holiday && !weekend), reason })
 }
 return { start, end, interval: '[start,end)', rules: HOLIDAY_RULES, workingDays: days.filter(day => day.working).length, days }
}
