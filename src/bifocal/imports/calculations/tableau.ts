import { DOMParser, type Element } from '@xmldom/xmldom'
import { containerIssue, optionsFor, type CalculationContainer, type ContainerOptions } from './containers'
import { translateFormula } from './translate'
import type { TranslationIssue } from './types'

/** Textual TWB only: XML is parsed as inert data. TWBX archives, extracts and
 * scripts are not fetched or evaluated by this calculation reader. */
export function readTableauCalculations(source: string, options: ContainerOptions): CalculationContainer {
 const result: CalculationContainer = { sourceExpression: source, calculations: [], issues: [], dependencies: [] }
 if (typeof source !== 'string' || source.length > 1048576) { containerIssue(result, 'tableau_xml_size', 'Textual TWB calculation source must fit within 1 MiB.', source); return result }
 if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(source)) { containerIssue(result, 'tableau_active_xml', 'DTD and entity declarations are refused; supply the original workbook without active XML.', source); return result }
 let root: Element
 try {
  const document = new DOMParser({ onError: () => { throw Error('invalid XML') } }).parseFromString(source, 'application/xml')
  root = document.documentElement!
  if (!root || root.tagName !== 'workbook' || root.getElementsByTagName('*').length > 10000) throw Error('unsupported document')
 } catch { containerIssue(result, 'invalid_tableau_xml', 'Supply a well-formed Tableau workbook with at most 10,000 elements.', source); return result }
 const seen = new Set<string>(), nodes = root.getElementsByTagName('calculation')
 for (let i = 0; i < nodes.length; i++) {
  const calculation = nodes.item(i)!, column = calculation.parentNode as Element, formula = calculation.getAttribute('formula') ?? '', sourceObject = column.toString()
  if (!column || column.nodeType !== 1 || column.tagName !== 'column') { containerIssue(result, 'tableau_calculation_parent', 'Map this calculation’s non-column container before importing it.', calculation.toString()); continue }
  let parent = column.parentNode, table: string | undefined, nesting = 0
  while (parent && parent.nodeType === 1) { if (++nesting > 32) break; const element = parent as Element; if (element.tagName === 'datasource') { table = element.getAttribute('name') ?? undefined; break }; parent = parent.parentNode }
  if (nesting > 32) { containerIssue(result, 'tableau_nesting', 'Workbook calculation ancestry exceeds 32 levels.', sourceObject); continue }
  const name = column.getAttribute('caption') || column.getAttribute('name') || ''
  if (!name || seen.has(`${table ?? ''}.${column.getAttribute('name') ?? name}`)) { containerIssue(result, 'duplicate_tableau_calculation', 'Supply unique named source calculation columns.', sourceObject); continue }
  seen.add(`${table ?? ''}.${column.getAttribute('name') ?? name}`)
  const local: TranslationIssue[] = []
  if (calculation.getAttribute('class') !== 'tableau') local.push({ code: 'tableau_calculation_language', message: 'Implement the declared source calculation language before migrating it.', sourceExpression: calculation.toString() })
  const translated = translateFormula('tableau', formula, optionsFor(options, { name, table, kind: 'calculated-field' })), issues = [...translated.issues, ...local]
  const metadata: Record<string, string> = Object.create(null)
  for (let attribute = 0; attribute < column.attributes.length; attribute++) { const value = column.attributes.item(attribute)!; metadata[value.name] = value.value }
  result.calculations.push({ ...translated, targetExpression: issues.length ? null : translated.targetExpression, issues, name, table, kind: 'calculated-field', metadata, ...(column.hasAttribute('default-format') ? { format: column.getAttribute('default-format')! } : {}), origin: { container: 'tableau-twb', sourceObject } })
 }
 for (const tag of ['story', 'story-point', 'parameter']) {
  const dependencies = root.getElementsByTagName(tag)
  for (let i = 0; i < dependencies.length; i++) { const dependency = dependencies.item(i)!; result.dependencies.push({ kind: tag, name: dependency.getAttribute('name') || dependency.getAttribute('caption') || `${tag}-${i + 1}`, sourceExpression: dependency.toString() }) }
 }
 const columns = root.getElementsByTagName('column')
 for (let i = 0; i < columns.length; i++) { const column = columns.item(i)!; if (column.hasAttribute('param-domain-type')) result.dependencies.push({ kind: 'parameter-column', name: column.getAttribute('caption') || column.getAttribute('name') || `parameter-${i + 1}`, sourceExpression: column.toString() }) }
 if (result.dependencies.length) containerIssue(result, 'tableau_dependencies_require_mapping', 'Story and parameter dependencies are retained and need explicit native mapping before migration acceptance.', result.dependencies.map(item => item.sourceExpression).join('\n'))
 return result
}
