import type { FlowFile } from './types'

export type MDocument = { file: FlowFile; content: string; name: string; base: number; prefix: string; reason?: string; metadata?: Record<string, unknown> }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const basename = (path: string) => path.split(/[\\/]/).at(-1)!.replace(/\.[^.]+$/, '')
const document = (file: FlowFile, extra: Partial<MDocument> = {}): MDocument => ({ file, content: file.content, name: basename(file.path), base: 0, prefix: '', ...extra })
const problem = (file: FlowFile, reason: string, extra: Partial<MDocument> = {}) => document(file, { reason, ...extra })

function decodePart(payload: unknown): string {
 if (typeof payload !== 'string' || payload.length > 1400000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) throw new Error('Definition part requires bounded, canonical InlineBase64 content.')
 return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(payload), c => c.charCodeAt(0)))
}

function policyPaths(value: unknown): string[] {
 const paths: string[] = [], pending: { value: unknown; path: string; depth: number }[] = [{ value, path: '$', depth: 0 }]
 let count = 0
 while (pending.length) {
  const item = pending.pop()!
  if (++count > 10000 || item.depth > 32) { paths.push('metadata nesting exceeds reader bounds'); break }
  if (!object(item.value) && !Array.isArray(item.value)) continue
  for (const [key, child] of Object.entries(item.value)) {
   const path = item.path + '.' + key
   if (/incremental|refreshpolicy|partitionboundary|mdftransform|datadestination/i.test(key)) paths.push(path)
   else if (object(child) || Array.isArray(child)) pending.push({ value: child, path, depth: item.depth + 1 })
  }
 }
 return paths
}

function metadataDocument(file: FlowFile, metadata: unknown, prefix: string): MDocument[] {
 if (!object(metadata)) return [problem(file, 'Dataflow query metadata must be an object.', { prefix })]
 const issues: MDocument[] = [], boundaries = policyPaths(metadata)
 if (metadata.formatVersion !== '202502') issues.push(problem(file, 'Dataflow query metadata requires the documented formatVersion 202502.', { prefix }))
 if (boundaries.length) issues.push(problem(file, 'Dataflow incremental, mapping or destination configuration requires explicit native translation.', { prefix, metadata: { unsupportedMetadataPaths: boundaries } }))
 return issues
}

function gen2(file: FlowFile, value: Record<string, unknown>): MDocument[] | null {
 const definition = object(value.definition) ? value.definition : value
 if (!Array.isArray(definition.parts)) return null
 if (definition.parts.length > 128) return [problem(file, 'Dataflow definition exceeds the 128 part bound.')]
 const out: MDocument[] = [], seen = new Set<string>()
 let mashup = false, metadata = false
 for (const [index, part] of definition.parts.entries()) {
  const prefix = `$.definition.parts[${index}] decoded `
  if (!object(part) || typeof part.path !== 'string' || part.payloadType !== 'InlineBase64') { out.push(problem(file, 'Definition parts require a path and InlineBase64 payload type.', { prefix })); continue }
  if (seen.has(part.path)) { out.push(problem(file, 'Duplicate dataflow definition part path.', { prefix })); continue }
  seen.add(part.path)
  let content: string
  try { content = decodePart(part.payload) } catch (error) { out.push(problem(file, error instanceof Error ? error.message : 'Invalid definition part encoding.', { prefix })); continue }
  const virtual = { path: file.path, content }
  if (part.path === 'mashup.pq') { mashup = true; out.push(document(virtual, { prefix: prefix + 'mashup.pq ', metadata: { definitionPart: part.path } })); continue }
  if (part.path === 'queryMetadata.json') {
   metadata = true
   try { const parsed: unknown = JSON.parse(content); out.push(...metadataDocument(virtual, parsed, prefix)) } catch { out.push(problem(virtual, 'Dataflow queryMetadata.json is malformed.', { prefix })) }
   continue
  }
  if (part.path === '.platform') {
   try {
    const platform: unknown = JSON.parse(content)
    if (!object(platform) || !object(platform.metadata) || platform.metadata.type !== 'Dataflow') out.push(problem(virtual, 'Dataflow platform metadata has an unsupported item type.', { prefix }))
   } catch { out.push(problem(virtual, 'Dataflow platform metadata is malformed.', { prefix })) }
   continue
  }
  out.push(problem(virtual, 'This dataflow definition part has no faithful native translation.', { prefix, metadata: { definitionPart: part.path } }))
 }
 if (!mashup) out.push(problem(file, 'Dataflow definition is missing the required mashup.pq part.'))
 if (!metadata) out.push(problem(file, 'Dataflow definition is missing the required queryMetadata.json part.'))
 return out
}

function jsonDocuments(file: FlowFile): MDocument[] {
 let parsed: unknown
 try { parsed = JSON.parse(file.content) } catch { return [problem(file, 'Malformed JSON preparation container.') ] }
 if (!object(parsed)) return [problem(file, 'Preparation JSON container must be an object.')]
 const envelope = gen2(file, parsed)
 if (envelope) return envelope
 const mashup = parsed['pbi:mashup']
 if (object(mashup) && typeof mashup.document === 'string') {
  const paths = policyPaths(parsed), content = mashup.document
  const out = [document({ path: file.path, content }, { name: typeof parsed.name === 'string' ? parsed.name : basename(file.path), prefix: '$["pbi:mashup"].document decoded ', metadata: { container: 'dataflow-gen1', privacyAndCredentialsInactive: true } })]
  if (paths.length) out.push(problem(file, 'Dataflow incremental or destination metadata requires explicit native translation.', { metadata: { unsupportedMetadataPaths: paths } }))
  return out
 }
 return [problem(file, 'JSON has neither a Gen1 pbi:mashup.document nor a Gen2 definition.parts container.')]
}

const tmdlName = (raw: string): string => raw.startsWith("'") ? raw.slice(1, -1).replaceAll("''", "'") : raw
function tmdlDocuments(file: FlowFile): MDocument[] {
 const lines = file.content.match(/[^\n]*(?:\n|$)/g)!.filter(Boolean), offsets: number[] = []
 let offset = 0
 for (const line of lines) { offsets.push(offset); offset += line.length }
 const out: MDocument[] = []
 let table: string | undefined
 for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i].trim(), tableMatch = /^table\s+('(?:[^']|'')+'|[^\s=]+)\s*$/.exec(trimmed)
  if (tableMatch) table = tmdlName(tableMatch[1])
  const partition = /^partition\s+('(?:[^']|'')+'|[^\s=]+)\s*=\s*(.*?)\s*$/.exec(trimmed)
  const expression = /^expression\s+('(?:[^']|'')+'|[^\s=]+)\s*=\s*(.*?)\s*$/.exec(trimmed)
  if (!partition && !expression) continue
  const name = tmdlName((partition ?? expression)![1]), indent = lines[i].match(/^\s*/)?.[0].replaceAll('\n', '').length ?? 0
  let end = i + 1
  while (end < lines.length && (!lines[end].trim() || (lines[end].match(/^[\t ]*/)?.[0].length ?? 0) > indent)) end++
  if (partition && partition[2] !== 'm') { out.push(problem(file, 'TMDL partition source language is not M.', { name, base: offsets[i], content: lines.slice(i, end).join('') })); i = end - 1; continue }
  let sourceLine = i, sourceValue = expression?.[2]
  if (partition) {
   sourceLine = -1
   for (let j = i + 1; j < end; j++) {
    const source = /^[\t ]*source\s*=\s*(.*?)\s*$/.exec(lines[j].replace(/\r?\n$/, ''))
    if (source) { sourceLine = j; sourceValue = source[1]; break }
   }
   if (sourceLine < 0) { out.push(problem(file, 'M partition has no source expression.', { name, content: lines.slice(i, end).join(''), base: offsets[i] })); i = end - 1; continue }
  }
  const sourceIndent = lines[sourceLine].match(/^[\t ]*/)?.[0].length ?? 0
  const equal = lines[sourceLine].indexOf('=')
  let start = offsets[sourceLine] + equal + 1, stop: number
  if (sourceValue === '```') {
   start = offsets[sourceLine] + lines[sourceLine].length
   let close = sourceLine + 1
   while (close < end && lines[close].trim() !== '```') close++
   if (close === end) { out.push(problem(file, 'Unterminated TMDL verbatim M expression.', { name, base: start, content: file.content.slice(start, offsets[end] ?? file.content.length) })); i = end - 1; continue }
   stop = offsets[close]
  } else {
   let close = sourceLine + 1
   while (close < end && (!lines[close].trim() || (lines[close].match(/^[\t ]*/)?.[0].length ?? 0) > sourceIndent)) close++
   stop = offsets[close] ?? file.content.length
  }
  out.push(document(file, { name, base: start, content: file.content.slice(start, stop), metadata: { container: 'tmdl', ...(table ? { table } : {}), ...(partition ? { partition: name } : { namedExpression: true }) } }))
  i = end - 1
 }
 return out
}

export function mDocuments(files: FlowFile[]): MDocument[] {
 const out: MDocument[] = []
 const metadataFiles = new Map<string, FlowFile>()
 for (const file of files) if (/(?:^|\/)queryMetadata\.json$/i.test(file.path)) metadataFiles.set(file.path.replace(/queryMetadata\.json$/i, ''), file)
 for (const file of files) {
  if (file.content.length > 2000000) { out.push(problem(file, 'Preparation file exceeds the 2000000 character container bound.')); continue }
  if (/\.(?:pq|m)$/i.test(file.path)) {
   const doc = document(file), metadata = metadataFiles.get(file.path.replace(/[^/]*$/, ''))
   if (metadata) {
    try { const parsed: unknown = JSON.parse(metadata.content); doc.metadata = { container: 'dataflow-gen2', ...(object(parsed) ? { documentLocale: parsed.documentLocale, queriesMetadata: parsed.queriesMetadata } : {}) } } catch { /* The metadata file receives its own diagnostic. */ }
   }
   out.push(doc)
  } else if (/\.tmdl$/i.test(file.path)) out.push(...tmdlDocuments(file))
  else if (/(?:^|\/)queryMetadata\.json$/i.test(file.path)) {
   try { const parsed: unknown = JSON.parse(file.content); out.push(...metadataDocument(file, parsed, 'queryMetadata.json ')) } catch { out.push(problem(file, 'Dataflow query metadata is malformed.')) }
  } else if (/\.json$/i.test(file.path)) out.push(...jsonDocuments(file))
  else out.push(problem(file, 'Unsupported preparation file; supply textual M, TMDL M partitions or a documented dataflow definition.'))
 }
 return out
}
