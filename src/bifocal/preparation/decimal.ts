import { rational, type Rational } from '../currency/decimal'
import { fail } from '../query/types'

const maxIntegerDigits = 80
const maxScale = 48

// Preparation results must remain valid inputs to every subsequent step.
export function preparationDecimal(value: unknown): Rational {
 if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) fail('preparation_type_conversion_failed')
 const [whole, fraction = ''] = value.split('.')
 if (whole.replace('-', '').length > maxIntegerDigits || fraction.length > maxScale) fail('preparation_decimal_limit')
 return rational(BigInt(whole + fraction), 10n ** BigInt(fraction.length))
}

export function exactDecimal(value: Rational): string {
 let denominator = value.denominator, twos = 0, fives = 0
 while (denominator % 2n === 0n && twos <= maxScale) { denominator /= 2n; twos++ }
 while (denominator % 5n === 0n && fives <= maxScale) { denominator /= 5n; fives++ }
 // A reduced terminating denominator is 2^a * 5^b; its scale is max(a, b).
 const scale = Math.max(twos, fives)
 if (scale > maxScale) fail('preparation_decimal_limit')
 if (denominator !== 1n) fail('non_decimal_preparation_value')
 const units = value.numerator * 10n ** BigInt(scale) / value.denominator
 const negative = units < 0n, digits = (negative ? -units : units).toString().padStart(scale + 1, '0')
 if (digits.length - scale > maxIntegerDigits) fail('preparation_decimal_limit')
 const fraction = scale ? digits.slice(-scale).replace(/0+$/, '') : ''
 return (negative ? '-' : '') + (scale ? digits.slice(0, -scale) : digits) + (fraction ? '.' + fraction : '')
}
