import { integer, object, requireValue, text } from '../company/protocol'
import { addDays, date, dayNumber, monthDate, weekday, yearOf } from './date'
import { HOLIDAY_RULES } from './holidays'
export interface CalendarDefinition {
 name: string; kind: 'fiscal' | '445' | '454'; startMonth: number; startDay: number
 weekStartsOn: number; anchor: 'on-or-before' | 'nearest' | 'on-or-after'; extraWeekPeriod: number
 holidays: typeof HOLIDAY_RULES; closed: string[]; open: string[]
}
export function calendarDefinition(value: unknown): CalendarDefinition {
 const input = object(value, ['name', 'kind', 'startMonth', 'startDay', 'weekStartsOn', 'anchor', 'extraWeekPeriod', 'holidays', 'closed', 'open'])
 requireValue(['fiscal', '445', '454'].includes(String(input.kind)), 'invalid_calendar_kind')
 const startMonth = integer(input.startMonth, 'startMonth', 1, 12), startDay = integer(input.startDay ?? 1, 'startDay', 1, 31)
 requireValue(startDay <= Number(monthDate(2000, startMonth, 31).slice(8)), 'invalid_fiscal_start')
 const anchor = input.anchor ?? 'on-or-before'
 requireValue(['on-or-before', 'nearest', 'on-or-after'].includes(String(anchor)), 'invalid_retail_anchor')
 requireValue(input.holidays === undefined || input.holidays === HOLIDAY_RULES, 'invalid_holiday_rules')
 const adjustment = (name: 'closed' | 'open') => { const values = input[name] ?? []; requireValue(Array.isArray(values) && values.length <= 1000, 'invalid_holiday_adjustments'); return [...new Set(values.map(date))].sort() }
 const closed = adjustment('closed'), open = adjustment('open')
 requireValue(!open.some(day => closed.includes(day)), 'conflicting_working_day_adjustment')
 return { name: text(input.name, 'name'), kind: input.kind as CalendarDefinition['kind'], startMonth, startDay,
  weekStartsOn: integer(input.weekStartsOn ?? 0, 'weekStartsOn', 0, 6), anchor: anchor as CalendarDefinition['anchor'], extraWeekPeriod: integer(input.extraWeekPeriod ?? 12, 'extraWeekPeriod', 1, 12), holidays: HOLIDAY_RULES, closed, open }
}
export function yearStart(definition: CalendarDefinition, year: number): string {
 const nominal = monthDate(year, definition.startMonth, definition.startDay)
 if (definition.kind === 'fiscal') return nominal
 const before = (weekday(nominal) - definition.weekStartsOn + 7) % 7
 return addDays(nominal, definition.anchor === 'on-or-before' ? -before : definition.anchor === 'on-or-after' ? (7 - before) % 7 : before <= 3 ? -before : 7 - before)
}
/** Fiscal years are labeled by start-year, periods are half-open and clamp
 * month-end starts. Annual retail anchors determine a real 52/53-week year. */
export function fiscalYear(definition: CalendarDefinition, year: number) {
 integer(year, 'year', 1972, 9997)
 const start = yearStart(definition, year), end = yearStart(definition, year + 1), length = dayNumber(end) - dayNumber(start)
 const weeks = definition.kind === 'fiscal' ? null : length / 7
 requireValue(weeks === null || weeks === 52 || weeks === 53, 'invalid_retail_year')
 let cursor = start
 const pattern = definition.kind === '454' ? [4, 5, 4] : [4, 4, 5]
 const periods = Array.from({ length: 12 }, (_, index) => {
  const periodStart = cursor
  if (definition.kind === 'fiscal') {
   const absoluteMonth = definition.startMonth - 1 + index + 1
   cursor = monthDate(year + Math.floor(absoluteMonth / 12), absoluteMonth % 12 + 1, definition.startDay)
  } else cursor = addDays(cursor, 7 * (pattern[index % 3] + (weeks === 53 && definition.extraWeekPeriod === index + 1 ? 1 : 0)))
  return { period: index + 1, quarter: Math.floor(index / 3) + 1, start: periodStart, end: cursor, days: dayNumber(cursor) - dayNumber(periodStart) }
 })
 return { year, label: `FY${year}`, start, end, days: length, weeks, extraWeekPeriod: weeks === 53 ? definition.extraWeekPeriod : null, periods }
}
export function classifyDate(definition: CalendarDefinition, input: unknown) {
 const civil = date(input), year = yearOf(civil)
 const label = civil < yearStart(definition, year) ? year - 1 : year
 const fiscal = fiscalYear(definition, label)
 const period = fiscal.periods.find(period => civil >= period.start && civil < period.end)
 requireValue(period, 'date_outside_calendar')
 return { date: civil, fiscalYear: label, period: period.period, quarter: period.quarter, week: definition.kind === 'fiscal' ? null : Math.floor((dayNumber(civil) - dayNumber(fiscal.start)) / 7) + 1 }
}

export const FISCAL_WINDOWS = ['period-to-date', 'quarter-to-date', 'year-to-date', 'previous-period', 'previous-quarter', 'previous-year'] as const
export type FiscalWindow = typeof FISCAL_WINDOWS[number]
/** Explicit civil cutoff and immutable calendar revision determine every bound.
 * Complete prior periods use the calendar's half-open intervals, including the
 * extra retail week; they never subtract an assumed number of days or months. */
export function fiscalWindow(definition: CalendarDefinition, asOf: string, window: FiscalWindow) {
 const position = classifyDate(definition, asOf), year = fiscalYear(definition, position.fiscalYear)
 const period = year.periods[position.period - 1]
 if (window === 'period-to-date') return { start: period.start, end: addDays(asOf, 1) }
 if (window === 'quarter-to-date') return { start: year.periods[(position.quarter - 1) * 3].start, end: addDays(asOf, 1) }
 if (window === 'year-to-date') return { start: year.start, end: addDays(asOf, 1) }
 if (window === 'previous-period') {
  const prior = position.period === 1 ? fiscalYear(definition, position.fiscalYear - 1).periods[11] : year.periods[position.period - 2]
  return { start: prior.start, end: prior.end }
 }
 if (window === 'previous-quarter') {
  const priorYear = position.quarter === 1 ? fiscalYear(definition, position.fiscalYear - 1) : year
  const index = position.quarter === 1 ? 9 : (position.quarter - 2) * 3
  return { start: priorYear.periods[index].start, end: priorYear.periods[index + 2].end }
 }
 if (window === 'previous-year') {
  const prior = fiscalYear(definition, position.fiscalYear - 1)
  return { start: prior.start, end: prior.end }
 }
 requireValue(false, 'invalid_fiscal_window')
}
