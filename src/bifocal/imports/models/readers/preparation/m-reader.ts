import type { FlowFile, FlowStep, PreparationFormat, SourceFlow } from './types'
import { mDocuments, type MDocument } from './m-documents'
import { mParameter, translateM } from './m-operations'
import { identifier, mBindings, mLocation, sectionQueries, tokenText, type MPart, type MToken } from './m-syntax'

type Query = { document: MDocument; part: MPart; id: string; bindings: MPart[]; returned: MToken[]; ids: Map<string, string>; result: string; reason?: string }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'M syntax could not be parsed.'
const place = (doc: MDocument, offset: number) => mLocation(doc.file.content, doc.base + offset, doc.prefix)
const rawPart = (document: MDocument): MPart => ({ name: document.name, expression: document.content, offset: 0, tokens: [], reason: document.reason })

function parseQueries(files: FlowFile[]): Query[] {
 const queries: Query[] = []
 for (const document of mDocuments(files)) {
  let parts: MPart[]
  try { parts = document.reason ? [rawPart(document)] : sectionQueries(document.content, document.name) } catch (error) { parts = [{ ...rawPart(document), reason: errorMessage(error) }] }
  if (!parts.length) parts = [{ ...rawPart(document), reason: 'M section contains no queries.' }]
  for (const part of parts) {
   const id = `m-query-${queries.length + 1}`, ids = new Map<string, string>()
   let bindings: MPart[] = [], returned = part.tokens, reason = part.reason
   if (!reason) {
    try {
     const parsed = mBindings(part.tokens, document.content)
     bindings = parsed.parts; returned = parsed.result
    } catch (error) { reason = errorMessage(error) }
   }
   for (const [index, binding] of bindings.entries()) {
    if (ids.has(binding.name)) reason = `Duplicate M binding ${binding.name}; resolve ambiguous references before translation.`
    else ids.set(binding.name, `${id}-step-${index + 1}`)
   }
   const alias = identifier(returned), result = alias !== null && ids.has(alias) ? ids.get(alias)! : `${id}-result`
   queries.push({ document, part, id, bindings, returned, ids, result, reason })
  }
 }
 return queries
}

function references(tokens: MToken[], resolve: (name: string) => string | undefined): string[] {
 const out: string[] = []
 for (const [index, token] of tokens.entries()) {
  if (token.kind !== 'id') continue
  // A field selection and literal record key are not variable references.
  if (tokens[index + 1]?.kind === 'symbol' && tokens[index + 1].value === '=') continue
  if (tokens[index - 1]?.kind === 'symbol' && tokens[index - 1].value === '[' && tokens[index + 1]?.kind === 'symbol' && tokens[index + 1].value === ']') continue
  const id = resolve(token.value)
  if (id && !out.includes(id)) out.push(id)
 }
 return out
}

function queryFlow(query: Query, previous: Map<string, Query>, allNames: Set<string>, format: PreparationFormat): SourceFlow {
 const { document, part, id } = query
 const metadata = { format, importedInactive: true, ...document.metadata, ...part.metadata, returnExpression: tokenText(query.returned, document.content) }
 if (query.reason) {
  const result = `${id}-invalid`
  return { id, name: part.name, file: document.file.path, result, metadata, steps: [{ id: result, name: part.name, file: document.file.path, location: place(document, part.offset), sourceExpression: part.expression, dependencies: [], reason: query.reason }] }
 }
 const resolve = (name: string): string | undefined => query.ids.get(name) ?? previous.get(name)?.result
 const steps: FlowStep[] = []
 const emit = (binding: MPart, stepId: string) => {
  const dependencies = references(binding.tokens, resolve)
  const translated = translateM(binding.tokens, resolve, part.name)
  const step: FlowStep = { id: stepId, name: binding.name, file: document.file.path, location: place(document, binding.offset), sourceExpression: binding.expression, dependencies, ...translated }
  const unresolvedQuery = binding.tokens.find(t => t.kind === 'id' && allNames.has(t.value) && !resolve(t.value))
  if (unresolvedQuery && (step.binding === unresolvedQuery.value || !step.reason)) {
   delete step.binding; delete step.operations
   step.reason = `M query ${unresolvedQuery.value} is not an unambiguous earlier query; forward and cyclic shared-query references require explicit dependency resolution.`
  }
  if (binding.tokens.some(t => t.kind === 'id' && ['RangeStart', 'RangeEnd'].includes(t.value)) && !step.parameter) {
   delete step.binding; delete step.operations
   step.reason = 'Incremental partition boundaries require explicit snapshot and refresh-policy translation.'
  }
  if (dependencies.includes(stepId)) { delete step.operations; step.reason = 'M step has a cyclic self-reference; native table dependencies must be acyclic.' }
  if (step.binding && step.parameter) { delete step.binding; step.reason = 'A scalar parameter cannot bind an executable table source.' }
  steps.push(step)
 }
 for (const [index, binding] of query.bindings.entries()) emit(binding, `${id}-step-${index + 1}`)
 if (query.result === `${id}-result`) {
  emit({ name: part.name, tokens: query.returned, expression: tokenText(query.returned, document.content), offset: query.returned[0]?.start ?? part.offset }, query.result)
 }
 const parameterIds = new Set<string>()
 for (const previousQuery of previous.values()) {
  const literal = mParameter(previousQuery.returned)
  if (!previousQuery.bindings.length && literal?.parameter) parameterIds.add(previousQuery.result)
  for (const binding of previousQuery.bindings) if (mParameter(binding.tokens)?.parameter) parameterIds.add(previousQuery.ids.get(binding.name)!)
 }
 for (const step of steps) if (step.parameter) parameterIds.add(step.id)
 for (const step of steps) if (!step.parameter && step.dependencies.some(dependency => parameterIds.has(dependency))) {
  delete step.operations; delete step.binding
  step.reason = 'A scalar M parameter is referenced by a table expression; literal parameters are retained but never substituted into executable source or preparation code.'
 }
 return { id, name: part.name, file: document.file.path, result: query.result, steps, metadata }
}

/** Reads source text into a closed native plan without evaluating imported M. */
export function readPowerQuery(files: FlowFile[], format: PreparationFormat): SourceFlow[] {
 const queries = parseQueries(files), previous = new Map<string, Query>(), allNames = new Set(queries.map(q => q.part.name)), flows: SourceFlow[] = []
 const duplicateNames = new Set(queries.filter((q, i) => queries.some((other, j) => j < i && other.part.name === q.part.name)).map(q => q.part.name))
 for (const query of queries) {
  if (duplicateNames.has(query.part.name)) query.reason = `Duplicate M query name ${query.part.name}; references cannot be bound unambiguously.`
  const flow = queryFlow(query, previous, allNames, format)
  flows.push(flow)
  previous.set(query.part.name, { ...query, result: flow.result })
 }
 return flows
}
