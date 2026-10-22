import { date, dayNumber } from '../calendars/date'
import { clock, timeContext, timezone } from '../calendars/timezone'
import { integer, object, requireValue, text } from '../company/protocol'
import { decimal, divide, exact, plus, rational, rounded, times, type Rational, type RoundingMode } from './decimal'
import { currency, type RateSource } from './rates'
interface RatePolicy { date: 'transaction-date' | 'fixed'; fixedDate?: string; lookup: 'exact' | 'latest-on-or-before'; maxAgeDays: number }
function ratePolicy(value: unknown): RatePolicy {
 const input = object(value, ['date', 'fixedDate', 'lookup', 'maxAgeDays'])
 requireValue(['transaction-date', 'fixed'].includes(String(input.date)), 'rate_date_policy_required')
 requireValue(['exact', 'latest-on-or-before'].includes(String(input.lookup)), 'rate_lookup_policy_required')
 requireValue(input.date === 'fixed' || input.fixedDate === undefined, 'unexpected_fixed_rate_date')
 const fixedDate = input.date === 'fixed' ? date(input.fixedDate) : undefined
 const maxAgeDays = input.lookup === 'latest-on-or-before' ? integer(input.maxAgeDays, 'maxAgeDays', 0, 3660) : 0
 requireValue(input.lookup !== 'exact' || input.maxAgeDays === undefined || input.maxAgeDays === 0, 'unexpected_rate_max_age')
 return { date: input.date as RatePolicy['date'], ...(fixedDate ? { fixedDate } : {}), lookup: input.lookup as RatePolicy['lookup'], maxAgeDays }
}
function quote(source: RateSource, code: string, rateDate: string, policy: RatePolicy) {
 if (code === source.baseCurrency) return { rate: '1', date: rateDate, currency: code, implicitBase: true }
 const candidates = source.rates.filter(rate => rate.currency === code && (policy.lookup === 'exact' ? rate.date === rateDate : rate.date <= rateDate)).sort((a, b) => b.date.localeCompare(a.date))
 const result = candidates[0]
 requireValue(result && dayNumber(rateDate) - dayNumber(result.date) <= policy.maxAgeDays, 'rate_unavailable', { currency: code, requestedDate: rateDate, policy })
 return { ...result, implicitBase: false }
}
/** Exact rational cross-rates, never binary float amounts. A conversion is a
 * calculation receipt, not a published report. Only converted values may sum. */
export function convertCurrency(source: RateSource, value: unknown) {
 const input = object(value, ['targetCurrency', 'policy', 'rounding', 'transactions', 'timezone', 'reportCutoff'])
 const target = currency(input.targetCurrency), policy = ratePolicy(input.policy), zone = timezone(input.timezone), cutoff = clock(input.reportCutoff, 'reportCutoff')
 const rounding = object(input.rounding, ['scale', 'mode', 'stage']), scale = integer(rounding.scale, 'rounding.scale', 0, 8)
 requireValue(['half-even', 'half-away-from-zero', 'toward-zero'].includes(String(rounding.mode)), 'rounding_mode_required')
 requireValue(['per-line', 'total'].includes(String(rounding.stage)), 'rounding_stage_required')
 const mode = rounding.mode as RoundingMode
 requireValue(Array.isArray(input.transactions) && input.transactions.length > 0 && input.transactions.length <= 1000, 'invalid_transactions', { min: 1, max: 1000 })
 const ids = new Set<string>(), originals = new Map<string, Rational>()
 let exactTotal = rational(0n), lineTotal = rational(0n)
 const transactions = input.transactions.map(value => {
  const row = object(value, ['id', 'amount', 'currency', 'date', 'sourceInstant'])
  const id = text(row.id, 'transaction.id'), code = currency(row.currency), transactionDate = date(row.date), amount = decimal(row.amount)
  requireValue(!ids.has(id), 'duplicate_transaction_id'); ids.add(id)
  const rateDate = policy.fixedDate ?? transactionDate
  const originalQuote = code === target ? null : quote(source, code, rateDate, policy), targetQuote = code === target ? null : quote(source, target, rateDate, policy)
  const factor = originalQuote && targetQuote ? divide(decimal(targetQuote.rate), decimal(originalQuote.rate)) : rational(1n)
  const converted = times(amount, factor), roundedAmount = rounded(converted, scale, mode)
  exactTotal = plus(exactTotal, converted); lineTotal = plus(lineTotal, rational(BigInt(roundedAmount.replace('.', '')), 10n ** BigInt(scale)))
  originals.set(code, plus(originals.get(code) ?? rational(0n), amount))
  return { id, original: { amount: row.amount as string, currency: code, date: transactionDate, ...(row.sourceInstant === undefined ? {} : { time: timeContext({ sourceInstant: row.sourceInstant, timezone: zone, reportCutoff: cutoff }) }) },
   rateDate, rate: { original: originalQuote, target: targetQuote, exactFactor: exact(factor), identity: code === target }, converted: { currency: target, exact: exact(converted), rounded: roundedAmount } }
 })
 return { targetCurrency: target, source: { name: source.name, kind: source.kind, license: source.license, baseCurrency: source.baseCurrency }, policy,
  rounding: { scale, mode, stage: rounding.stage }, timezone: zone, reportCutoff: cutoff, transactions,
  originalTotals: [...originals].sort(([left], [right]) => left.localeCompare(right)).map(([currency, amount]) => ({ currency, exact: exact(amount) })),
  total: { currency: target, exact: exact(exactTotal), amount: rounded(rounding.stage === 'per-line' ? lineTotal : exactTotal, scale, mode) } }
}
