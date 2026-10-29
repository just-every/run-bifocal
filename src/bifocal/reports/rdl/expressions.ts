import type { AggregateOp, BinaryOp, CalculationExpr } from '../../calculations/core'
import { boundExpression } from '../../imports/calculations/bounds'
import { parseFormula } from '../../imports/calculations/parse'
import { FormulaProblem, type Syntax } from '../../imports/calculations/types'

type Kind = 'number' | 'text' | 'boolean' | 'unknown'
type Compiled = { expression: CalculationExpr; type: Kind }
const refuse = (): never => { throw new FormulaProblem('unsupported_rdl_expression', 'The expression is outside the supported RDL subset.') }

/** VB collection references are normalized only outside quoted strings. The
 * existing bounded formula parser supplies precedence and syntax; compiling its
 * tree directly avoids DAX blank coercions, COUNT behavior and division rules. */
export function translateRdlExpression(source: string, fields: Record<string, string>, parameters: Set<string>): CalculationExpr | null {
 try {
  if (typeof source !== 'string' || !source.startsWith('=') || source.length > 8192 || !fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length > 512 || !(parameters instanceof Set) || parameters.size > 64) return null
  const references = new Map<string, CalculationExpr>()
  let normalized = '', position = 1, tokens = 0
  while (position < source.length) {
   if (++tokens > 2048) refuse()
   const rest = source.slice(position), character = source[position]
   if (/\s/.test(character)) { normalized += character; position++; continue }
   if (character === '"') {
    const start = position++
    let closed = false
    while (position < source.length) {
     if (source[position] === '"') {
      if (source[position + 1] === '"') { position += 2; continue }
      position++; closed = true; break
     }
     if (/[\x00-\x1f]/.test(source[position])) refuse()
     position++
    }
    if (!closed) refuse()
    normalized += source.slice(start, position)
    continue
   }
   const reference = /^(Fields|Parameters)!([A-Za-z_][A-Za-z0-9_]*)\.Value\b/i.exec(rest)
   if (reference) {
    const name = reference[2], key = 'rdl' + references.size
    let expression: CalculationExpr
    if (reference[1].toLowerCase() === 'fields') {
     if (!Object.hasOwn(fields, name) || typeof fields[name] !== 'string' || !fields[name].length) refuse()
     expression = { kind: 'field', field: fields[name] }
    } else {
     if (!parameters.has(name)) refuse()
     expression = { kind: 'parameter', name }
    }
    references.set(key, expression)
    normalized += '[' + key + ']'
    position += reference[0].length
    continue
   }
   const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(rest)
   if (number) { normalized += number[0]; position += number[0].length; continue }
   const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)
   if (name) { normalized += name[0]; position += name[0].length; continue }
   if (character === '/' && ['/', '*'].includes(source[position + 1])) refuse()
   const pair = source.slice(position, position + 2)
   if (['<=', '>=', '<>'].includes(pair)) { normalized += pair; position += 2; continue }
   if (!'+-*/=<>(),'.includes(character)) refuse()
   normalized += character; position++
  }

  if (normalized.trimStart().startsWith('=')) refuse()
  const parsed = parseFormula(normalized, 'dax')
  let nodes = 0
  const requireType = (actual: Kind, expected: Kind) => { if (actual !== 'unknown' && actual !== expected) refuse() }
  function compile(node: Syntax, insideAggregate = false): Compiled {
   if (++nodes > 512) refuse()
   const next = (value: Syntax) => compile(value, insideAggregate)
   if (node.kind === 'literal') {
    if (!['number', 'text', 'boolean'].includes(node.type)) refuse()
    return { expression: { ...node }, type: node.type as Kind }
   }
   if (node.kind === 'reference') {
    if (node.table || !references.has(node.name)) refuse()
    return { expression: references.get(node.name)!, type: 'unknown' }
   }
   if (node.kind === 'unary') {
    const expression = next(node.expression), type = node.op === 'not' ? 'boolean' : 'number'
    requireType(expression.type, type)
    return { expression: { kind: 'unary', op: node.op, expression: expression.expression }, type }
   }
   if (node.kind === 'binary') {
    const left = next(node.left), right = next(node.right)
    const op = ({ AND: 'and', OR: 'or' } as Record<string, BinaryOp>)[node.op] ?? node.op as BinaryOp
    if (!['+', '-', '*', '/', '=', '<>', '<', '<=', '>', '>=', 'and', 'or'].includes(op)) refuse()
    const boolean = op === 'and' || op === 'or', arithmetic = ['+', '-', '*', '/'].includes(op)
    requireType(left.type, boolean ? 'boolean' : 'number'); requireType(right.type, boolean ? 'boolean' : 'number')
    return { expression: { kind: 'binary', op, left: left.expression, right: right.expression }, type: arithmetic ? 'number' : 'boolean' }
   }
   if (node.kind !== 'call') return refuse()
   const { name, args } = node
   if (name === 'NOT') {
    if (args.length !== 1) refuse()
    const expression = next(args[0])
    requireType(expression.type, 'boolean')
    return { expression: { kind: 'unary', op: 'not', expression: expression.expression }, type: 'boolean' }
   }
   if (name === 'COUNTROWS') {
    if (insideAggregate || args.length) refuse()
    return { expression: { kind: 'aggregate', op: 'count' }, type: 'number' }
   }
   const aggregates: Record<string, AggregateOp> = { SUM: 'sum', AVG: 'avg', MIN: 'min', MAX: 'max', COUNT: 'count' }
   if (Object.hasOwn(aggregates, name)) {
    if (insideAggregate || args.length !== 1) refuse()
    const expression = compile(args[0], true), op = aggregates[name]
    if (op !== 'count') requireType(expression.type, 'number')
    return { expression: { kind: 'aggregate', op, expression: expression.expression }, type: 'number' }
   }
   if (name === 'IIF') {
    if (args.length !== 3) refuse()
    const condition = next(args[0]), yes = next(args[1]), no = next(args[2])
    requireType(condition.type, 'boolean')
    if (yes.type !== 'unknown' && no.type !== 'unknown' && yes.type !== no.type) refuse()
    return { expression: { kind: 'call', fn: 'if', args: [condition.expression, yes.expression, no.expression] }, type: yes.type === 'unknown' ? no.type : yes.type }
   }
   if (name === 'ISNOTHING' || name === 'ABS') {
    if (args.length !== 1) refuse()
    const expression = next(args[0])
    if (name === 'ABS') requireType(expression.type, 'number')
    return { expression: { kind: 'call', fn: name === 'ABS' ? 'abs' : 'is-null', args: [expression.expression] }, type: name === 'ABS' ? 'number' : 'boolean' }
   }
   return refuse()
  }
  const expression = compile(parsed).expression
  boundExpression(expression)
  return expression
 } catch (error) {
  if (error instanceof FormulaProblem) return null
  throw error
 }
}
