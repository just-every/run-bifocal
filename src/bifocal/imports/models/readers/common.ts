import { JSON_SCHEMA, load } from 'js-yaml'
import type { Project, ProjectFile, Provenance } from './types'

export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const text = (v: unknown): string|null => typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
export const physical = (v: unknown): string|null => typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_$]*$/.test(v.trim()) ? v.trim() : null
export const tableName = (v: unknown): string|null => typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*){0,3}$/.test(v.trim()) ? v.trim() : null
export const expression = (v: unknown): string => typeof v === 'string' ? v : JSON.stringify(v) ?? String(v)
export function issue(p: Project, at: Provenance, object: string, code: string, message: string, source: unknown = at.sourceExpression) {
 p.issues.push({file: at.file, sourceExpression: expression(source), object, code, message})
}
export function unknownKeys(p: Project, at: Provenance, object: string, value: Record<string, unknown>, allowed: string[]) {
 for (const key of Object.keys(value)) if (!allowed.includes(key)) issue(p, at, `${object}.${key}`, 'unsupported_property', `Implement property ${key} before importing this object.`, value[key])
}
export function objects(p: Project, at: Provenance, object: string, value: unknown): Record<string, unknown>[] {
 if (value === undefined) return []
 if (!Array.isArray(value)) { issue(p, at, object, 'list_required', 'Expected a list of named objects.', value); return [] }
 return value.filter((item, i): item is Record<string, unknown> => {
  if (record(item)) return true
  issue(p, at, `${object}[${i}]`, 'object_required', 'Expected an object.', item); return false
 })
}
export function name(p: Project, at: Provenance, value: unknown, object: string): string|null {
 const result = text(value)
 if (!result || result.length > 200) { issue(p, at, object, 'name_required', 'Supply a nonempty name of at most 200 characters.', value); return null }
 return result
}
export function yaml(p: Project, file: ProjectFile): Record<string, unknown>|null {
 const at = {file: file.path, sourceExpression: file.content}
 // Conservative refusal includes anchors in quoted text: ambiguous input must
 // be rewritten, never expanded. No YAML aliases or custom executable tags.
 if (/(^|[\s,[{])[*&][A-Za-z0-9_-]+/m.test(file.content)) { issue(p, at, file.path, 'yaml_alias_forbidden', 'Remove YAML anchors and aliases.'); return null }
 let depth = 0
 try {
  const value = load(file.content, {schema: JSON_SCHEMA, listener(event) { if (event === 'open' && ++depth > 64) throw Error('depth'); if (event === 'close') depth-- }})
  if (!record(value)) throw Error('mapping')
  return value
 } catch { issue(p, at, file.path, 'invalid_yaml', 'Expected one data-only YAML mapping, without duplicate keys, tags or excessive nesting.'); return null }
}
export function provenance(file: ProjectFile, value: unknown): Provenance { return {file: file.path, sourceExpression: expression(value)} }
