import type { FlowFile, FlowStep, SourceFlow } from './types'
import { prepExpressions, prepMetadata, prepObject } from './prep-json'

const inputTypes = new Set(['.v1.LoadCsv', '.v1.LoadExcel', '.v1.LoadSql'])
const structural = new Set(['id', 'name', 'nodeType', 'baseType', 'connectionId', 'nextNodes', 'fields'])
const outputFields = new Set(['outputFile', 'filename', 'datasourceName', 'projectName', 'tableName', 'dbName', 'schema', 'outputType'])
const documentFields = new Set(['nodes', 'initialNodes', 'connections', 'dataConnections', 'parameters', 'majorVersion', 'minorVersion', 'documentId'])
const pointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1')
const string = (value: unknown): string | undefined => typeof value === 'string' && value.length ? value : undefined

function unsupported(file: FlowFile, reason: string): SourceFlow {
 const id = `${file.path}#document`
 return { id: file.path, name: file.path, file: file.path, result: id,
  steps: [{ id, name: 'Flow document', file: file.path, location: '/', sourceExpression: '', dependencies: [], reason }] }
}

function readDocument(file: FlowFile, document: Record<string, unknown>): SourceFlow[] {
 const nodes = prepObject(document.nodes)
 if (!nodes) return [unsupported(file, 'Tableau Prep nodes must be an object map.')]
 const expressions = prepExpressions(file.content)
 const entries = Object.entries(nodes)
 const aliases = new Map<string, string>()
 const byId = new Map<string, Record<string, unknown>>()
 const identities = entries.map(([key, raw]) => string(prepObject(raw)?.id) ?? key)
 entries.forEach(([key, raw], index) => {
  aliases.set(key, identities[index]); aliases.set(identities[index], identities[index])
  byId.set(identities[index], prepObject(raw) ?? {})
 })
 const dependencies = new Map<string, string[]>()
 const reasons = new Map<string, string[]>()
 const issue = (id: string, message: string) => reasons.set(id, [...reasons.get(id) ?? [], message])
 const global: string[] = []
 const connectionConfiguration: Record<string, unknown> = {}
 const unknown = Object.keys(document).filter(key => !documentFields.has(key))
 if (unknown.length) global.push(`Unsupported Tableau Prep document configuration: ${unknown.join(', ')}.`)
 if (document.initialNodes !== undefined && (!Array.isArray(document.initialNodes) || document.initialNodes.some(id => typeof id !== 'string' || !aliases.has(id)))) {
  global.push('Tableau Prep initialNodes contains invalid or missing node references.')
 }
 for (const key of ['connections', 'dataConnections']) {
  if (document[key] !== undefined && !prepObject(document[key])) global.push(`Tableau Prep ${key} must be an object map.`)
  for (const [id, raw] of Object.entries(prepObject(document[key]) ?? {})) {
   const config = Object.fromEntries(Object.entries(prepObject(raw) ?? {}).filter(([field]) => /privacy|incremental/i.test(field)))
   if (Object.keys(config).length) {
    connectionConfiguration[`${key}/${id}`] = prepMetadata(config)
    global.push(`Tableau Prep connection ${id} privacy or incremental configuration is retained but unsupported.`)
   }
  }
 }
 if (document.parameters !== undefined && JSON.stringify(document.parameters) !== '{}' && JSON.stringify(document.parameters) !== '{"parameters":{}}') {
  global.push('Tableau Prep parameter configuration is retained but parameter semantics are unsupported.')
 }
 const missing = new Map<string, string[]>()
 entries.forEach(([key, raw], index) => {
  const id = identities[index]
  const node = prepObject(raw)
  if (identities.indexOf(id) !== index) issue(id, `Duplicate Tableau Prep node id ${id}.`)
  if (!node) { issue(id, `Tableau Prep node ${key} must be an object.`); return }
  if (node.nextNodes !== undefined && !Array.isArray(node.nextNodes)) {
   issue(id, 'Tableau Prep nextNodes must be an array.'); return
  }
  for (const rawEdge of Array.isArray(node.nextNodes) ? node.nextNodes : []) {
   const edge = prepObject(rawEdge)
   const target = string(edge?.nextNodeId)
   if (!edge || !target) { issue(id, 'Tableau Prep edge is missing nextNodeId.'); continue }
   if (Object.keys(edge).some(field => !['nextNodeId', 'namespace', 'nextNamespace'].includes(field)) || edge.namespace || edge.nextNamespace) {
    issue(id, 'Tableau Prep edge namespace or additional configuration is unsupported.')
   }
   const resolved = aliases.get(target)
   if (!resolved) {
    missing.set(target, [...missing.get(target) ?? [], id])
    issue(id, `Tableau Prep edge references missing node ${target}.`)
   } else dependencies.set(resolved, [...new Set([...dependencies.get(resolved) ?? [], id])])
  }
 })
 const visited = new Set<string>()
 const active = new Set<string>()
 const visit = (id: string): void => {
  if (active.has(id)) { issue(id, 'Tableau Prep cyclic dependencies are unsupported.'); return }
  if (visited.has(id)) return
  active.add(id)
  for (const dependency of dependencies.get(id) ?? []) visit(dependency)
  active.delete(id); visited.add(id)
 }
 identities.forEach(visit)
 const steps: FlowStep[] = entries.map(([key, raw], index) => {
  const node = prepObject(raw) ?? {}
  const id = identities[index]
  const type = string(node.nodeType)
  const name = string(node.name) ?? id
  const location = `/nodes/${pointer(key)}`
  const step: FlowStep = { id, name, file: file.path, location,
   sourceExpression: expressions.get(location)!, dependencies: dependencies.get(id) ?? [],
   metadata: { nodeType: prepMetadata(node.nodeType ?? null), baseType: prepMetadata(node.baseType ?? null),
    inactiveReferences: typeof node.connectionId === 'string' ? [node.connectionId] : [],
    configuration: prepMetadata(Object.fromEntries(Object.entries(node).filter(([field]) => !structural.has(field)))),
    ...(node.fields === undefined ? {} : { fields: prepMetadata(node.fields) }) } }
  const nodeIssues = [...global, ...reasons.get(id) ?? []]
  for (const field of ['id', 'name', 'nodeType', 'baseType', 'connectionId']) {
   if (node[field] !== undefined && !string(node[field])) nodeIssues.push(`Tableau Prep ${field} must be a nonempty string.`)
  }
  if (node.fields !== undefined && (!Array.isArray(node.fields) || node.fields.some(field => {
   const schema = prepObject(field)
   return !schema || Object.keys(schema).some(key => !['name', 'type'].includes(key)) ||
    Object.values(schema).some(value => typeof value !== 'string')
  }))) nodeIssues.push('Tableau Prep fields contains unsupported field configuration.')
  const extra = Object.keys(node).filter(field => !structural.has(field) && !(type === '.v1.PublishExtract' && outputFields.has(field)))
  if (extra.length) nodeIssues.push(`Unsupported Tableau Prep node configuration: ${extra.join(', ')}.`)
  if (inputTypes.has(type ?? '')) {
   if (!string(node.name)) nodeIssues.push('Tableau Prep input requires an explicit node name for source binding.')
   else {step.binding = node.name as string;step.operations=[]}
   if (step.dependencies.length) nodeIssues.push('Tableau Prep input with upstream dependencies is unsupported.')
  } else if (type === '.v1.PublishExtract') {
   if (step.dependencies.length !== 1) nodeIssues.push('Tableau Prep extract output requires exactly one upstream step.')
   if (Array.isArray(node.nextNodes) && node.nextNodes.length) nodeIssues.push('Tableau Prep extract output must be terminal.')
   else step.operations = []
  } else nodeIssues.push(`Unsupported Tableau Prep node type ${type ?? '(missing)'}.`)
  if (nodeIssues.length) step.reason = nodeIssues.join(' ')
  return step
 })
 for (const [id, parents] of missing) {
  steps.push({ id, name: id, file: file.path, location: '/nodes', sourceExpression: '', dependencies: parents,
   reason: `Tableau Prep node ${id} is referenced but absent from the document.` })
 }
 if (!steps.length) return [unsupported(file, 'Tableau Prep document contains no nodes.')]
 const outputs = steps.filter(step => byId.get(step.id)?.baseType === 'output' || byId.get(step.id)?.nodeType === '.v1.PublishExtract')
 const terminal = outputs.length ? outputs : steps.filter(step => !steps.some(candidate => candidate.dependencies.includes(step.id)))
 const results = terminal.length ? terminal : [steps[steps.length - 1]]
 if (!terminal.length) steps.forEach(step => { step.reason = `${step.reason ?? ''} Tableau Prep flow has no terminal result.`.trim() })
 const inactiveReferences = [...new Set([
  ...Object.keys(prepObject(document.connections) ?? {}), ...Object.keys(prepObject(document.dataConnections) ?? {}),
  ...entries.flatMap(([, raw]) => { const id = string(prepObject(raw)?.connectionId); return id ? [id] : [] }),
 ])]
 const metadata = {
  format: 'prep', documentId: document.documentId ?? null, majorVersion: document.majorVersion ?? null,
  minorVersion: document.minorVersion ?? null, initialNodes: document.initialNodes ?? [], inactiveReferences,
  parameters: prepMetadata(document.parameters ?? {}),
  connectionConfiguration,
  configuration: prepMetadata(Object.fromEntries(Object.entries(document).filter(([key]) => !documentFields.has(key)))),
  outboundWrites: false,
 }
 return results.map(result => ({ id: `${file.path}#${result.id}`, name: result.name, file: file.path, result: result.id,
  steps, metadata }))
}

/** Reads inert topology only. Tableau's published schema documents node types,
 * but no transform payload schema, so transforms remain explicit obligations.
 * https://github.com/tableau/tableau-mcp/blob/main/src/sdks/tableau/types/flowDocument.ts */
export function readPrep(files: FlowFile[]): SourceFlow[] {
 return files.flatMap(file => {
  const candidate = /(?:^|\/)flow(?:\.json)?$|\.tflx?$/i.test(file.path)
  let parsed: unknown
  try { parsed = JSON.parse(file.content) }
  catch { return candidate ? [unsupported(file, 'Tableau Prep flow document is not valid JSON; packaged flows must be decoded before reading.')] : [] }
  const document = prepObject(parsed)
  if (!candidate && (!/\.json$/i.test(file.path) || !document || !('nodes' in document))) return []
  if(!document)return [unsupported(file, 'Tableau Prep flow document must be an object.')]
  try{return readDocument(file,document)}catch{return [unsupported(file,'Tableau Prep JSON has duplicate properties or exceeds bounded nesting and item counts.')]}
 })
}
