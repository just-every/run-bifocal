import { canonicalJson } from '../../../../modules/import-kit/src/provenance/identity.ts'
import { definitionInput, type Definition } from '../../../models/validation/protocol'
import { queryInput } from '../../../query/validate'
import type { Filter, Measure, Query, Source } from '../../../query/types'
import { digest } from '../compile'
import { readSigma, record, rows, stableId, type Issue, type SigmaRead } from './reader'

export type SigmaDraft = { element: string; itemId: string; definition: Definition | null; issues: Issue[] }
export type SigmaProject = SigmaRead & { original: unknown; reconstruction: unknown; drafts: SigmaDraft[]; sources: { id: string; revision: string }[]; digest: string }
export function reconstructSigma(code: unknown, manifest: unknown, sources: Source[]): SigmaProject {
 const read = readSigma(code), issues = [...read.issues], drafts: SigmaDraft[] = [], used = new Map<string, string>()
 const issue = (element: string | null, location: string, reason: string, absent = false): Issue => ({ element, location, reason, code: absent ? 'absent_evidence' : 'unsupported_construct', blocksPreview: true })
 const global: Issue[] = []
 const m = record(manifest) ? manifest : {}, bindings = record(m.bindings) ? m.bindings : {}
 if (Object.keys(m).some(k => !['security', 'bindings', 'context'].includes(k))) global.push(issue(null, 'reconstruction', 'Unknown reconstruction property.'))
 if (m.security !== 'reviewed-current-native-owner-only') global.push(issue(null, 'reconstruction.security', 'Explicit current native owner review is required. Imported identities and grants confer no authority.', true))
 const elements = rows(read.contents.elements)
 for (const key of Object.keys(bindings)) if (!elements.some(e => e.kind === 'table' && e.id === key)) global.push(issue(null, 'bindings.' + key, 'Binding does not identify an original table element.'))
 for (const [elementId, raw] of Object.entries(bindings)) {
  if (!record(raw)) continue
  if (typeof raw.dataset === 'string') {
   const source = sources.find(s => s.id === raw.dataset)
   if (source) used.set(source.id, source.revision)
  }
  if (!elements.some(e => e.kind === 'table' && e.id === elementId)) continue
 }
 for (const element of elements.filter(e => e.kind === 'table')) {
  const id = String(element.id), own = [...global, ...issues.filter(i => i.blocksPreview && (i.element === id || i.element === null))]
  const add = (location: string, reason: string, absent = false) => own.push(issue(id, location, reason, absent))
  const raw = bindings[id], binding = record(raw) ? raw : {}, sourceRef = record(element.source) ? element.source : {}
  const source = sources.find(s => s.id === binding.dataset), columns = rows(element.columns)
  if (Object.keys(binding).some(k => !['dataset', 'revision', 'connectionId', 'path', 'grain', 'columns', 'groupBy', 'measures', 'controls'].includes(k))) add('bindings.' + id, 'Unknown binding property.')
  if (!source) add('bindings.' + id, 'A separately reviewed native snapshot is required.', true)
  else if (binding.revision !== source.revision) add('bindings.' + id + '.revision', 'The native source changed. Review its exact current revision again.')
  if (sourceRef.kind !== 'warehouse-table' || typeof sourceRef.connectionId !== 'string' || !Array.isArray(sourceRef.path) || !sourceRef.path.length || sourceRef.path.some(p => typeof p !== 'string') || binding.connectionId !== sourceRef.connectionId || canonicalJson(binding.path ?? null) !== canonicalJson(sourceRef.path ?? null)) add('elements.' + id + '.source', 'Explicitly match the original connection reference and complete physical path. No connection is opened.')
  const mapped = new Map<string, string>(), names = new Map<string, string[]>(), map = record(binding.columns) ? binding.columns : {}
  for (const [columnId, target] of Object.entries(map)) {
   const c = columns.find(c => c.id === columnId)
   if (!c || !record(target) || Object.keys(target).some(k => !['source', 'native'].includes(k)) || typeof target.source !== 'string' || typeof target.native !== 'string') { add('bindings.' + id + '.columns.' + columnId, 'Map an original physical column ID to an explicit source field and native field.'); continue }
   const prefix = Array.isArray(sourceRef.path) ? sourceRef.path.at(-1) : ''
   if (c.formula !== '[' + prefix + '/' + target.source + ']') { add('elements.' + id + '.columns.' + columnId, 'Only an exact qualified physical field can use a field binding.'); continue }
   if (!source?.table.columns.some(x => x.name === target.native)) { add('bindings.' + id + '.columns.' + columnId, 'The native physical field is absent.', true); continue }
   mapped.set(columnId, target.native)
   const name = typeof c.name === 'string' ? c.name : target.source
   names.set(name, [...names.get(name) ?? [], columnId])
  }
  const measures: Measure[] = [], requested = record(binding.measures) ? binding.measures : {}
  for (const c of columns) {
   if (mapped.has(String(c.id))) continue
   const formula = typeof c.formula === 'string' ? /^(Sum|CountDistinct)\(\[([^\]]+)\]\)$/i.exec(c.formula.trim()) : null
   const refs = formula ? names.get(formula[2]) ?? [] : [], format = requested[String(c.id)]
   if (!formula || refs.length !== 1 || !mapped.has(refs[0])) { add('elements.' + id + '.columns.' + c.id, 'Formula or dependency is unresolved. Only SUM and CountDistinct over one mapped sibling physical field can yield a draft.'); continue }
   if (!record(format) || Object.keys(format).some(k => !['id', 'unit', 'scale', 'sourceCurrency'].includes(k))) { add('bindings.' + id + '.measures.' + c.id, 'Supply an explicit native measure identity and exact format.', true); continue }
   measures.push({ ...format, op: formula[1].toLowerCase() === 'sum' ? 'sum' : 'count-distinct', column: mapped.get(refs[0]), ...(formula[1].toLowerCase() === 'sum' ? { empty: 'null' } : {}) } as Measure)
  }
  for (const key of Object.keys(requested)) if (!columns.some(c => c.id === key && !mapped.has(key))) add('bindings.' + id + '.measures.' + key, 'Measure mapping does not identify a source calculation.')
  const grouped = binding.groupBy
  if (!Array.isArray(grouped) || grouped.some(c => typeof c !== 'string' || !mapped.has(c))) add('bindings.' + id + '.groupBy', 'Group only by explicitly mapped physical source columns.')
  if (element.groupings !== undefined) {
   const groups = rows(element.groupings)
   if (groups.length !== 1 || canonicalJson(groups[0].groupBy ?? null) !== canonicalJson(grouped ?? null) || canonicalJson([...(Array.isArray(groups[0].calculations) ? groups[0].calculations : [])].sort()) !== canonicalJson(Object.keys(requested).sort())) add('elements.' + id + '.groupings', 'Only one exact grouping with the mapped calculations is supported.')
  }
  const filters: Filter[] = [], controls = Array.isArray(binding.controls) ? binding.controls : []
  const related = elements.filter(e => e.kind === 'control' && rows(e.filters).some(f => record(f.source) && f.source.elementId === id))
  if (!Array.isArray(binding.controls) || controls.some(c => typeof c !== 'string') || new Set(controls).size !== controls.length || related.some(c => !controls.includes(c.id)) || controls.some(c => !related.some(r => r.id === c))) add('bindings.' + id + '.controls', 'Explicitly include every control targeting this table; unknown or omitted controls block the draft.')
  for (const c of related) {
   const affected = issues.filter(i => i.element === c.id && i.blocksPreview); own.push(...affected)
   const scalar = c.controlType === 'text' && c.mode === 'equals' && c.case === 'sensitive' && typeof c.value === 'string' && c.value !== '' || c.controlType === 'number' && c.mode === '=' && typeof c.value === 'number' && Number.isSafeInteger(c.value)
   if (!scalar || !['never', 'when-no-value-is-selected'].includes(String(c.includeNulls))) { add('elements.' + c.id, 'Only an explicit nonempty case-sensitive text equality or safe integer equality is supported; null inclusion and other control modes remain unresolved.'); continue }
   for (const target of rows(c.filters)) {
    if (!record(target.source) || target.source.kind !== 'table' || target.source.elementId !== id || typeof target.columnId !== 'string' || !mapped.has(target.columnId)) { add('elements.' + c.id + '.filters', 'Control target is unresolved or crosses table dependencies.'); continue }
    filters.push({ column: mapped.get(target.columnId)!, op: 'eq', value: String(c.value) })
   }
  }
  let definition: Definition | null = null
  if (!measures.length) add('elements.' + id, 'No supported explicitly formatted calculation was supplied.', true)
  if (!Array.isArray(binding.grain) || !binding.grain.length || binding.grain.some(c => typeof c !== 'string' || !source?.table.columns.some(x => x.name === c))) add('bindings.' + id + '.grain', 'Declare the reviewed native snapshot physical grain.', true)
  if (!own.length && source) {
   try {
    const query = queryInput({ version: 1, dataset: source.id, joins: [], filters, groupBy: (grouped as string[]).map(c => mapped.get(c)), measures, context: m.context, semantic: { grain: binding.grain, dimensions: [...new Set([...mapped.values(), ...binding.grain as string[]])].map(name => ({ column: name, type: source.table.columns.find(c => c.name === name)!.type })), hierarchies: [], slowlyChanging: 'reject-duplicate-grain' } })
    definition = definitionInput({ views: [{ id: stableId('view', id), kind: 'chart', query, rowRules: [] }], quality: [] })
   } catch { add('bindings.' + id, 'The grain, format or native conventions cannot form a valid query.') }
  }
  drafts.push({ element: id, itemId: stableId('element', id), definition, issues: own })
 }
 return { ...read, original: code, reconstruction: manifest, drafts, issues: [...issues, ...global], sources: [...used].map(([id, revision]) => ({ id, revision })), digest: digest({ code, manifest }) }
}
