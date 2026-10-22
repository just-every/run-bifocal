import { date } from '../calendars/date'
import { object, requireValue, text } from '../company/protocol'
import { decimal } from './decimal'
export function currency(value: unknown): string {
 requireValue(typeof value === 'string' && /^[A-Z]{3}$/.test(value) && Intl.supportedValuesOf('currency').includes(value), 'invalid_currency')
 return value
}
export interface ImportedRate { currency: string; date: string; rate: string }
export interface RateSource { name: string; kind: 'owner-imported'; license: string; baseCurrency: string; rates: ImportedRate[] }
export function rateSource(value: unknown): RateSource {
 const input = object(value, ['name', 'kind', 'license', 'baseCurrency', 'rates'])
 requireValue(input.kind === 'owner-imported', 'owner_imported_rate_source_required')
 const baseCurrency = currency(input.baseCurrency)
 requireValue(Array.isArray(input.rates) && input.rates.length > 0 && input.rates.length <= 1000, 'invalid_rates', { min: 1, max: 1000 })
 const keys = new Set<string>()
 const rates = input.rates.map(value => {
  const row = object(value, ['currency', 'date', 'rate']), code = currency(row.currency), rateDate = date(row.date), amount = decimal(row.rate), key = `${code}:${rateDate}`
  requireValue(code !== baseCurrency && amount.numerator > 0n && !keys.has(key), 'invalid_or_duplicate_rate')
  keys.add(key)
  return { currency: code, date: rateDate, rate: row.rate as string }
 }).sort((a, b) => a.currency.localeCompare(b.currency) || a.date.localeCompare(b.date))
 return { name: text(input.name, 'name'), kind: 'owner-imported', license: text(input.license, 'license', 1000), baseCurrency, rates }
}
