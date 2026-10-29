import { canonicalJson } from '../../../modules/import-kit/src/provenance/identity.ts'
import type { InputRow } from '../../calculations/core'
import { fail } from '../../query/types'
import type { RdlNode, RdlProject } from './parse'
import { createReportRuntime, type RdlTable } from './execution'
import { child, children, descendants, text } from './tree'
import { length, reportLayout, type ReportRow } from './layout'
import { reportCell } from './values'
import { sortRdlGroups, sortRdlRows } from './sort'
import { RdlExecutionError } from './problems'

/** A native readable rendering is a separate reviewed layout, never a source
 * pagination or successful-switch claim. Unknown execution semantics refuse. */
export function renderRdl(project: RdlProject, tables: Record<string, RdlTable>, parameters: Record<string, unknown>) {
 const blocked = project.report.issues.filter(issue => !['source_binding_required', 'subscription_reauthorization_required'].includes(issue.code))
 if (blocked.length) fail('rdl_unresolved_translation_blocks_render')
 const runtime = createReportRuntime(project, tables), root = project.definition.reports.find(report => report.file === project.definition.root)!
 const sections = children(child(root.tree, 'ReportSections'), 'ReportSection')
 if (sections.length > 1) fail('rdl_multiple_sections_unsupported')
 const section = sections[0] ?? root.tree, page = child(section, 'Page'), rootScope = runtime.resolve(root.file, parameters)
 const unsupported = new Set(['Visibility', 'Filters', 'TablixColumnHierarchy', 'TablixCorner', 'HideDuplicates', 'Line', 'Columns', 'ColumnSpacing'])
 for (const report of project.definition.reports) for (const node of walk(report.tree)) {
  if (unsupported.has(node.name)) {
   // A single static column hierarchy is the ordinary tablix column scaffold.
   if (node.name === 'TablixColumnHierarchy' && descendants(node, 'Group').length === 0) continue
   throw new RdlExecutionError('rdl_readable_semantics_unsupported', [{location: node.location, code: 'rdl_readable_semantics_unsupported', reason: 'The readable renderer cannot preserve this imported feature: ' + node.name + '.', dependency: node.name, resolution: 'Provide a supported native equivalent and reconcile its output against the source before rendering this report.'}])
  }
  if (node.name === 'Language' && node.text !== 'en-US') fail('rdl_readable_language_unsupported')
  if (node.name === 'DataField' && node.text.trim().startsWith('=')) fail('rdl_calculated_dataset_field_unsupported')
 }
 type Scope = ReturnType<typeof runtime.resolve>
 const textbox = (node: RdlNode, scope: Scope, table?: RdlTable, row?: InputRow) => {
  const runs = descendants(node, 'TextRun'), direct = children(node, 'Value')
  if (runs.length > 1 || direct.length > 1 || descendants(node, 'Paragraph').length > 1) fail('rdl_rich_text_unsupported')
  const run = runs[0] ?? node, value = child(run, 'Value')
  if (!value) fail('rdl_textbox_value_required')
  return reportCell(scope.evaluate(value, table, row), node.location, text(child(run, 'Style'), 'Format') || text(child(node, 'Style'), 'Format'))
 }
 const furniture = (name: string) => {
  const furniture = child(page, name)
  if (!furniture) return []
  if (text(furniture, 'PrintOnFirstPage') === 'false' || text(furniture, 'PrintOnLastPage') === 'false') fail('rdl_conditional_page_furniture_unsupported')
  return children(child(furniture, 'ReportItems'), 'Textbox').map(node => ({cells: [textbox(node, rootScope)], widths: [1], location: node.location}))
 }
 const layout = reportLayout({width: length(text(page, 'PageWidth'), 612), height: length(text(page, 'PageHeight'), 792), left: length(text(page, 'LeftMargin'), 36), right: length(text(page, 'RightMargin'), 36), top: length(text(page, 'TopMargin'), 36), bottom: length(text(page, 'BottomMargin'), 36), header: furniture('PageHeader'), footer: furniture('PageFooter')})
 let operations = 0, repeated: ReportRow[] = []
 const tick = () => {if (++operations > 20000) fail('rdl_interactive_execution_limit', 413)}
 function pageBreak(node: RdlNode, when: 'before'|'between'|'after') {
  const rule = child(node, 'PageBreak')
  if (!rule) return
  if (text(rule, 'Disabled') && text(rule, 'Disabled') !== 'false') fail('rdl_dynamic_page_break_unsupported')
  if (text(rule, 'ResetPageNumber') === 'true') fail('rdl_page_number_reset_unsupported')
  const value = text(rule, 'BreakLocation')
  if (!['None', 'Start', 'End', 'StartAndEnd', 'Between'].includes(value)) fail('rdl_page_break_unsupported')
  if (when === 'before' && ['Start', 'StartAndEnd'].includes(value) || when === 'after' && ['End', 'StartAndEnd'].includes(value) || when === 'between' && value === 'Between') layout.break()
 }
 function reportItems(container: RdlNode|undefined, file: string, scope: Scope, table?: RdlTable, row?: InputRow, depth = 0) {
  if (depth > 16) fail('rdl_nested_report_limit')
  for (const node of container?.children ?? []) {
   tick(); pageBreak(node, 'before')
   if (node.name === 'Textbox') layout.row({cells: [textbox(node, scope, table, row)], widths: [1], location: node.location})
   else if (node.name === 'Rectangle') reportItems(child(node, 'ReportItems'), file, scope, table, row, depth + 1)
   else if (node.name === 'Tablix') tablix(node, file, scope, table, depth + 1)
   else if (node.name === 'Subreport') {
    const name = text(node, 'ReportName'), folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '', target = folder + name + (/\.rdlx?$/i.test(name) ? '' : '.rdl')
    const report = project.definition.reports.find(r => r.file === target)
    if (!report) fail('rdl_subreport_unavailable')
    const values = Object.create(null)
    for (const parameter of children(child(node, 'Parameters'), 'Parameter')) {
     if (text(parameter, 'Omit') && text(parameter, 'Omit') !== 'false') fail('rdl_subreport_parameter_omit_unsupported')
     const value = child(parameter, 'Value'); if (!value) fail('rdl_subreport_parameter_value_required')
     const resolved = scope.evaluate(value, table, row)
     if (Object.hasOwn(values, parameter.attributes.Name)) fail('rdl_subreport_parameter_duplicate')
     values[parameter.attributes.Name] = resolved.type === 'null' ? null : resolved.type === 'number' ? {kind: 'literal', type: 'number', value: resolved} : {kind: 'literal', type: resolved.type, value: resolved.value}
    }
    const nextScope = runtime.resolve(target, values), sections = children(child(report.tree, 'ReportSections'), 'ReportSection')
    if (sections.length > 1) fail('rdl_multiple_sections_unsupported')
    reportItems(child(child(sections[0] ?? report.tree, 'Body'), 'ReportItems'), target, nextScope, undefined, undefined, depth + 1)
   } else fail('rdl_report_item_unsupported')
   pageBreak(node, 'after')
  }
 }
 function tablix(node: RdlNode, file: string, scope: Scope, inherited?: RdlTable, depth = 0) {
  const name = text(node, 'DataSetName')
  if (inherited && name) fail('rdl_nested_dataset_override_unsupported')
  const bound = name ? scope.dataset(name) : inherited
  if (!bound) fail('rdl_tablix_dataset_required')
  const table = sortRdlRows(scope, bound, child(node, 'SortExpressions'))
  const noRows = child(node, 'NoRowsMessage')
  if (!table.rows.length && noRows) {
   layout.row({cells: [reportCell(scope.evaluate(noRows, table), noRows.location)], widths: [1], location: noRows.location})
   return
  }
  const templates = children(child(child(node, 'TablixBody'), 'TablixRows'), 'TablixRow'), widths = children(child(child(node, 'TablixBody'), 'TablixColumns'), 'TablixColumn').map(column => length(text(column, 'Width'), 72))
  const roots = children(child(child(node, 'TablixRowHierarchy'), 'TablixMembers'), 'TablixMember')
  const leaves = new Map<RdlNode, RdlNode>(); let index = 0
  function enumerate(member: RdlNode) {
   const members = children(child(member, 'TablixMembers'), 'TablixMember')
   if (members.length) members.forEach(enumerate)
   else {const row = templates[index++]; if (!row) fail('rdl_tablix_hierarchy_mismatch'); leaves.set(member, row)}
  }
  roots.forEach(enumerate)
  if (!roots.length || index !== templates.length) fail('rdl_tablix_hierarchy_mismatch')
  const rowValue = (template: RdlNode, selected: RdlTable, row?: InputRow): ReportRow => {
   const cells = children(child(template, 'TablixCells'), 'TablixCell')
   if (cells.length !== widths.length || cells.some(cell => children(child(cell, 'CellContents'), 'ColSpan').length > 0 || children(child(cell, 'CellContents'), 'Textbox').length !== 1)) fail('rdl_complex_tablix_cell_unsupported')
   return {cells: cells.map(cell => textbox(child(child(cell, 'CellContents'), 'Textbox')!, scope, selected, row)), widths, location: template.location}
  }
  const repeating = roots.filter(member => !child(member, 'Group') && !child(member, 'TablixMembers') && text(member, 'RepeatOnNewPage') === 'true' && text(member, 'KeepWithGroup') === 'After').map(member => rowValue(leaves.get(member)!, table))
  const previousRepeats = repeated; repeated = [...repeated, ...repeating]; layout.repeat(repeated)
  const emitRow = (template: RdlNode, selected: RdlTable, row?: InputRow) => {
   const cells = children(child(template, 'TablixCells'), 'TablixCell'), contents = cells.length === 1 ? child(cells[0], 'CellContents') : undefined
   if (contents?.children.length === 1 && ['Tablix', 'Rectangle', 'Subreport'].includes(contents.children[0].name)) reportItems(contents, file, scope, selected, row, depth + 1)
   else layout.row(rowValue(template, selected, row))
  }
  function emit(member: RdlNode, selected: RdlTable) {
   tick()
   const group = child(member, 'Group'), members = children(child(member, 'TablixMembers'), 'TablixMember'), expressions = children(child(group, 'GroupExpressions'), 'GroupExpression')
   let partitions = [selected.rows]
   if (group) {
    if (!expressions.length) partitions = selected.rows.map(row => [row])
    else {
     const grouped = new Map<string, InputRow[]>()
     for (const row of selected.rows) {const key = canonicalJson(expressions.map(expression => scope.evaluate(expression, selected, row))), found = grouped.get(key); if (found) found.push(row); else grouped.set(key, [row])}
     partitions = [...grouped.values()]
    }
   }
   partitions = sortRdlGroups(scope, partitions, selected, child(member, 'SortExpressions'))
   partitions.forEach((rows, i) => {
    if (group) {pageBreak(group, 'before'); if (i) pageBreak(group, 'between')}
    const narrowed = {...selected, rows}
    if (members.length) members.forEach(member => emit(member, narrowed))
    else emitRow(leaves.get(member)!, narrowed, rows.length === 1 ? rows[0] : undefined)
    if (group) pageBreak(group, 'after')
   })
  }
  roots.forEach(member => emit(member, table)); repeated = previousRepeats; layout.repeat(repeated)
 }
 reportItems(child(child(section, 'Body'), 'ReportItems'), root.file, rootScope)
 return {...layout.finish(), parameters: rootScope.parameters, layout: 'readable' as const}
}
function* walk(node: RdlNode): Generator<RdlNode> {yield node; for (const next of node.children) yield* walk(next)}
