import { decimal, exact, rational, type Rational } from '../../currency/decimal'
import { date } from '../../calendars/date'
import { reject, type CalculationValue, type DataType, type InputCell } from './types'

export const nil = (reason?: Extract<CalculationValue, { type: 'null' }>['reason']): CalculationValue => ({ type: 'null', ...(reason ? { reason } : {}) })
export const numeric = (value: Rational): CalculationValue => ({ type: 'number', ...exact(value) })
export function number(value: CalculationValue): Rational {
 if (value.type !== 'number') reject('numeric_value_required')
 return rational(BigInt(value.numerator), BigInt(value.denominator))
}
export function cell(value: InputCell, type: DataType): CalculationValue {
 if (value === null) return nil()
 if (type === 'boolean') { if (typeof value !== 'boolean') reject('boolean_value_required'); return { type, value } }
 if(type==='number'&&typeof value==='object'&&value.type==='number'){if(!/^-?\d{1,256}$/.test(value.numerator)||!/^\d{1,256}$/.test(value.denominator)||BigInt(value.denominator)===0n)reject('invalid_exact_field');return numeric(rational(BigInt(value.numerator),BigInt(value.denominator)))}
 if (typeof value !== 'string') reject('string_value_required')
 if (type === 'number') return numeric(decimal(value))
 if (type === 'date') return { type, value: date(value) }
 return { type, value }
}
export function compare(left: CalculationValue, right: CalculationValue): number {
 if (left.type === 'null' || right.type === 'null') reject('nonnull_comparison_required')
 if (left.type !== right.type) reject('comparison_type_mismatch')
 if (left.type === 'number') {
  const a = number(left), b = number(right), difference = a.numerator * b.denominator - b.numerator * a.denominator
  return difference < 0n ? -1 : difference > 0n ? 1 : 0
 }
 if (left.type === 'boolean') { const b = (right as Extract<CalculationValue, { type: 'boolean' }>).value; return left.value === b ? 0 : left.value ? 1 : -1 }
 const a = left.value, b = (right as Extract<CalculationValue, { type: 'text' | 'date' }>).value
 return a === b ? 0 : a < b ? -1 : 1
}
export function valueKey(value: CalculationValue): string {
 return value.type === 'number' ? JSON.stringify(['number', value.numerator, value.denominator]) : value.type === 'null' ? '["null"]' : JSON.stringify([value.type, value.value])
}
export function truth(value: CalculationValue): boolean | null {
 if (value.type === 'null') return null
 if (value.type !== 'boolean') reject('boolean_value_required')
 return value.value
}
