import { date } from '../../calendars/date'
import type { CalculationExpr, CalculationFilter } from '../../calculations/core'
import { arity, blank, call, num, requireField, text } from './helpers'
import { problem, type Syntax, type TranslationOptions } from './types'

export function calculate(args: Syntax[], options: TranslationOptions, compile: (node: Syntax) => CalculationExpr): CalculationExpr {
 arity('CALCULATE', args, 1, 33)
 const removeFilters: string[] = [], filters: CalculationFilter[] = []
 for (const modifier of args.slice(1)) {
  if (modifier.kind === 'call' && ['ALL', 'REMOVEFILTERS'].includes(modifier.name)) {
   arity(modifier.name, modifier.args, 1, 32)
   for (const field of modifier.args) removeFilters.push(requireField(field, options))
   continue
  }
  if (modifier.kind !== 'binary' || !['=', '=='].includes(modifier.op)) problem('calculate_filter_gap', 'CALCULATE supports mapped-column equality and ALL or REMOVEFILTERS of explicitly mapped columns; other filter constructs need implementation.')
  const field = requireField(modifier.left, options), value = compile(modifier.right)
  if (value.kind !== 'literal') problem('calculate_literal_filter', 'This CALCULATE equality needs a constant typed literal, not a row expression or measure.')
  if (value.type === 'text') problem('source_text_collation', 'CALCULATE text equality needs source-compatible collation; the binary native filter must not silently replace it.')
  if (modifier.op === '=' && (value.type === 'null' || value.type === 'number' && value.value === '0' || value.type === 'boolean' && value.value === false)) problem('calculate_blank_equality', 'DAX loose equality also selects BLANK for zero/empty/false. Use strict == or implement an explicit union filter.')
  if (value.type === 'null') filters.push({ field, op: 'is-null' })
  else filters.push({ field, op: 'eq', value: value.value })
 }
 const duplicates = filters.map(filter => filter.field)
 if (new Set(duplicates).size !== duplicates.length) problem('calculate_repeated_column_filters', 'Multiple filter arguments for one column need source intersection semantics before translation.')
 return { kind: 'calculate', expression: compile(args[0]), removeFilters: [...new Set(removeFilters)], filters }
}
export function fiscalFunction(name: string, args: Syntax[], options: TranslationOptions, compile: (node: Syntax) => CalculationExpr): CalculationExpr {
 arity(name, args, 2)
 const frozen = options.fiscal
 if (!frozen) problem('fiscal_calendar_binding', 'Supply frozen BIF-036 start and end civil dates and dateColumn for this fiscal period; calendar quarters are not inferred.')
 const expected = name === 'TOTALYTD' ? 'year' : 'quarter'
 if (frozen.period !== undefined && frozen.period !== expected) problem('fiscal_period_binding', `The frozen BIF-036 bounds must represent the requested fiscal ${expected}.`)
 const field = requireField(args[1], options)
 if (field !== frozen.dateColumn) problem('fiscal_date_column_mismatch', 'Bind the source date column to the same frozen native fiscal date column.')
 try { date(frozen.from); date(frozen.to) } catch { problem('invalid_fiscal_bounds', 'Frozen fiscal bounds must be supported ISO civil dates.') }
 if (frozen.from > frozen.to) problem('invalid_fiscal_bounds', 'The fiscal start must be on or before its inclusive end.')
 return { kind: 'calculate', expression: compile(args[0]), removeFilters: [field], filters: [{ field, op: 'gte', value: frozen.from }, { field, op: 'lte', value: frozen.to }] }
}
export function dateFunction(name: string, args: Syntax[], compile: (node: Syntax) => CalculationExpr): CalculationExpr | undefined {
 if (name === 'DATEADD') {
  arity(name, args, 3); const unit = text(args[0]).toLowerCase()
  if (!['day', 'month', 'year'].includes(unit)) problem('date_part_gap', 'DATEADD supports explicit civil day/month/year units; fiscal weeks and other date parts need native calendar mapping.')
  return { kind: 'call', fn: unit === 'day' ? 'date-add-days' : unit === 'month' ? 'date-add-months' : 'date-add-years', args: [compile(args[2]), compile(args[1])] }
 }
 if (name === 'DATEDIFF') {
  arity(name, args, 3); if (text(args[0]).toLowerCase() !== 'day') problem('date_diff_boundary_gap', 'Only civil day differences are translated; other source date-part boundary counts need implementation.')
  return { kind: 'call', fn: 'date-diff-days', args: [compile(args[1]), compile(args[2])] }
 }
 if (name === 'ZN') { arity(name, args, 1); return call('coalesce', compile(args[0]), num('0')) }
 if (name === 'ISNULL') { arity(name, args, 1); return call('is-null', compile(args[0])) }
 if (name === 'IFNULL') { arity(name, args, 2); return call('coalesce', compile(args[0]), compile(args[1])) }
 if (name === 'IIF') { arity(name, args, 3, 4); const condition = compile(args[0]); return call('if', call('is-null', condition), args[3] ? compile(args[3]) : blank(), call('if', condition, compile(args[1]), compile(args[2]))) }
 return undefined
}
