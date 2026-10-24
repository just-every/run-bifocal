import { declaration, parseTMDL, type TMDLNode } from '../models/readers/tmdl-syntax'
import { containerIssue, optionsFor, type CalculationContainer, type ContainerCalculation, type ContainerOptions } from './containers'
import { translateFormula } from './translate'

function property(node: TMDLNode): { key: string; value: string } | null {
 const match = /^([A-Za-z][A-Za-z0-9]*)\s*:\s*([\s\S]*)$/.exec(node.head)
 return match ? { key: match[1], value: match[2] } : null
}
/** Extract calculation objects from original TMDL. Relationships, source table
 * bindings and deployment remain the existing model importer's responsibility. */
export function readTMDLCalculations(source: string, options: ContainerOptions): CalculationContainer {
 const result: CalculationContainer = { sourceExpression: source, calculations: [], issues: [], dependencies: [] }
 if (typeof source !== 'string' || source.length > 1048576) { containerIssue(result, 'tmdl_size', 'TMDL calculation source must fit within 1 MiB.', source); return result }
 let roots: TMDLNode[]
 try { roots = parseTMDL(source) } catch { containerIssue(result, 'invalid_tmdl', 'Repair malformed indentation, nesting or fenced expressions.', source); return result }
 const seen = new Set<string>()
 function extract(node: TMDLNode, kind: 'measure' | 'calculation-item', table?: string, group?: ContainerCalculation['group']) {
  const declared = declaration(node.head, kind === 'measure' ? 'measure' : 'calculationItem')
  if (!declared) { containerIssue(result, 'invalid_calculation_declaration', 'Supply a named TMDL measure or calculationItem declaration.', node.raw); return }
  const identity = `${table ?? ''}.${kind}.${declared.name}`
  if (seen.has(identity)) { containerIssue(result, 'duplicate_calculation', 'Resolve duplicate named source calculations before import.', node.raw); return }; seen.add(identity)
  const expressionParts = [declared.expression ?? ''], metadata: Record<string, string> = Object.create(null), local: { code: string; message: string; sourceExpression: string }[] = []
  for (const child of node.children) {
   const prop = property(child)
   if (prop) {
    if (Object.hasOwn(metadata, prop.key)) local.push({ code: 'duplicate_calculation_property', message: `Resolve repeated property ${prop.key}.`, sourceExpression: child.raw })
    metadata[prop.key] = prop.value
    if (child.children.length) local.push({ code: 'nested_calculation_property', message: `Implement nested property ${prop.key}.`, sourceExpression: child.raw })
   } else if (/^formatStringDefinition\b/i.test(child.head)) local.push({ code: 'dynamic_format_gap', message: 'Dynamic format expressions require source-compatible format evaluation; static metadata is insufficient.', sourceExpression: child.raw })
   else expressionParts.push(child.raw)
  }
  const expression = expressionParts.join('\n').trim(), translated = translateFormula('dax', expression, optionsFor(options, { name: declared.name, table, kind }))
  const formatKeys = Object.keys(metadata).filter(key => key.toLowerCase() === 'formatstring')
  if (formatKeys.length > 1) local.push({ code: 'duplicate_calculation_format', message: 'Resolve repeated formatString properties.', sourceExpression: node.raw })
  if (kind === 'calculation-item' && group?.precedence === null) local.push({ code: 'calculation_group_precedence', message: 'Declare an explicit integer precedence for this calculation group.', sourceExpression: node.raw })
  const issues = [...translated.issues, ...local]
  result.calculations.push({ ...translated, targetExpression: issues.length ? null : translated.targetExpression, issues, name: declared.name, table, kind, group, metadata, ...(formatKeys.length ? { format: metadata[formatKeys[0]] } : {}), origin: { container: 'tmdl', line: node.line, sourceObject: node.raw } })
 }
 function group(node: TMDLNode, table?: string) {
  const precedenceNodes = node.children.filter(child => property(child)?.key.toLowerCase() === 'precedence')
  const value = precedenceNodes.length === 1 ? property(precedenceNodes[0])!.value : '', precedence = /^-?\d{1,9}$/.test(value) ? Number(value) : null
  const definition = { id: table ?? 'calculationGroup', precedence }
  if (precedence === null) containerIssue(result, 'calculation_group_precedence', 'Calculation groups require one explicit integer precedence.', node.raw)
  for (const child of node.children) {
   if (declaration(child.head, 'calculationItem')) extract(child, 'calculation-item', table, definition)
   else if (property(child)?.key.toLowerCase() !== 'precedence') containerIssue(result, 'calculation_group_property_gap', 'Implement this calculation-group property or dependency before migration.', child.raw)
  }
 }
 for (const root of roots) {
  const table = declaration(root.head, 'table') ?? (/^ref table /i.test(root.head) ? declaration(root.head.slice(4), 'table') : null)
  if (table) {
   for (const child of root.children) {
    if (/\bParameterMetadata\b/.test(child.raw) || /\bGENERATESERIES\s*\(/i.test(child.raw)) {
     const kind = /\bParameterMetadata\b/.test(child.raw) ? 'field-parameter' : 'what-if-parameter'
     result.dependencies.push({ kind, name: table.name, sourceExpression: child.raw })
     containerIssue(result, 'tmdl_parameter_dependency', 'Bind the retained source field and what-if parameter definition explicitly before migration acceptance.', child.raw)
    }
    if (declaration(child.head, 'measure')) extract(child, 'measure', table.name)
    else if (/^calculationGroup\s*$/i.test(child.head)) group(child, table.name)
    else if (/^column\s/i.test(child.head) && /=/.test(child.head)) containerIssue(result, 'calculated_column_dependency', 'Calculated columns require a separate typed row-field definition and dependency mapping.', child.raw)
   }
  } else if (declaration(root.head, 'measure')) extract(root, 'measure')
  else if (/^calculationGroup\s*$/i.test(root.head)) group(root)
  else containerIssue(result, 'tmdl_calculation_container_gap', 'Include table, measure or calculationGroup declarations; resolve other root objects through the model importer.', root.raw)
 }
 const precedences = new Map<number, string>()
 for (const item of result.calculations) if (item.group && item.group.precedence !== null) {
  const other = precedences.get(item.group.precedence)
  if (other && other !== item.group.id) containerIssue(result, 'ambiguous_calculation_group_precedence', 'Two calculation groups use the same precedence; resolve ordering before activation.', item.origin.sourceObject)
  precedences.set(item.group.precedence, item.group.id)
 }
 return result
}
