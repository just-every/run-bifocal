import { JSON_SCHEMA, load } from 'js-yaml'
import { DOMParser } from '@xmldom/xmldom'
import { digest, object, text, type InventoryItem } from '../compile'
import { fail } from '../../../query/types'

export const sigmaSchema = { schemaVersion: 1, apiVersion: '2.0.0+20261030.dcddc69', beta: true } as const
export type Issue = { location: string; element: string | null; code: 'absent_evidence' | 'unsupported_construct'; reason: string; blocksPreview: boolean }
export type SigmaCode = { filename: string; content: string }
export type SigmaRead = { schema: typeof sigmaSchema; document: Record<string, unknown>; contents: Record<string, unknown>; items: InventoryItem[]; issues: Issue[]; pageElements: Record<string, string[]> }
export const stableId = (kind: string, id: string) => 'sigma-' + digest([kind, id]).slice(0, 32)
export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const rows = (v: unknown): Record<string, unknown>[] => Array.isArray(v) && v.every(record) ? v : []
export function codeValue(content: string): Record<string, unknown> {
 if (/(^|[\s,[{])[*&][A-Za-z0-9_-]+/m.test(content)) fail('sigma_yaml_alias_forbidden', 400)
 let depth = 0, value: unknown
 try { value = load(content, { schema: JSON_SCHEMA, listener(event) { if (event === 'open' && ++depth > 48) throw Error('depth'); if (event === 'close') depth-- } }) } catch { fail('sigma_data_document_required', 400) }
 if (!record(value)) fail('sigma_workbook_mapping_required', 400)
 return value
}
export function readSigma(value: unknown): SigmaRead {
 const code = object(value)
 if (Object.keys(code).some(k => !['filename', 'content'].includes(k)) || !/^[^/\\]+\.(json|ya?ml)$/i.test(text(code.filename, 128))) fail('sigma_original_file_required', 400)
 const document = codeValue(text(code.content, 48000)), contents = record(document.contents) ? document.contents : document
 if (contents.schemaVersion !== 1 || contents.kind !== 'workbook') fail('sigma_beta_schema_unsupported', 400)
 if (!Array.isArray(contents.pages) || !contents.pages.every(record) || !Array.isArray(contents.elements) || !contents.elements.every(record) || contents.pages.length > 24 || contents.elements.length > 60) fail('sigma_bounded_workbook_required', 400)
 const items: InventoryItem[] = [], issues: Issue[] = [], pageElements: Record<string, string[]> = {}
 const problem = (location: string, element: string | null, code: Issue['code'], reason: string, blocksPreview = true) => issues.push({ location, element, code, reason, blocksPreview })
 const unknown = (v: Record<string, unknown>, allowed: string[], location: string, element: string | null, blocksPreview = true) => { for (const key of Object.keys(v)) if (!allowed.includes(key)) problem(location + '.' + key, element, 'unsupported_construct', 'Property retained without a native translation.', blocksPreview) }
 const inventory = (id: string, kind: string, original: unknown, gap: string) => {
  const encoded = JSON.stringify(original)
  if (encoded.length > 8192) fail('sigma_element_too_large', 413)
  items.push({ id, kind, sourceRevision: digest(original), original: encoded, mapping: 'Inactive Sigma workbook code; native drafts require separate explicit review.', gap })
 }
 if (contents !== document) {
  unknown(document, ['workbookId', 'workbookUrlId', 'name', 'url', 'path', 'latestVersion', 'ownerId', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt', 'contents', 'documentVersion'], 'document', null)
  for (const key of ['workbookId', 'documentVersion', 'latestVersion']) if (document[key] === undefined) problem('document.' + key, null, 'absent_evidence', 'Original document metadata was not supplied.', false)
 } else problem('document.versions', null, 'absent_evidence', 'Bare workbook code supplies no document version or ownership history.', false)
 unknown(contents, ['schemaVersion', 'kind', 'pages', 'elements', 'layout'], 'contents', null)
 const metadata = Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'contents' && (contents !== document || !['pages', 'elements', 'layout'].includes(key))))
 inventory(stableId('workbook', String(document.workbookId ?? 'code')), 'folder', metadata, 'Code contains no source rows, input history, sharing proof or source reconciliation.')
 const ids = new Set<string>()
 for (const [index, page] of rows(contents.pages).entries()) {
  const id = text(page.id, 200); if (!id || ids.has('page:' + id)) fail('sigma_duplicate_page_id', 400); ids.add('page:' + id)
  unknown(page, ['id', 'name'], 'pages[' + index + ']', null, false)
  pageElements[id] = []
  inventory(stableId('page', id), 'dashboard', page, 'Page layout and report fidelity remain unproved.')
 }
 for (const [index, element] of rows(contents.elements).entries()) {
  const id = text(element.id, 200); if (!id || ids.has('element:' + id)) fail('sigma_duplicate_element_id', 400); ids.add('element:' + id)
  const at = 'elements[' + index + ']', kind = String(element.kind)
  const common = ['id', 'kind', 'name', 'description', 'actions']
  const fields = kind === 'table' ? ['columns', 'source', 'groupings'] : kind === 'control' ? ['controlId', 'controlType', 'filters', 'mode', 'value', 'case', 'includeNulls', 'showOperators', 'source', 'min', 'max'] : kind === 'input-table' ? ['source', 'inputMode', 'columns'] : []
  unknown(element, [...common, ...fields], at, id)
  if (!['table', 'control', 'input-table'].includes(kind)) problem(at, id, 'unsupported_construct', 'Element kind ' + kind + ' is retained inactive.')
  if (kind === 'input-table') problem(at, id, 'unsupported_construct', 'Input schema and definitions only; rows, edit history, provenance and writeback are not supplied by workbook code.')
  if (element.actions !== undefined) problem(at + '.actions', id, 'unsupported_construct', 'Action definitions are inactive; no imported action executes.', false)
  if (element.source !== undefined) {
   if (!record(element.source)) problem(at + '.source', id, 'unsupported_construct', 'Source must be a documented source mapping.')
   else {
    const s = element.source
    unknown(s, s.kind === 'warehouse-table' ? ['kind', 'connectionId', 'path'] : s.kind === 'table' ? ['kind', 'elementId', 'groupingId'] : s.kind === 'sql' ? ['kind', 'connectionId', 'statement'] : s.kind === 'empty' ? ['kind', 'connectionId', 'writebackSchema'] : s.kind === 'linked' ? ['kind', 'from', 'writebackSchema'] : ['kind'], at + '.source', id)
    if (kind === 'table' && s.kind !== 'warehouse-table') problem(at + '.source', id, 'unsupported_construct', 'Only an explicitly mapped single physical warehouse table can yield a draft. SQL and dependencies never execute.')
   }
  } else if (kind === 'table') problem(at + '.source', id, 'absent_evidence', 'The original source reference is absent.')
  if (element.columns !== undefined && (!Array.isArray(element.columns) || !element.columns.every(record))) problem(at + '.columns', id, 'unsupported_construct', 'Columns must be a list of original definitions.')
  const columnIds = new Set<string>()
  for (const [n, column] of rows(element.columns).entries()) {
   if (typeof column.id !== 'string' || !column.id || columnIds.has(column.id)) fail('sigma_column_identity_required', 400)
   columnIds.add(column.id)
   unknown(column, kind === 'input-table' ? ['id', 'name', 'type'] : ['id', 'name', 'formula'], at + '.columns[' + n + ']', id)
   if (kind === 'table' && typeof column.formula !== 'string') problem(at + '.columns[' + n + '].formula', id, 'absent_evidence', 'Original column formula is absent.')
  }
  for (const [n, group] of rows(element.groupings).entries()) unknown(group, ['id', 'groupBy', 'calculations'], at + '.groupings[' + n + ']', id)
  for (const [n, filter] of rows(element.filters).entries()) {
   unknown(filter, ['source', 'columnId'], at + '.filters[' + n + ']', id)
   if (record(filter.source)) unknown(filter.source, ['kind', 'elementId'], at + '.filters[' + n + '].source', id)
  }
  inventory(stableId('element', id), kind === 'table' ? 'data' : kind === 'control' ? 'parameter' : kind === 'input-table' ? 'schema' : 'dashboard', element, issues.filter(i => i.element === id).map(i => i.reason).join(' ') || 'Original behavior requires independent reconciliation.')
 }
 // A missing filter target has unknown scope. An explicit reconstruction
 // cannot silently drop it and then preview an unrestricted native table.
 const elements=rows(contents.elements)
 for(const [index,control] of elements.entries())if(control.kind==='control'&&control.filters!==undefined){
  if(!Array.isArray(control.filters)||!control.filters.every(record))problem('elements['+index+'].filters',null,'unsupported_construct','Control filter dependencies are not a documented list.')
  else for(const [n,filter] of rows(control.filters).entries()){
   const location='elements['+index+'].filters['+n+']',source=record(filter.source)?filter.source:{}
   if(source.kind!=='table')problem(location,null,'unsupported_construct','Control source dependency requires an explicit supported table target.')
   else{
    const target=elements.find(e=>e.id===source.elementId)
    if(!target)problem(location,null,'absent_evidence','The referenced control target element was not supplied; its filter scope is unresolved.')
    else if(!rows(target.columns).some(c=>c.id===filter.columnId))problem(location,String(target.id),'absent_evidence','The referenced control target column was not supplied.')
   }
  }
 }
 if (typeof contents.layout !== 'string') problem('contents.layout', null, 'absent_evidence', 'Layout evidence is absent; page membership is unknown.', false)
 else {
  const layout = contents.layout
  if (/<!DOCTYPE|<!ENTITY/i.test(layout)) fail('sigma_xml_entity_forbidden', 400)
  let invalid = false
  const xml = new DOMParser({ onError() { invalid = true } }).parseFromString(layout, 'text/xml')
  if (invalid || !xml.documentElement) fail('sigma_layout_invalid', 400)
  for (const node of Array.from(xml.getElementsByTagName('Page'))) {
   const page = node.getAttribute('id') ?? ''
   if (!(page in pageElements)) { problem('contents.layout', null, 'unsupported_construct', 'Layout references an unknown page.', false); continue }
   for (const child of Array.from(node.getElementsByTagName('Element'))) {
    const id = child.getAttribute('elementId') ?? ''
    if (!ids.has('element:' + id)) problem('contents.layout', null, 'unsupported_construct', 'Layout references an unknown element.', false)
    else pageElements[page].push(id)
   }
  }
  inventory(stableId('layout', 'workbook'), 'dashboard', layout, 'Original XML retained as data; complete layout fidelity is not claimed.')
 }
 return { schema: sigmaSchema, document, contents, items, issues, pageElements }
}
