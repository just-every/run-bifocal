import { decimal, divide, plus, rational } from '../../currency/decimal'
import { declaration, parseTMDL, type TMDLNode } from '../models/readers/tmdl-syntax'
import { parseFormula } from './parse'
import { tokenize, type Token } from './tokenize'
import { FormulaProblem, type Syntax, type TranslationIssue } from './types'

type FieldParameter = { id: string; default: string; choices: Record<string, string[]> }
type NumericParameter = { id: string; default: { kind: 'literal'; type: 'number'; value: string }; min: string; max: string; step: string }
export type TMDLParameters = { fieldParameters: FieldParameter[]; parameters: NumericParameter[]; bindings: Record<string, { name: string; default: string }>; issues: TranslationIssue[] }
type Default = { table: string; column: string; value: string; source: string }
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const compare = (a: ReturnType<typeof decimal>, b: ReturnType<typeof decimal>) => a.numerator * b.denominator - b.numerator * a.denominator
function fail(code: string, message: string): never { throw new FormulaProblem(code, message) }
function signed(node: Syntax): string | null {
 if (node.kind === 'literal' && node.type === 'number' && typeof node.value === 'string') return node.value
 if (node.kind === 'unary' && node.op === '-' && node.expression.kind === 'literal' && node.expression.type === 'number' && typeof node.expression.value === 'string') return '-' + node.expression.value
 return null
}
function measureExpression(node: TMDLNode): string {
 const declared = declaration(node.head, 'measure')!
 return [declared.expression ?? '', ...node.children.filter(child => !/^[A-Za-z][A-Za-z0-9]*\s*:/.test(child.head) && !/^formatStringDefinition\b/i.test(child.head)).map(child => child.raw)].join('\n').trim()
}
function tableExpressions(node: TMDLNode): string[] {
 const declared = declaration(node.head, 'table')!, result: string[] = []
 if (declared.expression !== null) result.push(declared.expression)
 for (const child of node.children) if (/^partition\s/i.test(child.head)) for (const source of child.children) if (/^source\s*=/i.test(source.head)) result.push([source.head.replace(/^source\s*=\s*/i, ''), ...source.children.map(value => value.raw)].join('\n').trim())
 return result
}
function collectDefaults(node: TMDLNode, defaults: Default[]): void {
 if (declaration(node.head, 'measure')) {
  let syntax: Syntax; try { syntax = parseFormula(measureExpression(node), 'dax') } catch { return }
  function visit(expression: Syntax): void {
   if (expression.kind === 'call') {
    if (expression.name === 'SELECTEDVALUE' && expression.args.length === 2) {
     const [reference, fallback] = expression.args, value = signed(fallback)
     if (reference.kind === 'reference' && reference.table && value !== null) defaults.push({ table: reference.table, column: reference.name, value, source: node.raw })
    }
    expression.args.forEach(visit)
   } else if (expression.kind === 'binary') { visit(expression.left); visit(expression.right) }
   else if (expression.kind === 'unary' || expression.kind === 'fixed') visit(expression.expression)
  }
  visit(syntax)
 }
 node.children.forEach(child => collectDefaults(child, defaults))
}
function fieldChoices(expression: string, fields: Record<string, string>): { default: string; choices: Record<string, string[]> } {
 const tokens = tokenize(expression, 'dax'); let index = 0
 const peek = () => tokens[index], take = () => tokens[index++]
 const expect = (value: string) => { if (peek().value.toUpperCase() !== value) fail('field_parameter_syntax', `Expected ${value} in the source field-parameter tuple.`); take() }
 const entries: { label: string; ordinal: number; field: string }[] = []
 expect('{')
 while (peek().value !== '}') {
  if (entries.length >= 32) fail('field_parameter_choice_limit', 'Field parameters support at most 32 explicit choices.')
  expect('('); const label = take(); if (label.type !== 'string' || !label.value || label.value.length > 160) fail('field_parameter_label', 'Supply a nonempty constant field-choice label of at most 160 characters.')
  expect(','); expect('NAMEOF'); expect('(')
  const start = take(); let table: string | undefined, reference: Token
  if (start.type === 'name' || start.type === 'quoted-name') { table = start.value; reference = take() } else reference = start
  if (reference.type !== 'reference') fail('field_parameter_reference', 'NAMEOF must reference one explicitly mapped source field.')
  const raw = expression.slice(start.start, reference.end), keys = table ? [raw, `${table}[${reference.value.replace(/]/g, ']]')}]`, `${table}.${reference.value}`] : [raw, reference.value]
  const targets = [...new Set(keys.filter(key => Object.hasOwn(fields, key)).map(key => fields[key]))]
  if (targets.length !== 1 || typeof targets[0] !== 'string' || !targets[0]) fail('field_parameter_mapping', `Map ${raw} to exactly one native field before migration.`)
  expect(')'); expect(','); const ordinal = take()
  if (ordinal.type !== 'number' || !/^\d{1,9}$/.test(ordinal.value)) fail('field_parameter_ordinal', 'Field choices require explicit nonnegative integer ordinals.')
  expect(')'); entries.push({ label: label.value, ordinal: Number(ordinal.value), field: targets[0] })
  if (peek().value !== ',') break; take(); if (peek().value === '}') fail('field_parameter_trailing_comma', 'Remove the unsupported trailing comma from the original parameter table expression.')
 }
 expect('}'); if (peek().type !== 'end' || !entries.length) fail('field_parameter_tail', 'Supply only the complete nonempty three-column field-parameter table expression.')
 if (new Set(entries.map(entry => entry.label)).size !== entries.length || new Set(entries.map(entry => entry.ordinal)).size !== entries.length || new Set(entries.map(entry => entry.field)).size !== entries.length) fail('field_parameter_duplicates', 'Field labels, ordinals and mapped fields must each be unique.')
 entries.sort((a, b) => a.ordinal - b.ordinal)
 return { default: entries[0].label, choices: Object.fromEntries(entries.map(entry => [entry.label, [entry.field]])) }
}
function numericParameter(expression: string, table: TMDLNode, tableName: string, id: string, defaults: Default[]): { parameter: NumericParameter; column: string } {
 const syntax = parseFormula(expression, 'dax')
 if (syntax.kind !== 'call' || syntax.name !== 'GENERATESERIES' || syntax.args.length !== 3) fail('what_if_series_gap', 'What-if parameters require an explicit three-constant GENERATESERIES(min,max,step).')
 const values = syntax.args.map(signed)
 if (values.some(value => value === null)) fail('what_if_constant_range', 'What-if bounds and increment must be exact decimal constants.')
 const [min, max, step] = values as string[], lo = decimal(min), hi = decimal(max), increment = decimal(step)
 if (compare(lo, hi) > 0n || increment.numerator <= 0n) fail('what_if_range', 'What-if minimum must not exceed maximum, and increment must be positive.')
 const span = divide(plus(hi, rational(-lo.numerator, lo.denominator)), increment)
 if (span.numerator / span.denominator + 1n > 1000n) fail('what_if_sampled_range', 'More than 1,000 parameter values require source sampling behavior before migration.')
 const candidates = defaults.filter(value => value.table === tableName)
 if (!candidates.length) fail('what_if_default_required', 'Supply an original SELECTEDVALUE(parameter-column, numeric-default) expression; a numeric default is never inferred.')
 const columns = table.children.map(child => declaration(child.head, 'column')).filter(value => value !== null)
 if (columns.length > 1 || columns.length === 1 && candidates.some(value => value.column !== columns[0]!.name)) fail('what_if_column_binding', 'Bind the numeric parameter to its one declared source column.')
 if (new Set(candidates.map(value => value.column)).size !== 1 || candidates.some(value => compare(decimal(value.value), decimal(candidates[0].value)) !== 0n)) fail('what_if_conflicting_defaults', 'Resolve conflicting SELECTEDVALUE columns or numeric defaults for this parameter table.')
 const fallback = candidates[0], selected = decimal(fallback.value), offset = divide(plus(selected, rational(-lo.numerator, lo.denominator)), increment)
 if (compare(selected, lo) < 0n || compare(selected, hi) > 0n || offset.denominator !== 1n) fail('what_if_default_range', 'The explicit numeric default must be an available value in the declared source series.')
 return { parameter: { id, default: { kind: 'literal', type: 'number', value: fallback.value }, min, max, step }, column: fallback.column }
}

/** Extract bounded source parameters without evaluating DAX or replacing source
 * expressions. Other tables belong to the existing semantic-model reader. */
export function readTMDLParameters(source: string, fields: Record<string, string>): TMDLParameters {
 const result: TMDLParameters = { fieldParameters: [], parameters: [], bindings: Object.create(null), issues: [] }
 const issue = (code: string, message: string, sourceExpression: string) => result.issues.push({ code, message, sourceExpression })
 if (typeof source !== 'string' || source.length > 1048576) { issue('tmdl_parameter_size', 'TMDL parameter source must fit within 1 MiB.', source); return result }
 if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length > 512 || Object.values(fields).some(value => typeof value !== 'string' || !value)) { issue('parameter_field_mapping', 'Supply at most 512 explicit source field aliases with nonempty native field names.', source); return result }
 let roots: TMDLNode[]; try { roots = parseTMDL(source) } catch { issue('invalid_tmdl_parameters', 'Repair the original TMDL indentation or fenced expression.', source); return result }
 const defaults: Default[] = []; roots.forEach(root => collectDefaults(root, defaults))
 const identities = new Set<string>()
 for (const root of roots) {
  const table = declaration(root.head, 'table'); if (!table) continue
  const expressions = tableExpressions(root), marked = /\b(?:NAMEOF|GENERATESERIES|ParameterMetadata)\b/i.test(root.raw)
  if (!marked) continue
  try {
   const id = normalized(table.name)
   if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || identities.has(id)) fail('parameter_identity', 'Parameter table names need unique native identifiers after lowercase dash normalization.')
   identities.add(id)
   if (expressions.length !== 1) fail('parameter_table_expression', 'Supply exactly one complete direct table or calculated-partition expression for this parameter.')
   const expression = expressions[0]
   if (/^\s*\{/.test(expression)) {
    if (result.fieldParameters.length >= 8) fail('field_parameter_limit', 'This import supports at most eight field parameters.')
    result.fieldParameters.push({ id, ...fieldChoices(expression, fields) })
   } else if (/^\s*GENERATESERIES\s*\(/i.test(expression)) {
    if (result.parameters.length >= 16) fail('what_if_parameter_limit', 'This import supports at most sixteen numeric parameters.')
    const { parameter, column } = numericParameter(expression, root, table.name, id, defaults)
    result.parameters.push(parameter); result.bindings[`${table.name}.${column}`] = { name: id, default: parameter.default.value }
   } else fail('parameter_expression_gap', 'Implement this source parameter table expression before migration.')
  } catch (error) {
   if (!(error instanceof FormulaProblem)) throw error
   issue(error.code, error.message, root.raw)
  }
 }
 return result
}
