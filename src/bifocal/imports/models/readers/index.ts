import { issue } from './common'
import { readLookML } from './lookml'
import { readSemanticYAML } from './semantic-yaml'
import { readCube } from './cube'
import { readTMDL } from './tmdl'
import { readDBT } from './dbt'
import { readPBIP } from './pbip'
import { readMetabase } from './metabase'
import { readTableau } from './tableau'
import type { Project, ProjectFile, ProjectFormat } from './types'
export type * from './types'

export function readProject(format: ProjectFormat, files: ProjectFile[]): Project {
 const p: Project = {format, tables: [], explores: [], issues: []}
 const at = {file: '', sourceExpression: ''}
 if (!['lookml','dbt','metricflow','tmdl','pbip','cube','metabase','tableau'].includes(format)) { issue(p, at, 'project', 'unsupported_format', 'Choose LookML, dbt, MetricFlow, PBIP, TMDL, Cube YAML, Metabase or Tableau.'); return p }
 if (!Array.isArray(files) || !files.length || files.length > 64) { issue(p, at, 'project', 'bounded_files_required', 'Supply between one and 64 files.'); return p }
 let bytes = 0
 const paths = new Set<string>()
 for (const file of files) {
  if (!file || typeof file.path !== 'string' || typeof file.content !== 'string' || file.path.length > 240 || !file.path || file.path.startsWith('/') || file.path.includes('\\') || file.path.split('/').some(part => !part || part === '..' || part === '.') || /[\u0000-\u001f]/.test(file.path) || paths.has(file.path)) { issue(p, at, 'project', 'invalid_project_path', 'Use unique relative file paths without traversal.'); return p }
  paths.add(file.path); const size = new TextEncoder().encode(file.content).length; bytes += size
  if (size > 262144 || bytes > 1048576 || file.content.includes('\0')) { issue(p, {...at,file:file.path}, 'project', 'project_limit', 'Each file is limited to 256 KiB; the complete project to 1 MiB; NUL is forbidden.'); return p }
 }
 const reader = format === 'lookml' ? readLookML : format === 'cube' ? readCube : format === 'tmdl' ? readTMDL : format === 'pbip' ? readPBIP : format === 'dbt' ? readDBT : format === 'metabase' ? readMetabase : format === 'tableau' ? readTableau : readSemanticYAML
 reader(p, files)
 if (!p.tables.length) issue(p, at, 'project', 'no_model_tables', 'No supported model table was found; implement or correct the reported source constructs.')
 for (const group of [p.tables, p.explores]) {
  const names = new Set<string>()
  for (const object of group) { if (names.has(object.name)) issue(p, object, object.name, 'duplicate_object', 'Resolve duplicate object declarations.'); names.add(object.name) }
 }
 for (const table of p.tables) {
  const names = new Set<string>()
  for (const field of [...table.dimensions,...table.measures]) { if (names.has(field.name)) issue(p, field, `${table.name}.${field.name}`, 'duplicate_field', 'Field names must be unique within a table.'); names.add(field.name) }
 }
 for (const explore of p.explores) {
  if (!p.tables.some(t => t.name === explore.table)) issue(p, explore, explore.name, 'missing_table', `Include table ${explore.table}.`)
  for (const join of explore.joins) if (!p.tables.some(t => t.name === join.table)) issue(p, join, `${explore.name}.${join.name}`, 'missing_join_table', `Include joined table ${join.table}.`)
 }
 return p
}
