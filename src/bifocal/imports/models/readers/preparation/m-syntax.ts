export type MToken = { kind: 'id' | 'text' | 'number' | 'symbol'; value: string; start: number; end: number; quoted?: boolean }
export type MPart = { name: string; tokens: MToken[]; expression: string; offset: number; reason?: string; metadata?: Record<string, unknown> }
const reserved = new Set(['and', 'as', 'each', 'else', 'error', 'false', 'if', 'in', 'is', 'let', 'meta', 'not', 'null', 'or', 'otherwise', 'section', 'shared', 'then', 'true', 'try', 'type'])
const fail = (reason: string): never => { throw new Error(reason) }

function decodeQuoted(raw: string): string {
 return raw.replaceAll('""', '"').replace(/#\(([^)]*)\)/g, (_, codes: string) => codes.split(',').map(code => {
  const value = code.trim(), named: Record<string, string> = { cr: '\r', lf: '\n', tab: '\t', '#': '#' }
  if (Object.hasOwn(named, value)) return named[value]
  if (!/^(?:[\da-fA-F]{4}|[\da-fA-F]{8})$/.test(value)) return fail('Unsupported M character escape.')
  const point = Number.parseInt(value, 16)
  if (point > 0x10ffff || point >= 0xd800 && point <= 0xdfff) return fail('Invalid M Unicode character escape.')
  return String.fromCodePoint(point)
 }).join(''))
}

export function tokenizeM(source: string): MToken[] {
 if (source.length > 1000000) fail('M document exceeds the 1000000 character bound.')
 const out: MToken[] = []
 let i = 0, nesting = 0
 while (i < source.length) {
  if (/\s/.test(source[i])) { i++; continue }
  if (source.startsWith('//', i)) { const end = source.indexOf('\n', i + 2); i = end < 0 ? source.length : end; continue }
  if (source.startsWith('/*', i)) {
   const end = source.indexOf('*/', i + 2)
   if (end < 0) fail('Unterminated M block comment.')
   i = end + 2; continue
  }
  const start = i, quotedId = source.startsWith('#"', i)
  if (quotedId || source[i] === '"') {
   i += quotedId ? 2 : 1
   const body = i
   while (i < source.length) {
    if (source[i] !== '"') { i++; continue }
    if (source[i + 1] === '"') { i += 2; continue }
    break
   }
   if (i === source.length) fail('Unterminated M quoted text or identifier.')
   const value = decodeQuoted(source.slice(body, i)); i++
   out.push({ kind: quotedId ? 'id' : 'text', value, start, end: i, ...(quotedId ? { quoted: true } : {}) })
  } else {
   const tail = source.slice(i), id = /^(?:[\p{L}_][\p{L}\p{N}_]*)(?:\.[\p{L}_][\p{L}\p{N}_]*)*/u.exec(tail)
   const number = /^(?:0[xX][\da-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(tail)
   const value = id?.[0] ?? number?.[0] ?? (/^(?:=>|<>|<=|>=|\.\.\.|\.\.|[(){}\[\],;=+*\-\/:<>?@&.!#|])/.exec(tail)?.[0])
   if (!value) return fail(`Unsupported M token at character ${i + 1}.`)
   i += value.length
   if (!id && !number) { if (['(', '[', '{'].includes(value)) nesting++; if ([')', ']', '}'].includes(value)) nesting--; if (nesting > 64) fail('M nesting exceeds the 64 level bound.') }
   out.push({ kind: id ? 'id' : number ? 'number' : 'symbol', value, start, end: i })
  }
  if (out.length > 100000) fail('M document exceeds the 100000 token bound.')
 }
 return out
}

export function splitM(tokens: MToken[], delimiter: string): MToken[][] {
 const out: MToken[][] = [], stack: string[] = []
 let first = 0, lets = 0
 const closing: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
 for (const [i, token] of tokens.entries()) {
  const v = token.value
  if (token.kind === 'symbol' && ['(', '[', '{'].includes(v)) stack.push(v)
  else if (token.kind === 'symbol' && Object.hasOwn(closing, v)) { if (stack.pop() !== closing[v]) fail('Unbalanced M delimiters.') }
  else if (!stack.length && token.kind === 'id' && !token.quoted && v === 'let') lets++
  else if (!stack.length && token.kind === 'id' && !token.quoted && v === 'in') { if (!lets) fail('Unmatched M in keyword.'); lets-- }
  if (!stack.length && !lets && token.kind === 'symbol' && v === delimiter) { out.push(tokens.slice(first, i)); first = i + 1 }
 }
 if (stack.length || lets) fail('Unclosed M expression.')
 out.push(tokens.slice(first))
 return out
}

export const tokenText = (tokens: MToken[], source: string): string => tokens.length ? source.slice(tokens[0].start, tokens.at(-1)!.end) : ''
export const identifier = (tokens: MToken[]): string | null => tokens.length === 1 && tokens[0].kind === 'id' && (tokens[0].quoted || !reserved.has(tokens[0].value)) ? tokens[0].value : null
export const textLiteral = (tokens: MToken[]): string | null => tokens.length === 1 && tokens[0].kind === 'text' ? tokens[0].value : null
export function mList(tokens: MToken[]): MToken[][] | null {
 if (tokens[0]?.kind !== 'symbol' || tokens[0]?.value !== '{' || tokens.at(-1)?.kind !== 'symbol' || tokens.at(-1)?.value !== '}') return null
 try { const parts = splitM(tokens.slice(1, -1), ','); return parts.length === 1 && !parts[0].length ? [] : parts } catch { return null }
}
export function mCall(tokens: MToken[]): { name: string; args: MToken[][] } | null {
 if (tokens[0]?.kind !== 'id' || tokens[1]?.kind !== 'symbol' || tokens[1]?.value !== '(' || tokens.at(-1)?.kind !== 'symbol' || tokens.at(-1)?.value !== ')') return null
 try { const args = splitM(tokens.slice(2, -1), ','); return { name: tokens[0].value, args: args.length === 1 && !args[0].length ? [] : args } } catch { return null }
}
export function mLocation(content: string, offset: number, prefix = ''): string {
 const before = content.slice(0, offset), line = before.split('\n').length, column = offset - before.lastIndexOf('\n')
 return `${prefix}${line}:${column}`
}

export function mBindings(tokens: MToken[], source: string): { parts: MPart[]; result: MToken[] } {
 if (tokens[0]?.value !== 'let' || tokens[0].kind !== 'id' || tokens[0].quoted) return { parts: [], result: tokens }
 const stack: string[] = []
 let depth = 1, end = -1
 for (let i = 1; i < tokens.length; i++) {
  const t = tokens[i]
  if (t.kind === 'symbol' && ['(', '{', '['].includes(t.value)) stack.push(t.value)
  else if (t.kind === 'symbol' && [')', '}', ']'].includes(t.value)) stack.pop()
  else if (!stack.length && t.kind === 'id' && !t.quoted && t.value === 'let') depth++
  else if (!stack.length && t.kind === 'id' && !t.quoted && t.value === 'in' && --depth === 0) { end = i; break }
 }
 if (end < 0 || end === tokens.length - 1) fail('M let expression requires an in result.')
 const groups = splitM(tokens.slice(1, end), ',')
 const parts = groups.map((part, index) => {
  if (identifier(part.slice(0, 1)) === null || part[1]?.kind !== 'symbol' || part[1]?.value !== '=' || part.length < 3) fail(`Invalid M let binding ${index + 1}.`)
  const body = part.slice(2)
  const start = part[1].end, stop = groups[index + 1]?.[0]?.start ?? tokens[end].start
  const comma = tokens.find(t => t.kind === 'symbol' && t.value === ',' && t.start >= body.at(-1)!.end && t.start < stop)
  return { name: part[0].value, tokens: body, expression: source.slice(start, comma?.start ?? stop).trim(), offset: body[0].start }
 })
 if (parts.length > 512) fail('M query exceeds the 512 step bound.')
 return { parts, result: tokens.slice(end + 1) }
}

export function sectionQueries(source: string, defaultName: string): MPart[] {
 const tokens = tokenizeM(source)
 if (!tokens.length) fail('M source is empty.')
 let header = 0
 if (tokens[0]?.kind === 'symbol' && tokens[0].value === '[') {
  let depth = 0
  for (; header < tokens.length; header++) { if (tokens[header].kind === 'symbol' && tokens[header].value === '[') depth++; if (tokens[header].kind === 'symbol' && tokens[header].value === ']' && --depth === 0) { header++; break } }
 }
 if (tokens[header]?.kind !== 'id' || tokens[header].quoted || tokens[header].value !== 'section') return [{ name: defaultName, tokens, expression: source, offset: tokens[0].start }]
 const statements = splitM(tokens.slice(header), ';')
 if (statements[0].length !== 2 || statements[0][1].kind !== 'id') fail('M section requires an identifier and semicolon.')
 const section = statements.shift()![1].value
 if (statements.at(-1)?.length) fail('M section member requires a closing semicolon.')
 statements.pop()
 if (statements.length > 512) fail('M section exceeds the 512 query bound.')
 return statements.map((statement, index) => {
  let start = 0
  if (statement[0]?.kind === 'symbol' && statement[0].value === '[') {
   let depth = 0
   for (; start < statement.length; start++) { const value = statement[start].value; if (statement[start].kind === 'symbol' && value === '[') depth++; if (statement[start].kind === 'symbol' && value === ']' && --depth === 0) { start++; break } }
  }
  const shared = statement[start]?.kind === 'id' && !statement[start].quoted && statement[start].value === 'shared'; if (shared) start++
  const name = statement[start], equal = statement[start + 1]
  if (identifier(statement.slice(start, start + 1)) === null || equal?.kind !== 'symbol' || equal?.value !== '=' || !statement[start + 2]) fail(`Invalid M section member ${index + 1}.`)
  const body = statement.slice(start + 2)
  return { name: name.value, tokens: body, expression: source.slice(equal.end, tokens.find(t => t.kind === 'symbol' && t.value === ';' && t.start >= body.at(-1)!.end)?.start ?? body.at(-1)!.end).trim(), offset: body[0].start, metadata: { section, shared, sectionAttributes: tokenText(tokens.slice(0, header), source), attributes: tokenText(statement.slice(0, shared ? start - 1 : start), source) } }
 })
}
