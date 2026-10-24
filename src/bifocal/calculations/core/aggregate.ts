import { divide, plus, rational } from '../../currency/decimal'
import type { AggregateOp, CalculationValue } from './types'
import { compare, nil, number, numeric, valueKey } from './values'

export function aggregate(op: AggregateOp, input: CalculationValue[]): CalculationValue {
 const values = input.filter(value => value.type !== 'null')
 if (op === 'count') return numeric(rational(BigInt(values.length)))
 if (op === 'count-distinct') return numeric(rational(BigInt(new Set(values.map(valueKey)).size)))
 if (!values.length) return nil('empty_input')
 if (op === 'min' || op === 'max') return values.reduce((a, b) => compare(a, b) * (op === 'min' ? 1 : -1) <= 0 ? a : b)
 const sum = values.reduce((total, value) => plus(total, number(value)), rational(0n))
 return numeric(op === 'avg' ? divide(sum, rational(BigInt(values.length))) : sum)
}
