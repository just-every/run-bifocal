import { requireValue } from '../company/protocol'
export const DAY = 86400000
/** ISO civil dates; UTC is used only as an integer day axis, never a display zone. */
export function date(value: unknown): string {
 requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'invalid_date')
 const time = Date.parse(value + 'T00:00:00Z')
 requireValue(Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value && Number(value.slice(0, 4)) >= 1971 && Number(value.slice(0, 4)) <= 9998, 'invalid_date', { range: '1971-01-01 through 9998-12-31' })
 return value
}
export const dayNumber = (value: string) => Date.parse(value + 'T00:00:00Z') / DAY
export const fromDay = (value: number) => new Date(value * DAY).toISOString().slice(0, 10)
export const addDays = (value: string, days: number) => fromDay(dayNumber(value) + days)
export const weekday = (value: string) => new Date(value + 'T00:00:00Z').getUTCDay()
export const yearOf = (value: string) => Number(value.slice(0, 4))
export function monthDate(year: number, month: number, day: number): string {
 const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
 return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${Math.min(day, last).toString().padStart(2, '0')}`
}
