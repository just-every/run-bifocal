import { divide, plus, rational, times } from '../../currency/decimal'
import { addDays, date, dayNumber, monthDate } from '../../calendars/date'
import { reject, type BinaryOp, type CalculationValue, type FunctionName } from './types'
import { compare, nil, number, numeric, truth } from './values'

export function binary(op: BinaryOp, left: CalculationValue, right: CalculationValue): CalculationValue {
 if (op === 'and' || op === 'or') {
  const a = truth(left), b = truth(right)
  const value = op === 'and' ? (a === false || b === false ? false : a === null || b === null ? null : true) : (a === true || b === true ? true : a === null || b === null ? null : false)
  return value === null ? nil() : { type: 'boolean', value }
 }
 if (left.type === 'null') return left
 if (right.type === 'null') return right
 if (['=', '<>', '<', '<=', '>', '>='].includes(op)) {
  const c = compare(left, right)
  return { type: 'boolean', value: op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0 }
 }
 const a = number(left), b = number(right)
 if (op === '+') return numeric(plus(a, b))
 if (op === '-') return numeric(plus(a, rational(-b.numerator, b.denominator)))
 if (op === '*') return numeric(times(a, b))
 return b.numerator === 0n ? nil('zero_denominator') : numeric(divide(a, b))
}
function whole(value: CalculationValue): number {
 const n = number(value)
 if (n.denominator !== 1n || n.numerator < -100000n || n.numerator > 100000n) reject('bounded_integer_required')
 return Number(n.numerator)
}
export function scalarCall(fn: FunctionName, args: CalculationValue[]): CalculationValue {
 if (fn === 'is-null') return { type: 'boolean', value: args[0].type === 'null' }
 if (fn === 'coalesce') return args.find(value => value.type !== 'null') ?? nil()
 if (fn === 'if') return truth(args[0]) === true ? args[1] : args[2]
 const empty = args.find(value => value.type === 'null'); if (empty) return empty
 if (fn === 'abs') { const value = number(args[0]); return numeric(rational(value.numerator < 0n ? -value.numerator : value.numerator, value.denominator)) }
 const first = args[0]; if (first.type !== 'date') reject('date_value_required')
 if (fn === 'date-diff-days') { const second = args[1]; if (second.type !== 'date') reject('date_value_required'); return numeric(rational(BigInt(dayNumber(second.value) - dayNumber(first.value)))) }
 if (fn === 'year' || fn === 'month' || fn === 'day') return numeric(rational(BigInt(first.value.slice(fn === 'year' ? 0 : fn === 'month' ? 5 : 8, fn === 'year' ? 4 : fn === 'month' ? 7 : 10))))
 const amount = whole(args[1]); let shifted: string
 if (fn === 'date-add-days') shifted = addDays(first.value, amount)
 else {
  const year = Number(first.value.slice(0, 4)), month = Number(first.value.slice(5, 7)), day = Number(first.value.slice(8, 10))
  const index = year * 12 + month - 1 + amount * (fn === 'date-add-years' ? 12 : 1)
  shifted = monthDate(Math.floor(index / 12), ((index % 12) + 12) % 12 + 1, day)
 }
 return { type: 'date', value: date(shifted) }
}
