import { issue, record, text } from './common'
import type { Project, ProjectFile, ProjectResource } from './types'

// Data-only inventory of PBIR visual containers and unpacked visual metadata.
// Source formats: Microsoft's report and visual container schemas and visual API
// package and capabilities schemas; Deneb's https://deneb.guide/docs/pbir-guide.
// No imported module, expression, URI, schema or package is loaded or executed.
const denebGuid = 'deneb7E15AEF80B9E4D4F8E12924291ECE89A'
const denebTypes = new Set([denebGuid, ...['STANDALONE','ALPHA','BETA'].map(prefix => prefix + denebGuid)])
const nativeTypes = new Set(['areaChart','barChart','basicShape','card','cardVisual','clusteredBarChart','clusteredColumnChart','columnChart','comboChart','donutChart','filledMap','funnel','gauge','hundredPercentStackedBarChart','hundredPercentStackedColumnChart','image','keyDriversVisual','kpi','lineChart','lineClusteredColumnComboChart','lineStackedColumnComboChart','map','multiRowCard','pieChart','pivotTable','pythonVisual','ribbonChart','scatterChart','scriptVisual','shape','slicer','stackedAreaChart','stackedBarChart','stackedColumnChart','tableEx','textbox','treemap','waterfallChart'])
const at = (file: ProjectFile) => ({file: file.path, sourceExpression: file.content})
const valueAt = (value: unknown, ...path: string[]): unknown => path.reduce<unknown>((v, key) => record(v) ? v[key] : undefined, value)
// PBIR text is an explicitly quoted Literal, with doubled apostrophes. This
// decoder accepts no expression language and performs no interpolation.
function literal(value: unknown): string | null {
 const raw = valueAt(value, 'expr', 'Literal', 'Value')
 if (typeof raw !== 'string' || !/^'(?:[^']|'')*'$/.test(raw)) return null
 return raw.slice(1, -1).replace(/''/g, "'")
}
function objectProperties(value: unknown, group: string): Record<string, unknown> | null {
 const entries = valueAt(value, 'objects', group)
 return Array.isArray(entries) && entries.length === 1 && record(entries[0]) && record(entries[0].properties) ? entries[0].properties : null
}
function inspectUnsafe(value: unknown, pbirLiterals = false): string[] {
 const findings = new Set<string>(), stack: {value: unknown; depth: number}[] = [{value, depth: 0}]
 while (stack.length) {
  const {value: next, depth} = stack.pop()!
  if (depth > 64) { findings.add('excessive nesting'); continue }
  if (typeof next === 'string' && /(?:^\s*(?:javascript|data:text\/html):|<\s*script\b|\b(?:fetch|eval|Function)\s*\()/i.test(next)) findings.add('active content')
  if (Array.isArray(next)) for (const item of next) stack.push({value: item, depth: depth + 1})
  else if (record(next)) for (const [key, item] of Object.entries(next)) {
   if (['url','href','src','script','javascript','externalJS','externals','js','code'].includes(key) && item !== '' && item !== null && (!Array.isArray(item) || item.length)) findings.add('external or executable content')
   const passiveLiteral = pbirLiterals && key === 'expr' && record(item) && Object.keys(item).length === 1 && record(item.Literal) && Object.keys(item.Literal).length === 1 && typeof item.Literal.Value === 'string'
   if (['expr','signal','signals','on','update','init','test'].includes(key) && !passiveLiteral || key === 'filter' && typeof item === 'string') findings.add('source expressions or event handlers')
   stack.push({value: item, depth: depth + 1})
  }
 }
 return [...findings]
}

export function readCustomVisuals(p: Project, files: ProjectFile[], resources: ProjectResource[], described: Set<string>) {
 const json = new Map<string, Record<string, unknown>>()
 const parse = (file: ProjectFile) => {
  try { const value: unknown = JSON.parse(file.content); if (record(value)) { json.set(file.path, value); return value } } catch { /* retained diagnostic */ }
  issue(p, at(file), file.path, 'invalid_custom_visual_json', 'Supply a JSON object for this visual inventory item. Imported content remains inactive.')
  return null
 }
 const retain = (file: ProjectFile, kind: string, source: Record<string, unknown>, dependencies: string[] = [], inventory?: Record<string, unknown>) => {
  described.add(file.path)
  const resource = {...at(file), id: file.path, name: text(source.name) ?? file.path, kind, dependencies, definition: {source, ...(inventory ? {inventory} : {})}}
  resources.push(resource)
  return resource
 }
 const reports = resources.filter(r => r.kind === 'pbip-report')
 const owner = (path: string) => reports.find(report => path.startsWith(report.file.slice(0, -'definition.pbir'.length)))
 const candidates = files.filter(file => /(?:^|\/)definition\/(?:report\.json|pages\/[^/]+\/page\.json|pages\/[^/]+\/visuals\/[^/]+\/visual\.json)$/i.test(file.path) || /(?:^|\/)CustomVisuals\/.+\/(?:package\.json|[^/]*\.pbiviz\.json|pbiviz\.json|capabilities\.json)$/i.test(file.path))
 for (const file of candidates) {
  described.add(file.path)
  if (!parse(file)) resources.push({...at(file), id: file.path, name: file.path, kind: 'pbip-unparsed-visual-item', dependencies: [], definition: {sourceText: file.content}})
 }
 const metadata = candidates.filter(file => /\/CustomVisuals\//i.test('/' + file.path))
 for (const file of metadata) {
  const source = json.get(file.path); if (!source) continue
  const report = owner(file.path)
  const resource = retain(file, 'pbip-custom-visual-metadata', source)
  if (!report) issue(p, resource, resource.id, 'unreferenced_custom_visual', 'Include the report descriptor owning this visual metadata.')
  // Package scripts are retained as text and explicitly refused. A licence or
  // a Power BI capability declaration cannot grant Bifocal authority.
  const unsafe = inspectUnsafe(source)
  if (unsafe.length) issue(p, resource, resource.id, 'custom_visual_execution_denied', 'Imported visual code and external content remain inactive; rebuild with approved native behavior.')
  const capabilities = record(source.capabilities) ? source.capabilities : source
  if (Array.isArray(capabilities.privileges) && capabilities.privileges.length) issue(p, resource, resource.id, 'custom_visual_capabilities_denied', 'Imported privileges grant no network, storage, export or sign-in access. Resolve each capability before publication.')
 }
 for (const file of candidates.filter(file => /\/definition\/(?:report\.json|pages\/[^/]+\/page\.json)$/i.test('/' + file.path))) {
  const source = json.get(file.path); if (!source) continue
  const report = owner(file.path)
  const resource = retain(file, /\/page\.json$/i.test(file.path) ? 'pbip-report-page' : 'pbip-report-definition', source)
  if (report) report.dependencies.push(resource.id)
  else issue(p, resource, resource.id, 'unreferenced_pbip_report_item', 'Include the report descriptor owning this layout item.')
 }
 for (const file of candidates.filter(file => /\/visual\.json$/i.test(file.path))) {
  const source = json.get(file.path); if (!source) continue
  const report = owner(file.path), visual = record(source.visual) ? source.visual : {}, visualType = text(visual.visualType)
  const root = report?.file.slice(0, -'definition.pbir'.length), typeBase = visualType?.replace(/_OrgStore$/, '')
  const packageRoot = root && typeBase ? root + 'CustomVisuals/' + typeBase + '/' : null
  const packageFiles = metadata.filter(item => packageRoot && item.path.startsWith(packageRoot))
  const packageValues = packageFiles.flatMap(item => { const value = json.get(item.path); return value ? [{file: item.path, source: value}] : [] })
  const packageVisual = packageValues.find(item => text(valueAt(item.source, 'visual', 'guid')) === typeBase)
  const declared = packageVisual && record(packageVisual.source.visual) ? packageVisual.source.visual : {}
  const developer = objectProperties(visual, 'developer')
  const publisher = packageValues.flatMap(item => { const name = text(valueAt(item.source, 'author', 'name')); return name ? [{name, file: item.file}] : [] })
  const version = text(declared.version) ?? literal(developer?.version)
  const caps = packageValues.flatMap(item => record(item.source.capabilities) ? [{file: item.file, value: item.source.capabilities}] : /\/capabilities\.json$/i.test(item.file) ? [{file: item.file, value: item.source}] : [])
  const definition = root ? json.get(root + 'definition/report.json') : undefined
  const publicRegistration = Array.isArray(definition?.publicCustomVisuals) && definition.publicCustomVisuals.includes(visualType)
  const packages = Array.isArray(definition?.resourcePackages) ? definition.resourcePackages.filter(record) : []
  const registration = packages.find(item => item.name === visualType && ['CustomVisual','OrganizationalStoreCustomVisual'].includes(String(item.type)))
  const isDeneb = !!typeBase && denebTypes.has(typeBase), custom = isDeneb || !!packageFiles.length || publicRegistration || !!registration || !visualType || !nativeTypes.has(visualType)
  const pagePath = file.path.replace(/\/visuals\/[^/]+\/visual\.json$/i, '/page.json')
  const page = json.get(pagePath)
  const affected = [...new Set([file.path, pagePath, ...(report ? [report.id] : [])])]
  const licences = packageValues.flatMap(item => Object.entries(item.source).filter(([key]) => /^(?:licen[cs]e|licen[cs]es|licen[cs]ing)$/i.test(key)).map(([key, declaration]) => ({file: item.file, property: key, declaration})))
  const inventory: Record<string, unknown> = {
   visualType, sourceKind: publicRegistration ? 'appsource' : registration?.type === 'OrganizationalStoreCustomVisual' ? 'organizational' : packageFiles.length ? 'file' : 'unregistered',
   publisher: {status: publisher.length ? 'declared' : 'unknown', declarations: publisher},
   version: {status: version ? 'declared' : 'unknown', value: version, file: text(declared.version) ? packageVisual?.file : file.path},
   dataRoles: {bindings: valueAt(visual, 'query', 'queryState') ?? null, declarations: caps.map(item => ({file: item.file, roles: item.value.dataRoles ?? null, mappings: item.value.dataViewMappings ?? null}))},
   formatting: {objects: visual.objects ?? null, container: visual.visualContainerObjects ?? null, declarations: caps.map(item => ({file: item.file, objects: item.value.objects ?? null}))},
   interactions: {filterConfig: source.filterConfig ?? null, visual: Object.fromEntries(Object.entries(visual).filter(([key]) => /drill|filter|selection|interaction/i.test(key))), page: page?.visualInteractions ?? null, declarations: caps.map(item => ({file: item.file, capabilities: Object.fromEntries(Object.entries(item.value).filter(([key]) => /highlight|drill|filter|selection|tooltip|keyboard/i.test(key)))}))},
   licence: {status: 'unverified', requirements: licences, entitlement: 'not-established', redistribution: 'not-authorized'},
   execution: {active: false, network: 'denied', importedCode: 'denied'},
   mapping: {name: isDeneb ? 'native-declarative-chart' : custom ? 'custom-visual-equivalent:' + (visualType ?? 'unknown') : 'native-report-visual:' + visualType, status: 'unsupported', affectedDependents: affected, requiredBehavior: ['field bindings','formatting','filters and selections','drill','accessible alternative','layout and exports']}
  }
  const resource = retain(file, custom ? 'pbip-custom-visual' : 'pbip-report-visual', source, packageFiles.map(item => item.path), inventory)
  const parent = resources.find(item => item.id === pagePath) ?? report
  parent?.dependencies.push(resource.id)
  if (!report) issue(p, resource, resource.id, 'unreferenced_custom_visual', 'Include the report descriptor owning this visual.')
  if (inspectUnsafe(source, true).length || ['scriptVisual','pythonVisual'].includes(visualType ?? '')) {
   inventory.mapping = {...inventory.mapping as Record<string, unknown>, status: 'denied'}
   issue(p, resource, resource.id, 'custom_visual_execution_denied', 'Source code, active content and outbound actions remain inactive. Rebuild the required analytical behavior with native declarations.')
  }
  if (!custom) { issue(p, resource, resource.id, 'pbip_visual_translation_pending', 'Retain and translate this source visual before claiming report equivalence.'); continue }
  if (!publisher.length || !version) issue(p, resource, resource.id, 'custom_visual_metadata_required', 'Supply publisher and exact version evidence. Missing AppSource metadata is never downloaded or inferred.')
  issue(p, resource, resource.id, 'custom_visual_licence_unverified', 'Resolve lawful use, required entitlements and redistribution rights from publisher evidence before publication. Imported declarations grant no rights.')
  if (isDeneb) {
   const properties = objectProperties(visual, 'vega'), raw = literal(properties?.jsonSpec), config = literal(properties?.jsonConfig)
   try {
    const spec: unknown = raw === null ? null : JSON.parse(raw), settings: unknown = config === null ? {} : JSON.parse(config)
    if (!record(spec) || !record(settings)) throw Error('object')
    const unsafe = [...inspectUnsafe(spec), ...inspectUnsafe(settings)]
    const provider = literal(properties?.provider)
    const language = typeof spec.$schema === 'string' && /\/vega\/v\d+(?:\.\d+)*\.json$/.test(spec.$schema) || provider === 'vega' ? 'vega' : 'vega-lite'
    inventory.mapping = {...inventory.mapping as Record<string, unknown>, status: unsafe.length || (inventory.mapping as Record<string, unknown>).status === 'denied' ? 'denied' : 'requires-native-review', specification: {language, spec}, configuration: settings}
    if (unsafe.length) issue(p, resource, resource.id, 'unsafe_custom_visual_specification', 'External resources, executable expressions and event handlers are denied. Rebuild required behavior using bounded native declarations.')
   } catch { issue(p, resource, resource.id, 'invalid_deneb_specification', 'Supply strict JSON in the documented PBIR text Literal. Expressions and JSONC are not interpreted.') }
  }
  issue(p, resource, resource.id, 'custom_visual_mapping_pending', `Resolve the named native mapping and behavior parity for every affected dependency: ${affected.join(', ')}. Inventory alone does not permit publication.`)
 }
}
