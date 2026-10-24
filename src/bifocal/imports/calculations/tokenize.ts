import { problem, type FormulaLanguage } from './types'
export type Token = { type: 'number' | 'string' | 'date' | 'name' | 'quoted-name' | 'reference' | 'symbol' | 'end'; value: string; start: number; end: number }
/** Only data is recognized. Unknown punctuation, external references and code
 * syntax stop translation; no substring is executed or sent to a provider. */
export function tokenize(source: string, language: FormulaLanguage): Token[] {
 if (typeof source !== 'string' || !source.trim() || source.length > 65536) problem('formula_size', 'Supply a formula between 1 and 65,536 characters.')
 const result: Token[] = []; let i = 0
 function push(type: Token['type'], value: string, start: number) { if (result.length >= 4096) problem('formula_token_limit', 'The formula exceeds 4,096 tokens.'); result.push({ type, value, start, end: i }) }
 while (i < source.length) {
  if (/\s/.test(source[i])) { i++; continue }
  if (language !== 'excel' && source.slice(i, i + 2) === '//') { while (i < source.length && source[i] !== '\n') i++; continue }
  if (language !== 'excel' && source.slice(i, i + 2) === '/*') { const end = source.indexOf('*/', i + 2); if (end < 0) problem('unclosed_comment', 'Close the formula comment.'); i = end + 2; continue }
  const start = i, char = source[i]
  if (char === '"' || char === "'") {
   if (char === "'" && language === 'excel') problem('excel_sheet_reference_gap', 'Excel strings use double quotes; quoted worksheet references need explicit cell or range binding.')
   const delimiter = char; let value = '', closed = false; i++
   while (i < source.length) { if (source[i] === delimiter) { if (source[i + 1] === delimiter) { value += delimiter; i += 2; continue }; i++; closed = true; break }; value += source[i++] }
   if (!closed) problem('unclosed_string', 'Close the quoted string or table name.')
   if (language === 'tableau' && value.includes('\\')) problem('tableau_string_escape_gap', 'Implement Tableau backslash escape decoding before translating this string.')
   push(delimiter === "'" && language === 'dax' ? 'quoted-name' : 'string', value, start); continue
  }
  if (char === '[') {
   let value = '', closed = false; i++
   while (i < source.length) { if (source[i] === ']') { if (source[i + 1] === ']') { value += ']'; i += 2; continue }; i++; closed = true; break }; value += source[i++] }
   if (!closed || !value) problem('invalid_field_reference', 'Close the bracketed field reference and supply its name.')
   push('reference', value, start); continue
  }
  if (char === '#' && language === 'tableau') {
   const end = source.indexOf('#', i + 1); if (end < 0) problem('invalid_date_literal', 'Close the Tableau date literal.')
   const value = source.slice(i + 1, end); i = end + 1
   if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) problem('date_time_gap', 'Only ISO civil date literals are translated; timestamps require timezone mapping.')
   push('date', value, start); continue
  }
  const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(i))
  if (number) { i += number[0].length; push('number', number[0], start); continue }
  const name = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(source.slice(i))
  if (name) { i += name[0].length; push('name', name[0], start); continue }
  const pair = source.slice(i, i + 2)
  if (['<=', '>=', '<>', '!=', '==', '&&', '||'].includes(pair)) { i += 2; push('symbol', pair, start); continue }
  if ('+-*/=<>(),{}:'.includes(char)) { i++; push('symbol', char, start); continue }
  problem('unsupported_token', `Translate the unsupported token at character ${i + 1} before importing.`)
 }
 result.push({ type: 'end', value: '', start: i, end: i }); return result
}
