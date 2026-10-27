import { fail } from '../query/types'

export type InputColumn = {
 name: string
 label: string
 type: 'money' | 'text' | 'date' | 'boolean'
 currency?: 'USD'
 scale?: 2
 maxLength?: number
}
export type InputSchema = {
 format: 1
 template: 'forecast-adjustment' | 'light-target' | 'note-only' | 'analytical-correction' | 'custom'
 columns: InputColumn[]
 effect: null | { kind: 'adjustment' | 'target' | 'correction'; column: string; activeColumn: string }
}

const reserved = new Set([
 'rowkey', 'previousversion', 'schemarevision', 'schemaversion', 'previousschemaversion',
 'previousschemarevision', 'id', 'name', 'dataset', 'sourcerevision', 'keycolumn',
 'regioncolumn', 'region', 'observedcolumn', 'schema', 'template', 'format', 'columns',
 'effect', 'definition', 'values', 'version', 'observed', 'adjusted', 'targetvariance',
 'revieweddigest', 'constructor', 'prototype', '__proto__',
])
const templates = new Set(['forecast-adjustment', 'light-target', 'note-only', 'analytical-correction', 'custom'])
const kinds = new Set(['adjustment', 'target', 'correction'])
function invalid(): never { return fail('invalid_input_schema', 400) }
function object(value: unknown): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
 const prototype = Object.getPrototypeOf(value)
 if (prototype !== Object.prototype && prototype !== null) invalid()
 return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, expected: string[]): void {
 const actual = Object.keys(value)
 if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) invalid()
}
function columnName(value: unknown): string {
 if (typeof value !== 'string' || !/^[a-z][A-Za-z0-9_]{0,63}$/.test(value) || reserved.has(value.toLowerCase())) invalid()
 return value
}
function column(raw: unknown): InputColumn {
 const value = object(raw)
 const name = columnName(value.name)
 if (typeof value.label !== 'string' || !value.label.trim() || value.label.length > 80 || /[\u0000-\u001f\u007f]/.test(value.label)) invalid()
 const label = value.label
 if (value.type === 'money') {
  keys(value, ['name', 'label', 'type', 'currency', 'scale'])
  if (value.currency !== 'USD' || value.scale !== 2) invalid()
  return { name, label, type: 'money', currency: 'USD', scale: 2 }
 }
 if (value.type === 'text') {
  keys(value, ['name', 'label', 'type', 'maxLength'])
  if (typeof value.maxLength !== 'number' || !Number.isInteger(value.maxLength) || value.maxLength < 1 || value.maxLength > 1000) invalid()
  return { name, label, type: 'text', maxLength: value.maxLength }
 }
 keys(value, ['name', 'label', 'type'])
 if (value.type !== 'date' && value.type !== 'boolean') invalid()
 return { name, label, type: value.type }
}

export function parseSchema(raw: unknown): InputSchema {
 const value = object(raw)
 keys(value, ['format', 'template', 'columns', 'effect'])
 if (value.format !== 1 || typeof value.template !== 'string' || !templates.has(value.template)) invalid()
 if (!Array.isArray(value.columns) || value.columns.length < 1 || value.columns.length > 8) invalid()
 const columns = value.columns.map(column)
 if (new Set(columns.map(c => c.name.toLowerCase())).size !== columns.length) invalid()
 let effect: InputSchema['effect'] = null
 if (value.effect !== null) {
  const rawEffect = object(value.effect)
  keys(rawEffect, ['kind', 'column', 'activeColumn'])
  if (typeof rawEffect.kind !== 'string' || !kinds.has(rawEffect.kind)) invalid()
  const amount = columnName(rawEffect.column), active = columnName(rawEffect.activeColumn)
  if (!columns.some(c => c.name === amount && c.type === 'money') || !columns.some(c => c.name === active && c.type === 'boolean')) invalid()
  effect = { kind: rawEffect.kind as NonNullable<InputSchema['effect']>['kind'], column: amount, activeColumn: active }
 }
 const template = value.template as InputSchema['template']
 if (template !== 'custom') {
  const amount = template === 'forecast-adjustment' ? 'adjustment' : template === 'light-target' ? 'target' : 'correction'
  if (!columns.some(c => c.name === 'note' && c.type === 'text')) invalid()
  if (template === 'note-only') {
   if (effect !== null) invalid()
  } else if (effect?.kind !== amount || effect.column !== amount || effect.activeColumn !== 'active' || !columns.some(c => c.name === 'effectiveOn' && c.type === 'date')) invalid()
 }
 return { format: 1, template, columns, effect }
}

export function money(value: unknown): string {
 if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d{0,13})\.\d{2}$/.test(value)) fail('USD_two_decimal_places_required', 400)
 return value === '-0.00' ? '0.00' : value
}
export function cents(value: string): bigint { return BigInt(money(value).replace('.', '')) }
export function decimal(value: bigint): string {
 const absolute = value < 0n ? -value : value
 return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}
function date(value: unknown): string {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('valid_effective_date_required', 400)
 const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10))
 const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
 const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
 if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) fail('valid_effective_date_required', 400)
 return value
}

export function parseValues(schema: InputSchema, raw: Record<string, unknown>, form = false): Record<string, string | boolean> {
 const value = object(raw), expected = schema.columns.map(c => c.name)
 if (Object.keys(value).length !== expected.length || Object.keys(value).some(key => !expected.includes(key))) fail('input_column_values_required', 400)
 const result: Record<string, string | boolean> = {}
 for (const column of schema.columns) {
  const cell = value[column.name]
  switch (column.type) {
   case 'money': result[column.name] = money(cell); break
   case 'date': result[column.name] = date(cell); break
   case 'boolean':
    if (form ? cell !== 'true' && cell !== 'false' : typeof cell !== 'boolean') fail('boolean_active_required', 400)
    result[column.name] = cell === true || cell === 'true'
    break
   case 'text':
    if (typeof cell !== 'string' || !cell.trim() || cell.length > column.maxLength!) fail('input_text_required', 400)
    result[column.name] = cell
  }
 }
 return result
}

export function validateSchemaChange(before: InputSchema, after: InputSchema): void {
 const previous = parseSchema(before), next = parseSchema(after)
 const sameEffect = previous.effect === null ? next.effect === null : next.effect !== null && previous.effect.kind === next.effect.kind && previous.effect.column === next.effect.column && previous.effect.activeColumn === next.effect.activeColumn
 if (previous.template !== next.template || !sameEffect || previous.columns.some(column => !next.columns.some(candidate => candidate.name === column.name && candidate.type === column.type))) fail('unsafe_input_schema_change', 409)
}
