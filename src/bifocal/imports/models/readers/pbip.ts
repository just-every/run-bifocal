import { issue, provenance, record, unknownKeys } from './common'
import { readTMDL } from './tmdl'
import type { Project, ProjectFile, ProjectResource } from './types'

// Resolve descriptor references against the uploaded project only. No path is
// opened on disk and no connection, URL or remote model is contacted.
function resolve(base: string, relative: unknown): string | null {
 if (typeof relative !== 'string' || !relative || relative.startsWith('/') || relative.includes('\\') || /[:\u0000-\u001f]/.test(relative)) return null
 const parts = base.split('/').slice(0, -1)
 for (const part of relative.split('/')) {
  if (part === '..') { if (!parts.length) return null; parts.pop() }
  else if (part !== '.') { if (!part) return null; parts.push(part) }
 }
 return parts.length ? parts.join('/') : null
}

export function readPBIP(p: Project, files: ProjectFile[]) {
 const resources: ProjectResource[] = [], tmdl: ProjectFile[] = [], described = new Set<string>(), modelRoots = new Set<string>()
 const descriptors = files.filter(f => /\.pbip$/i.test(f.path))
 if (descriptors.length !== 1) issue(p, {file: '', sourceExpression: ''}, 'project', 'pbip_descriptor_required', 'Include exactly one PBIP project descriptor.')
 const read = (file: ProjectFile) => {
  try { const value: unknown = JSON.parse(file.content); if (record(value)) return value } catch { /* diagnostic below */ }
  issue(p, provenance(file, file.content), file.path, 'invalid_pbip_json', 'Supply a JSON object descriptor.'); return null
 }
 const resource = (file: ProjectFile, kind: string, definition: Record<string, unknown>, dependencies: string[]) => {
  described.add(file.path); resources.push({...provenance(file, definition), id: file.path, name: file.path, kind, definition, dependencies})
 }
 for (const file of descriptors) {
  const value = read(file); if (!value) continue
  const at = provenance(file, value)
  unknownKeys(p, at, file.path, value, ['$schema','version','artifacts','settings'])
  if (value.version !== '1.0' || !Array.isArray(value.artifacts) || !value.artifacts.length) { issue(p, at, file.path, 'unsupported_pbip_descriptor', 'Supply a version 1.0 project with report artifacts.'); continue }
  const dependencies: string[] = []
  for (const artifact of value.artifacts) {
   if (!record(artifact) || !record(artifact.report) || Object.keys(artifact).some(k => k !== 'report')) { issue(p, at, file.path, 'unsupported_pbip_artifact', 'Only explicit report artifact paths are recognized.'); continue }
   unknownKeys(p, at, file.path, artifact.report, ['path'])
   const path = resolve(file.path, artifact.report.path), reportPath = path && path + '/definition.pbir'
   if (!reportPath) { issue(p, at, file.path, 'unsafe_pbip_path', 'Keep descriptor paths inside the uploaded project.'); continue }
   dependencies.push(reportPath)
  }
  resource(file, 'pbip-project', value, dependencies)
 }
 for (const file of files.filter(f => /(?:^|\/)definition\.pbir$/i.test(f.path))) {
  const value = read(file); if (!value) continue
  const at = provenance(file, value)
  unknownKeys(p, at, file.path, value, ['$schema','version','datasetReference'])
  const reference = value.datasetReference, dependencies: string[] = []
  if (!['1.0','4.0'].includes(String(value.version)) || !record(reference)) issue(p, at, file.path, 'unsupported_pbir_descriptor', 'Include a supported report descriptor and dataset reference.')
  else {
   unknownKeys(p, at, file.path, reference, ['byPath'])
   if (!record(reference.byPath)) issue(p, at, file.path, 'pbip_local_model_required', 'Upload the referenced local semantic model. Live connection references are inactive and never fetched.')
   else {
    unknownKeys(p, at, file.path, reference.byPath, ['path'])
    const path = resolve(file.path, reference.byPath.path)
    if (!path) issue(p, at, file.path, 'unsafe_pbip_path', 'Keep model references inside the uploaded project.')
    else { dependencies.push(path + '/definition.pbism'); modelRoots.add(path) }
   }
  }
  resource(file, 'pbip-report', value, dependencies)
  issue(p, at, file.path, 'pbip_report_translation_pending', 'The report reference is retained. Report layout and interaction equivalence require separate translation; this project is not fully compatible.')
 }
 for (const file of files.filter(f => /(?:^|\/)definition\.pbism$/i.test(f.path))) {
  const value = read(file); if (!value) continue
  const at = provenance(file, value)
  unknownKeys(p, at, file.path, value, ['$schema','version','settings'])
  if (!['1.0','4.0'].includes(String(value.version))) issue(p, at, file.path, 'unsupported_pbism_version', 'Only version 1.0 and 4.0 semantic model descriptors are recognized.')
  const root = file.path.slice(0, -'/definition.pbism'.length)
  const definitions = files.filter(f => f.path.startsWith(root + '/definition/') && /\.tmdl$/i.test(f.path))
  resource(file, 'pbip-model', value, definitions.map(f => f.path))
  if (!modelRoots.has(root)) issue(p, at, file.path, 'unreferenced_pbip_model', 'The uploaded project must explicitly reference this semantic model.')
  if (!definitions.length) issue(p, at, file.path, 'pbip_tmdl_required', 'Include the referenced textual TMDL definitions; binary models are unsupported.')
 }
 for (const file of files) {
  if (/\.tmdl$/i.test(file.path)) {
   const parent = resources.find(r => r.kind === 'pbip-model' && r.dependencies.includes(file.path))
   if (!parent) { issue(p, provenance(file, file.content), file.path, 'unreferenced_tmdl', 'Include the semantic model descriptor that owns this TMDL file.'); continue }
   resource(file, 'tmdl-definition', {source: file.content}, [])
   tmdl.push(file)
  } else if (!described.has(file.path)) issue(p, provenance(file, file.content), file.path, 'unsupported_pbip_file', 'This source item is retained but requires explicit translation before project equivalence can be claimed.')
 }
 readTMDL(p, tmdl)
 for (const item of resources) for (const dependency of item.dependencies) if (!described.has(dependency)) issue(p, item, item.id, 'missing_pbip_dependency', `Include ${dependency}; no remote file is fetched.`)
 p.resources = resources
}
