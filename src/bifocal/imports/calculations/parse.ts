import { tokenize, type Token } from './tokenize'
import { problem, type FormulaLanguage, type Syntax } from './types'

export function parseFormula(source: string, language: FormulaLanguage): Syntax {
 const tokens = tokenize(source, language); let index = 0, nodes = 0, depth = 0
 const peek = () => tokens[index], take = () => tokens[index++]
 const is = (value: string) => peek().value.toUpperCase() === value
 const expect = (value: string) => { if (!is(value)) problem('formula_syntax', `Expected ${value} at character ${peek().start + 1}.`); take() }
 const make = (node: Syntax) => { if (++nodes > 512) problem('formula_node_limit', 'The formula exceeds 512 syntax nodes.'); return node }
 const precedence: Record<string, number> = { OR: 1, '||': 1, AND: 2, '&&': 2, '=': 3, '==': 3, '<>': 3, '!=': 3, '<': 3, '<=': 3, '>': 3, '>=': 3, '+': 4, '-': 4, '*': 5, '/': 5 }
 function expression(minimum = 0): Syntax {
  if (++depth > 24) problem('formula_depth_limit', 'The formula exceeds 24 nested expressions.')
  let left = prefix()
  for (;;) {
   const op = peek().value.toUpperCase(), power = Object.hasOwn(precedence, op) ? precedence[op] : -1
   if (power < minimum) break
   take(); left = make({ kind: 'binary', op, left, right: expression(power + 1) })
  }
  depth--; return left
 }
 function argumentsList(): Syntax[] {
  expect('('); const args: Syntax[] = []
  if (!is(')')) { do { if (args.length >= 64) problem('formula_argument_limit', 'The formula call exceeds 64 arguments.'); args.push(expression()); if (!is(',')) break; take() } while (true) }
  expect(')'); return args
 }
 function reference(token: Token): Syntax {
  if (peek().type === 'reference' && (token.type === 'name' || token.type === 'quoted-name')) { const field = take(); return make({ kind: 'reference', table: token.value, name: field.value, source: source.slice(token.start, field.end) }) }
  if (token.type === 'reference') return make({ kind: 'reference', name: token.value, source: source.slice(token.start, token.end) })
  return make({ kind: 'name', name: token.value })
 }
 function prefix(): Syntax {
  const token = take(), upper = token.value.toUpperCase()
  if (token.value === '-') return make({ kind: 'unary', op: '-', expression: expression(6) })
  if (token.value === '+') return expression(6)
  if (upper === 'NOT' && peek().value !== '(') return make({ kind: 'unary', op: 'not', expression: expression(3) })
  if (token.value === '(') { const result = expression(); expect(')'); return result }
  if (token.value === '{') {
   if (language !== 'tableau' || !is('FIXED')) problem('unsupported_set_or_lod', 'Only Tableau FIXED level-of-detail expressions are translated here.')
   take(); const grain: Syntax[] = []
   if (!is(':')) { do { grain.push(expression(4)); if (!is(',')) break; take() } while (true) }
   expect(':'); const body = expression(); expect('}'); return make({ kind: 'fixed', grain, expression: body })
  }
  if (token.type === 'number') {
   let [whole, fraction = ''] = token.value.split('.'); whole = (whole || '0').replace(/^0+(?=\d)/, '')
   if (whole.length > 80 || fraction.length > 24) problem('decimal_precision_limit', 'Exact literals support at most 80 integer digits and 24 decimal places.')
   return make({ kind: 'literal', type: 'number', value: whole + (fraction ? '.' + fraction : '') })
  }
  if (token.type === 'string' || token.type === 'date') return make({ kind: 'literal', type: token.type === 'date' ? 'date' : 'text', value: token.value })
  if ((upper === 'TRUE' || upper === 'FALSE' || upper === 'NULL' && language === 'tableau') && !is('(')) return make({ kind: 'literal', type: upper === 'NULL' ? 'null' : 'boolean', value: upper === 'NULL' ? null : upper === 'TRUE' })
  if (upper === 'IF' && language === 'tableau') {
   const condition = expression(); expect('THEN'); const yes = expression(); let no: Syntax = { kind: 'literal', type: 'null', value: null }
   if (is('ELSEIF')) problem('tableau_elseif_gap', 'Rewrite ELSEIF as nested IF or implement its source translation.')
   if (is('ELSE')) { take(); no = expression() }; expect('END'); return make({ kind: 'call', name: 'IF', args: [condition, yes, no] })
  }
  if (token.type === 'name' && is('(')) return make({ kind: 'call', name: upper, args: argumentsList() })
  if (['reference', 'name', 'quoted-name'].includes(token.type)) return reference(token)
  return problem('formula_syntax', `Expected an expression at character ${token.start + 1}.`)
 }
 if (peek().value === '=' && language !== 'tableau') take()
 const result = expression(); if (peek().type !== 'end') problem('untranslated_formula_tail', `The formula contains an unsupported construct at character ${peek().start + 1}.`)
 return result
}
