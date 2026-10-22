import { integer, requireValue } from '../company/protocol'
export interface Rational { numerator: bigint; denominator: bigint }
export type RoundingMode = 'half-even' | 'half-away-from-zero' | 'toward-zero'
const absolute = (value: bigint) => value < 0n ? -value : value
function gcd(left: bigint, right: bigint): bigint { while (right) { const next = left % right; left = right; right = next }; return left }
export function rational(numerator: bigint, denominator = 1n): Rational {
 requireValue(denominator !== 0n, 'zero_denominator')
 if (denominator < 0n) { numerator = -numerator; denominator = -denominator }
 const divisor = gcd(absolute(numerator), denominator)
 return { numerator: numerator / divisor, denominator: denominator / divisor }
}
export function decimal(value: unknown): Rational {
 requireValue(typeof value === 'string' && /^-?(?:0|[1-9]\d{0,79})(?:\.\d{1,24})?$/.test(value), 'exact_decimal_string_required', { maxIntegerDigits: 80, maxScale: 24 })
 const [whole, fraction = ''] = value.split('.')
 return rational(BigInt(whole + fraction), 10n ** BigInt(fraction.length))
}
export const plus = (left: Rational, right: Rational) => rational(left.numerator * right.denominator + right.numerator * left.denominator, left.denominator * right.denominator)
export const times = (left: Rational, right: Rational) => rational(left.numerator * right.numerator, left.denominator * right.denominator)
export const divide = (left: Rational, right: Rational) => rational(left.numerator * right.denominator, left.denominator * right.numerator)
export const exact = (value: Rational) => ({ numerator: value.numerator.toString(), denominator: value.denominator.toString() })
export function rounded(value: Rational, scale: number, mode: RoundingMode): string {
 integer(scale, 'rounding.scale', 0, 12)
 requireValue(['half-even', 'half-away-from-zero', 'toward-zero'].includes(mode), 'invalid_rounding_mode')
 const factor = 10n ** BigInt(scale), scaled = absolute(value.numerator) * factor
 let units = scaled / value.denominator
 const remainder = scaled % value.denominator, tie = remainder * 2n === value.denominator
 if (mode !== 'toward-zero' && (remainder * 2n > value.denominator || (tie && (mode === 'half-away-from-zero' || units % 2n === 1n)))) units++
 const digits = units.toString().padStart(scale + 1, '0'), signed = value.numerator < 0n && units !== 0n ? '-' : ''
 return signed + (scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits)
}
