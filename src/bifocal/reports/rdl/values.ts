import { rounded } from '../../currency/decimal'
import type { CalculationValue } from '../../calculations/core'
import { fail } from '../../query/types'
export type ReportCell = {format?: string; type: 'text'|'number'|'boolean'|'date'; value: string|boolean|null; display: string; location: string}

/** A machine-readable decimal must be exact; formatting rounds only display. */
function decimal(numerator: bigint, denominator: bigint) {
 let rest = denominator, scale = 0
 while (rest % 2n === 0n) {rest /= 2n; scale++}
 let fives = 0
 while (rest % 5n === 0n) {rest /= 5n; fives++}
 scale = Math.max(scale, fives)
 if (rest !== 1n || scale > 12) fail('rdl_exact_decimal_export_unavailable')
 return rounded({numerator, denominator}, scale, 'half-even')
}
export function reportCell(value: CalculationValue, location: string, format = ''): ReportCell {
 if (value.type === 'null') return {type: 'text', value: null, display: '', location}
 if (value.type !== 'number') {
  if (format) fail('rdl_non_numeric_format_unsupported')
  return {type: value.type, value: value.value, display: String(value.value), location}
 }
 const rational = {numerator: BigInt(value.numerator), denominator: BigInt(value.denominator)}, raw = decimal(rational.numerator, rational.denominator)
 if (!format) return {type: 'number', value: raw, display: raw, location}
 const matched = /^([CFNP])([0-9])$/i.exec(format)
 if (!matched) fail('rdl_numeric_format_unsupported')
 const kind = matched[1].toUpperCase(), scale = Number(matched[2])
 const output = rounded(kind === 'P' ? {...rational, numerator: rational.numerator * 100n} : rational, scale, 'half-even')
 const [whole, fraction] = output.split('.'), grouped = kind === 'F' ? whole : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
 const decimals = raw.split('.')[1]?.length ?? 0, numeric = raw + (decimals < scale ? (decimals ? '' : '.') + '0'.repeat(scale - decimals) : '')
 const number = grouped + (fraction === undefined ? '' : '.' + fraction)
 return {type: 'number', value: numeric, format, display: (kind === 'C' ? '$' : '') + number + (kind === 'P' ? ' %' : ''), location}
}
