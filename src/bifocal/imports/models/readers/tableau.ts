import { DOMParser, type Element } from '@xmldom/xmldom'
import { strFromU8, unzipSync } from 'fflate'
import { issue, provenance } from './common'
import type { Project, ProjectFile, ProjectResource } from './types'

export function readTableau(p: Project, files: ProjectFile[]) {
 const resources: ProjectResource[] = [], documents: ProjectFile[] = []
 for (const file of files) {
  const at = provenance(file, '')
  if (/\.(twb|tds)$/i.test(file.path)) { documents.push(file); continue }
  if (!/\.twbx$/i.test(file.path)) { issue(p, at, file.path, 'unsupported_tableau_file', 'Supply textual TWB or TDS definitions, or a base64 TWBX archive.'); continue }
  let bytes = 0, entries = 0, unsafe = false
  try {
   if (!/^[A-Za-z0-9+/]*={0,2}$/.test(file.content) || file.content.length % 4) throw Error('base64')
   const archive = Uint8Array.from(atob(file.content), c => c.charCodeAt(0))
   const extracted = unzipSync(archive, {filter(entry) {
    if (entry.name.endsWith('/')) return false
    bytes += entry.originalSize; entries++
    if (bytes > 1048576 || entries > 64 || entry.originalSize > 262144 || entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.split('/').some(part => !part || part === '.' || part === '..') || /[:\u0000-\u001f]/.test(entry.name)) { unsafe = true; return false }
    if (!/\.(twb|tds)$/i.test(entry.name)) { issue(p, at, entry.name, 'unsupported_tableau_archive_item', 'The original archive retains this item; extracts and other binary or script content are not loaded or translated.'); return false }
    return true
   }})
   if (unsafe) { issue(p, at, file.path, 'unsafe_tableau_archive', 'Archive paths, expanded sizes and item counts must stay within the project bounds.'); continue }
   for (const [path, content] of Object.entries(extracted)) documents.push({path: file.path + '/' + path, content: strFromU8(content)})
   if (!Object.keys(extracted).length) issue(p, at, file.path, 'tableau_definition_required', 'Include a textual workbook or data source definition in the archive.')
  } catch { issue(p, at, file.path, 'invalid_tableau_archive', 'Supply a valid bounded base64 ZIP archive; nothing is extracted to disk.') }
 }
 for (const file of documents) {
  const at = provenance(file, '')
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(file.content)) { issue(p, at, file.path, 'tableau_active_xml', 'DTD and entity declarations are refused.'); continue }
  let root: Element
  try {
   root = new DOMParser({onError: () => { throw Error('xml') }}).parseFromString(file.content, 'application' + '/' + 'xml').documentElement!
   if (!root || !['workbook','datasource'].includes(root.tagName) || root.getElementsByTagName('*').length > 10000) throw Error('root')
  } catch { issue(p, at, file.path, 'invalid_tableau_xml', 'Supply a well-formed workbook or data source with at most 10,000 elements.'); continue }
  const dataSources = root.tagName === 'datasource' ? [root] : Array.from(root.getElementsByTagName('datasource')).filter(e => e.parentNode?.nodeName === 'datasources')
  for (const ds of dataSources) {
   const name = ds.getAttribute('name'), source = provenance(file, ds.toString())
   if (!name) { issue(p, source, file.path, 'tableau_datasource_name', 'Each data source needs its original name.'); continue }
   const id = `datasource.${name}`
   if (resources.some(r => r.id === id)) issue(p, source, id, 'duplicate_tableau_datasource', 'Resolve duplicate source identities.')
   const columns = Array.from(ds.getElementsByTagName('column')).filter(e => e.parentNode === ds)
   resources.push({...source, id, name, kind: 'tableau-datasource', definition: {xml: ds.toString()}, dependencies: []})
   p.tables.push({...source, name, sourceTable: null, dimensions: [], measures: []})
   p.explores.push({...source, name, table: name, joins: []})
   for (const column of columns) {
    const columnName = column.getAttribute('name')
    if (!columnName) { issue(p, source, id, 'tableau_column_name', 'Each source column needs its original name.'); continue }
    resources.push({...provenance(file, column.toString()), id: `${id}.${columnName}`, name: columnName, kind: 'tableau-column', definition: {xml: column.toString(), calculations: Array.from(column.getElementsByTagName('calculation')).map(c => c.getAttribute('formula'))}, dependencies: [id]})
   }
   issue(p, source, id, 'tableau_source_execution_pending', 'Connections, joins, calculations, types and source restrictions are retained, but require executable translation and source equivalence. No connection or expression is evaluated.')
  }
  for (const tag of ['worksheet','dashboard','story']) for (const item of Array.from(root.getElementsByTagName(tag))) {
   const name = item.getAttribute('name') ?? '', dependencies = Array.from(item.getElementsByTagName('datasource-dependencies')).map(d => `datasource.${d.getAttribute('datasource')}`)
   const source = provenance(file, item.toString())
   resources.push({...source, id: `${tag}.${name}`, name, kind: `tableau-${tag}`, definition: {xml: item.toString()}, dependencies: [...new Set(dependencies)]})
   issue(p, source, `${tag}.${name}`, 'tableau_content_translation_pending', 'Source layout, filters and interactions are retained and are not counted as translated.')
  }
 }
 for (const resource of resources) for (const dependency of resource.dependencies) if (!resources.some(r => r.id === dependency)) issue(p, resource, resource.id, 'missing_tableau_dependency', `Include ${dependency}; no source definition is fetched.`)
 p.resources = resources
}
