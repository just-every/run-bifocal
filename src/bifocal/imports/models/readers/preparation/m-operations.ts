import type { FlowStep } from './types'
import { identifier, mCall, mList, splitM, textLiteral, type MToken } from './m-syntax'

type Translation = Pick<FlowStep, 'operations' | 'reason' | 'binding' | 'parameter' | 'metadata'>
const symbol = (t: MToken | undefined, v: string) => t?.kind === 'symbol' && t.value === v
const strings = (tokens: MToken[]): string[] | null => {
 const parts = mList(tokens), values = parts?.map(textLiteral)
 return values && values.every((v): v is string => v !== null) ? values : null
}
const field = (tokens: MToken[]): string | null => {
 if (!symbol(tokens[0], '[') || !symbol(tokens.at(-1), ']') || tokens.length < 3) return null
 const inner = tokens.slice(1, -1)
 return inner.every(t => t.kind === 'id' || t.kind === 'number') ? inner.map(t => t.value).join(' ') : null
}
const valueOf = (tokens: MToken[]): string | number | boolean | null | undefined => {
 if (tokens.length === 1) {
  const t = tokens[0]
  if (t.kind === 'text') return t.value
  if (t.kind === 'id' && !t.quoted && ['true', 'false', 'null'].includes(t.value)) return t.value === 'null' ? null : t.value === 'true'
 }
 if (tokens.length === 1 && tokens[0].kind === 'number' || tokens.length === 2 && tokens[0].kind === 'symbol' && ['+', '-'].includes(tokens[0].value) && tokens[1].kind === 'number') {
  const value = Number(tokens.map(t => t.value).join(''))
  if (Number.isFinite(value)) return value
 }
 return undefined
}

export function mParameter(tokens: MToken[]): Translation | null {
 let literal = tokens, meta: MToken[] | undefined
 const at = tokens.findIndex(t => t.kind === 'id' && !t.quoted && t.value === 'meta')
 if (at >= 0) { literal = tokens.slice(0, at); meta = tokens.slice(at + 1) }
 const value = valueOf(literal)
 if (value === undefined) return null
 const metadata: Record<string, unknown> = {}
 if (meta) {
  if (!symbol(meta[0], '[') || !symbol(meta.at(-1), ']')) return { reason: 'Parameter metadata must be a literal M record.' }
  try {
   for (const part of splitM(meta.slice(1, -1), ',')) {
    if (!part.length) continue
    if (part[0]?.kind !== 'id' || !symbol(part[1], '=')) return { reason: 'Parameter metadata contains a nonliteral field.' }
    const v = valueOf(part.slice(2))
    if (v === undefined || Object.hasOwn(metadata, part[0].value)) return { reason: 'Parameter metadata contains a nonliteral or duplicate field.' }
    metadata[part[0].value] = v
   }
  } catch { return { reason: 'Parameter metadata record is malformed.' } }
 }
 const type = typeof metadata.Type === 'string' ? metadata.Type : value === null ? 'null' : typeof value
 return { parameter: { type, value }, metadata: { parameterMetadata: metadata } }
}

function staticArgument(tokens: MToken[]): boolean {
 if (valueOf(tokens) !== undefined) return true
 if (tokens.length === 1 && tokens[0].kind === 'id' && /^QuoteStyle\.(?:Csv|None)$/.test(tokens[0].value)) return true
 if (symbol(tokens[0], '[') && symbol(tokens.at(-1), ']')) {
  try { return splitM(tokens.slice(1, -1), ',').every(part => !part.length || part[0]?.kind === 'id' && symbol(part[1], '=') && staticArgument(part.slice(2))) } catch { return false }
 }
 return false
}
function inactiveConnector(tokens: MToken[]): boolean {
 const call = mCall(tokens)
 if (!call) return false
 if (call.name === 'Excel.CurrentWorkbook') return call.args.length === 0
 if (call.name === 'File.Contents') return call.args.length >= 1 && call.args.length <= 2 && textLiteral(call.args[0]) !== null && call.args.slice(1).every(staticArgument)
 if (call.name === 'Csv.Document' || call.name === 'Excel.Workbook') return call.args.length >= 1 && call.args.length <= (call.name === 'Csv.Document' ? 5 : 3) && mCall(call.args[0])?.name === 'File.Contents' && inactiveConnector(call.args[0]) && call.args.slice(1).every(staticArgument)
 return false
}

const unsupported = (tokens: MToken[]): string => {
 const names = tokens.filter(t => t.kind === 'id').map(t => t.value)
 if (names.some(n => n === 'Web.Contents' || n === 'Web.BrowserContents')) return 'Web content, pagination, credentials and privacy boundaries require an explicit connector implementation; imported M is never fetched.'
 if (names.some(n => /^Folder\./.test(n))) return 'Folder combination requires a reviewed root, file schema and combination function; imported folder sources are inactive.'
 if (names.some(n => /^(?:R|Python)\.(?:Execute|Evaluate)$/.test(n))) return 'R or Python source execution is unsupported; imported scripts never run.'
 if (names.some(n => ['RangeStart', 'RangeEnd'].includes(n))) return 'Incremental partition boundaries require explicit snapshot and refresh-policy translation.'
 if (tokens.some(t => symbol(t, '=>'))) return 'Custom M functions require a faithful native rewrite; imported functions never execute.'
 const call = mCall(tokens)
 return call ? `M function ${call.name} or its argument shape has no faithful native translation.` : 'This M expression is outside the bounded native preparation grammar.'
}

export function translateM(tokens: MToken[], resolve: (name: string) => string | undefined, queryName: string): Translation {
 const parameter = mParameter(tokens)
 if (parameter) return parameter
 const alias = identifier(tokens)
 if (alias !== null) return resolve(alias) ? { operations: [] } : { binding: alias, operations: [], metadata: { inactiveSource: true, sourceKind: 'logical-name' } }
 const shadowed = tokens.find((token, index) => token.kind === 'id' && symbol(tokens[index + 1], '(') && resolve(token.value))
 if (shadowed) return { reason: `Custom M function ${shadowed.value} shadows a library name and requires a faithful native rewrite.` }
 if (inactiveConnector(tokens)) return { binding: queryName, operations: [], metadata: { inactiveSource: true, sourceKind: mCall(tokens)!.name } }
 const call = mCall(tokens)
 if (!call) return { reason: unsupported(tokens) }
 const { name, args } = call
 if (resolve(name)) return { reason: `Custom M function ${name} shadows a library name and requires a faithful native rewrite.` }
 if (tokens.some(t => t.kind === 'id' && /^(?:Web\.(?:Contents|BrowserContents)|Folder\.|(?:R|Python)\.(?:Execute|Evaluate))/.test(t.value))) return { reason: unsupported(tokens) }
 const ref = (part: MToken[]) => { const name = identifier(part); return name === null ? undefined : resolve(name) }
 if (name === 'Table.Combine' && args.length === 1) {
  const members = mList(args[0]), ids = members?.map(ref)
  if (ids && ids.length > 0 && ids.every((id): id is string => !!id)) return { operations: ids.slice(1).map(id => ({ op: 'union', dataset: '$step:' + id })) }
  return { reason: 'Table.Combine requires a nonempty literal list of named table dependencies and no schema override.' }
 }
 if (!args.length || !ref(args[0])) return { reason: `${name} requires a resolved named table input; inline expressions are not executed.` }
 if (name === 'Table.Distinct' && args.length === 1) return { operations: [{ op: 'dedupe' }] }
 if (name === 'Table.TransformColumnTypes' && args.length >= 2 && args.length <= 3) {
  if (args.length === 3 && textLiteral(args[2]) !== '') return { reason: 'M culture-dependent conversion requires explicit faithful locale handling; only the invariant culture is supported.' }
  const conversions = mList(args[1]), operations: Record<string, unknown>[] = [], types: string[] = []
  if (!conversions?.length) return { reason: 'Table.TransformColumnTypes requires a nonempty literal conversion list.' }
  for (const conversion of conversions) {
   const pair = mList(conversion), column = pair?.length === 2 ? textLiteral(pair[0]) : null
   if (!pair || column === null) return { reason: 'Each type conversion requires a literal column name and supported M primitive type.' }
   const typeTokens = pair[1], sourceType = typeTokens.map(t => t.value).join(' ')
   if (sourceType === 'Currency.Type') return { reason: 'Currency.Type uses four-decimal half-even conversion and a bounded signed range; native two-decimal money casting does not preserve it.' }
   if (sourceType === 'Int64.Type') return { reason: 'Int64.Type requires half-even rounding and signed 64-bit range enforcement; native number casting does not preserve it.' }
   const type = ({ 'type text': 'text', 'type number': 'number', 'type date': 'date', 'type logical': 'boolean' } as Record<string, string>)[sourceType]
   if (!type || typeTokens.some(t => t.kind !== 'id' || t.quoted)) return { reason: `M conversion type ${sourceType} has no faithful native conversion.` }
   operations.push({ op: 'cast', column, type }); types.push(sourceType)
  }
  return { operations, metadata: { mTypes: types, mCulture: args.length === 3 ? 'invariant' : 'source-default', requiresConversionEquivalence: true } }
 }
 if (name === 'Table.AddColumn' && (args.length === 3 || args.length === 4)) {
  const output = textLiteral(args[1]), each = args[2]
  if (output !== null && each[0]?.kind === 'id' && !each[0].quoted && each[0].value === 'each') {
   const body = each.slice(1)
   const at = body.findIndex(t => t.kind === 'symbol' && ['+', '-', '*'].includes(t.value))
   const left = at >= 0 ? field(body.slice(0, at)) : null, right = at >= 0 ? field(body.slice(at + 1)) : null
   const declared = args[3]?.map(t => t.value).join(' ')
   if (left !== null && right !== null && (!declared || declared === 'type number' && args[3].every(t => t.kind === 'id' && !t.quoted))) return { operations: [{ op: 'calculate', name: output, left, right, operator: ({ '+': 'add', '-': 'subtract', '*': 'multiply' } as Record<string, string>)[body[at].value] }] }
  }
  return { reason: 'Table.AddColumn supports only each arithmetic on two named numeric fields with optional type number; custom lambdas and other declared types require translation.' }
 }
 if (name === 'Table.Unpivot' && args.length === 4) {
  const columns = strings(args[1]), label = textLiteral(args[2]), value = textLiteral(args[3])
  if (columns?.length && label !== null && value !== null) return { operations: [{ op: 'unpivot', columns, name: label, value, omitNulls: true }] }
 }
 if (name === 'Table.RenameColumns' && args.length === 2) {
  const pairs = mList(args[1]), operations: Record<string, unknown>[] = []
  if (pairs) {
   for (const item of pairs) { const pair = strings(item); if (!pair || pair.length !== 2) return { reason: 'Table.RenameColumns requires literal pairs with default missing-column errors.' }; operations.push({ op: 'rename', from: pair[0], to: pair[1] }) }
   return { operations }
  }
 }
 if (['Table.SelectColumns', 'Table.ReorderColumns', 'Table.RemoveColumns'].includes(name) && args.length === 2) {
  const columns = strings(args[1])
  if (columns?.length) return { operations: [{ op: name === 'Table.RemoveColumns' ? 'remove' : name === 'Table.ReorderColumns' ? 'reorder' : 'select', columns }] }
 }
 if (name === 'Table.Sort' && args.length === 2) {
  const direct = textLiteral(args[1])
  if (direct !== null) return { operations: [{ op: 'sort', columns: [{ column: direct, direction: 'asc' }] }] }
  const clauses = mList(args[1]), columns: { column: string; direction: string }[] = []
  if (clauses?.length) {
   for (const clause of clauses) {
    const plain = textLiteral(clause)
    if (plain !== null) { columns.push({ column: plain, direction: 'asc' }); continue }
    const pair = mList(clause), column = pair?.length === 2 ? textLiteral(pair[0]) : null, order = pair ? identifier(pair[1] ?? []) : null
    if (column === null || !['Order.Ascending', 'Order.Descending'].includes(order ?? '')) return { reason: 'Table.Sort requires literal columns and Order.Ascending or Order.Descending; custom comparers are unsupported.' }
    columns.push({ column, direction: order === 'Order.Descending' ? 'desc' : 'asc' })
   }
   return { operations: [{ op: 'sort', columns }], metadata: { requiresSortEquivalence: true } }
  }
 }
 return { reason: unsupported(tokens) }
}
