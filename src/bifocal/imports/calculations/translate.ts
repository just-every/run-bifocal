import { date } from '../../calendars/date'
import type { CalculationExpr } from '../../calculations/core'
import { aggregateFunction } from './aggregates'
import { boundExpression } from './bounds'
import { calculate, dateFunction, fiscalFunction } from './context'
import { arity, binary, blank, bool, call, integer, num, requireField, resolve } from './helpers'
import { operator } from './operators'
import { parseFormula } from './parse'
import { FormulaProblem, problem, type FormulaLanguage, type Syntax, type TranslationOptions, type TranslationResult } from './types'
import { tableCalculation } from './windows'

export function translateFormula(language: FormulaLanguage, source: string, options: TranslationOptions): TranslationResult {
 const result: TranslationResult = { sourceExpression: source, targetExpression: null, issues: [] }
 try {
  if (!['excel', 'dax', 'tableau'].includes(language)) problem('formula_language', 'Choose excel, dax or tableau.')
  if (!options || !options.fields || typeof options.fields !== 'object' || Array.isArray(options.fields) || Object.keys(options.fields).length > 512) problem('field_mapping_required', 'Supply the reviewed explicit source-to-native field map, with at most 512 aliases.')
  if (Object.values(options.fields).some(value => typeof value !== 'string' || !value.length)) problem('invalid_field_mapping', 'Every mapped field needs a nonempty native field name.')
  if (options.measures) {
   if (typeof options.measures !== 'object' || Array.isArray(options.measures) || Object.keys(options.measures).length > 256) problem('measure_mapping_limit', 'Supply at most 256 explicitly mapped measure ASTs.')
   for (const measure of Object.values(options.measures)) boundExpression(measure)
  }
  const parsed = parseFormula(source, language); let nodes = 0
  function compile(node: Syntax): CalculationExpr {
   if (++nodes > 1024) problem('translation_expansion_limit', 'The source expands beyond the bounded translation size.')
   if (node.kind === 'literal') { if (node.type === 'date') { try { date(node.value) } catch { problem('date_literal_range', 'Supply a valid ISO civil date in the native supported range.') } }; return { ...node } }
   if (node.kind === 'reference' || node.kind === 'name') return resolve(node, options)
   if (node.kind === 'unary') {
    const expression = compile(node.expression)
    return { kind: 'unary', op: node.op, expression: node.op === 'not' && language === 'dax' ? call('coalesce', expression, bool(false)) : expression }
   }
   if (node.kind === 'binary') return operator(language, node.op, compile(node.left), compile(node.right), options)
   if (node.kind === 'fixed') {
    if (!options.fixedContextBound) problem('tableau_fixed_context_binding', 'Bind Tableau data-source and context filters as immutable authorized-row restrictions before translating FIXED; ordinary dimension filters may be removed.')
    return { kind: 'fixed', grain: node.grain.map(item => requireField(item, options)), expression: compile(node.expression), filters: 'ignore-user', totals: 'recompute' }
   }
   const { name, args } = node
   if (name === 'TRUE' || name === 'FALSE' || name === 'BLANK') { arity(name, args, 0); if (name === 'BLANK' && language !== 'dax') problem('source_function_language', 'BLANK() is a DAX function.'); return name === 'BLANK' ? blank() : bool(name === 'TRUE') }
   if (name === 'IF') { arity(name, args, 2, 3); return call('if', compile(args[0]), compile(args[1]), args[2] ? compile(args[2]) : language === 'excel' ? bool(false) : blank()) }
   if (name === 'COALESCE') { if (language !== 'dax') problem('source_function_language', 'COALESCE is translated only for DAX; other source dialects require their own function definition.'); arity(name, args, 1, 32); return call('coalesce', ...args.map(compile)) }
   if (name === 'ISBLANK' && language !== 'tableau') { arity(name, args, 1); if (language === 'excel') problem('excel_isblank_cell_provenance', 'Excel ISBLANK distinguishes empty cells from formulas returning empty text; workbook cell provenance is required.'); return call('is-null', compile(args[0])) }
   if (['AND', 'OR', 'NOT'].includes(name)) {
    if (language === 'tableau' && name !== 'NOT') problem('source_function_language', 'Tableau AND and OR are infix operators, not multi-argument functions.')
    arity(name, args, name !== 'NOT' && language === 'dax' ? 2 : 1, name === 'NOT' ? 1 : language === 'dax' ? 2 : 32)
    const values = args.map(compile).map(value => language === 'dax' ? call('coalesce', value, bool(false)) : value)
    return name === 'NOT' ? { kind: 'unary', op: 'not', expression: values[0] } : values.slice(1).reduce((left, right) => binary(name === 'AND' ? 'and' : 'or', left, right), values[0])
   }
   if (['ABS', 'YEAR', 'MONTH', 'DAY'].includes(name)) {
    arity(name, args, 1); const expression = compile(args[0]), target: CalculationExpr = { kind: 'call', fn: name.toLowerCase() as 'abs' | 'year' | 'month' | 'day', args: [expression] }
    if (name === 'ABS' || language === 'tableau') return target
    const empty = language === 'dax' ? name === 'YEAR' ? '1899' : name === 'MONTH' ? '12' : '30' : name === 'YEAR' ? '1900' : name === 'MONTH' ? '1' : '0'
    return call('if', call('is-null', expression), num(empty), target)
   }
   if (name === 'DATE' || name === 'MAKEDATE') {
    if (name === 'MAKEDATE' && language !== 'tableau' || name === 'DATE' && language === 'tableau') problem('date_constructor_gap', 'Only the source language’s three-integer civil date constructor is translated.')
    arity(name, args, 3); const [year, month, day] = args.map(integer), value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    try { date(value) } catch { problem('date_constructor_normalization', 'Only valid constant civil dates are translated; source overflow normalization needs implementation.') }
    return { kind: 'literal', type: 'date', value }
   }
   if (name === 'EDATE' && language !== 'tableau') { arity(name, args, 2); return { kind: 'call', fn: 'date-add-months', args: args.map(compile) } }
   if (language === 'dax') {
    if(name==='SELECTEDVALUE'){
     arity(name,args,2);const reference=args[0],bound=reference.kind==='reference'&&reference.table?options.parameterBindings?.[reference.table+'.'+reference.name]:undefined
     const fallback=args[1],value=fallback.kind==='literal'&&fallback.type==='number'?fallback.value:fallback.kind==='unary'&&fallback.op==='-'&&fallback.expression.kind==='literal'&&fallback.expression.type==='number'?'-'+fallback.expression.value:null
     if(!bound||value!==bound.default)problem('parameter_selection_binding','Bind the original bounded numeric parameter and exact source default before translating SELECTEDVALUE.')
     return {kind:'parameter',name:bound.name}
    }
    if (name === 'SELECTEDMEASURE') { arity(name, args, 0); return { kind: 'selected-measure' } }
    if (name === 'CALCULATE') return calculate(args, options, compile)
    if (name === 'TOTALYTD' || name === 'TOTALQTD') return fiscalFunction(name, args, options, compile)
    if (name === 'DIVIDE') {
     arity(name, args, 2, 3); const numerator = compile(args[0]), denominator = compile(args[1]), alternative = args[2] ? compile(args[2]) : blank()
     if (alternative.kind !== 'literal' || !['number', 'null'].includes(alternative.type)) problem('divide_constant_alternative', 'DIVIDE alternate result must be a constant number or BLANK().')
     return call('if', binary('or', call('is-null', denominator), binary('=', denominator, num('0'))), alternative, binary('/', numerator, denominator))
    }
   }
   if (name === 'IFERROR' && language === 'excel') {
    arity(name, args, 2); const value = args[0]
    if (value.kind !== 'binary' || value.op !== '/') problem('excel_iferror_gap', 'Only IFERROR around a single numeric division has an exact error-to-value adaptation.')
    const numerator = call('coalesce', compile(value.left), num('0')), denominator = call('coalesce', compile(value.right), num('0'))
    return call('if', binary('=', denominator, num('0')), compile(args[1]), binary('/', numerator, denominator))
   }
   if (language === 'tableau') { const scalar = dateFunction(name, args, compile); if (scalar) return scalar; const window = tableCalculation(name, args, options, compile); if (window) return window }
   const aggregate = aggregateFunction(language, name, args, options, compile); if (aggregate) return aggregate
   return problem('unsupported_source_function', `Implement ${language} function ${name} and verify its output before migrating this calculation.`)
  }
  const target = compile(parsed)
  boundExpression(target)
  // Imported measure ASTs are data too: bound the fully expanded result and
  // reject cyclic mappings instead of letting them escape into runtime.
  let encoded: string; try { encoded = JSON.stringify(target) } catch { problem('cyclic_measure_mapping', 'Resolve cyclic mapped measure definitions before translating.') }
  if (encoded.length > 131072) problem('translation_expansion_limit', 'The translated expression exceeds 128 KiB.')
  result.targetExpression = target
 } catch (error) {
  if (!(error instanceof FormulaProblem)) throw error
  result.issues.push({ code: error.code, message: error.message, sourceExpression: source })
 }
 return result
}
