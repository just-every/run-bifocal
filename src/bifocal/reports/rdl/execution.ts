import { CalculationError, evaluateCalculatedField as nativeField, type CalculationExpr, type CalculationValue, type DataType, type InputRow, type Literal, type Schema } from '../../calculations/core'
import { ConventionsError } from '../../company/protocol'
import { fail } from '../../query/types'
import type { RdlNode, RdlProject } from './parse'
import { child, children, text } from './tree'
import { evaluateRdlExpression } from './expression-value'
import { expressionProblem } from './problems'

export type RdlTable = { schema: Schema; rows: InputRow[]; parameterFields: Record<string, string> }
const own = (value: object, key: string) => Object.hasOwn(value, key)
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function calculation<T>(run: () => T): T {
 try { return run() } catch (error) {
  if (error instanceof CalculationError || error instanceof ConventionsError) fail('rdl_' + error.code, 422)
  throw error
 }
}
const evaluateCalculatedField = (...args: Parameters<typeof nativeField>) => calculation(() => nativeField(...args))
const asLiteral = (value: CalculationValue): Literal => value.type === 'null' ? { kind: 'literal', type: 'null', value: null } : { kind: 'literal', type: value.type, value: value.type === 'number' ? value : value.value }
const normalized = (value: Literal) => JSON.stringify(evaluateCalculatedField(value, {}, {}))
function expressionNodes(expression: CalculationExpr): CalculationExpr[] {
 const found: CalculationExpr[] = [], pending: unknown[] = [expression]
 while (pending.length) {
  const item = pending.pop()
  if (!object(item)) continue
  if (typeof item.kind === 'string') found.push(item as CalculationExpr)
  if (found.length > 512) fail('rdl_expression_limit', 422)
  for (const value of Object.values(item)) if (Array.isArray(value)) pending.push(...value); else if (object(value)) pending.push(value)
 }
 return found
}

/** Only the supplied immutable native answer rows are available to this runtime.
 * Query parameters narrow those rows; source commands are never executed. */
export function createReportRuntime(project: RdlProject, tables: Record<string, RdlTable>) {
 return { resolve(file: string, supplied: Record<string, unknown>) {
  const report = project.definition.reports.find(item => item.file === file)?.tree
  if (!report) fail('rdl_report_not_found', 422)
  if (!object(supplied) || Object.keys(supplied).length > 64) fail('rdl_parameter_input_required', 422)
  const declarations = new Map<string, RdlNode>(), datasets = new Map<string, RdlNode>()
  for (const [container, kind, destination] of [['ReportParameters', 'ReportParameter', declarations], ['DataSets', 'DataSet', datasets]] as const) {
   const root = child(report, container)
   for (const node of root ? children(root, kind) : []) {
    const name = node.attributes.Name
    if (!name || destination.has(name)) fail('rdl_duplicate_or_missing_name', 422)
    destination.set(name, node)
   }
  }
  if (declarations.size > 64) fail('rdl_parameter_limit', 422)
  for (const name of Object.keys(supplied)) if (!declarations.has(name)) fail('rdl_unknown_parameter', 422)
  const parameters: Record<string, Literal> = Object.create(null), resolving = new Set<string>(), resolvingDatasets = new Set<string>(), cache = new Map<string, RdlTable>()

  function literal(raw: unknown, declaration: RdlNode): Literal {
   const kind = text(declaration, 'DataType'), types: Record<string, DataType> = { String: 'text', Text: 'text', Integer: 'number', Float: 'number', Boolean: 'boolean', DateTime: 'date' }
   if (!own(types, kind)) fail('rdl_parameter_type_unsupported', 422)
   const type = types[kind]
   let value: Literal
   if (object(raw) && raw.kind === 'literal') {
    if (raw.type !== type && raw.type !== 'null') fail('rdl_parameter_type_mismatch', 422)
    value = raw as Literal
   } else if (raw === null) value = { kind: 'literal', type: 'null', value: null }
   else {
    if (type === 'boolean' && typeof raw === 'string') {
     if (!['true', 'false'].includes(raw.trim().toLowerCase())) fail('rdl_parameter_boolean_required', 422)
     raw = raw.trim().toLowerCase() === 'true'
    }
    if (type === 'number' && typeof raw === 'number') {
     if (!Number.isSafeInteger(raw)) fail('rdl_parameter_exact_number_required', 422)
     raw = String(raw)
    }
    if (type !== 'boolean' && typeof raw !== 'string') fail('rdl_parameter_scalar_required', 422)
    if (typeof raw === 'string' && raw.length > 4096) fail('rdl_parameter_value_limit', 422)
    value = { kind: 'literal', type, value: type === 'number' || type === 'date' ? String(raw).trim() : raw as string | boolean }
   }
   const checked = evaluateCalculatedField(value, {}, {})
   if (checked.type === 'null' && text(declaration, 'Nullable') !== 'true') fail('rdl_parameter_null_refused', 422)
   if (checked.type === 'text' && !checked.value.length && text(declaration, 'AllowBlank') !== 'true') fail('rdl_parameter_blank_refused', 422)
   if (checked.type === 'text' && checked.value.length > 4096) fail('rdl_parameter_value_limit', 422)
   if (kind === 'Integer' && checked.type === 'number' && checked.denominator !== '1') fail('rdl_parameter_integer_required', 422)
   return asLiteral(checked)
  }

  function evaluate(node: RdlNode, table?: RdlTable, row?: InputRow): CalculationValue {
   if (!node.expression) {
    if (node.text.trim().startsWith('=')) fail('rdl_expression_unsupported', 422)
    if (node.children.length) fail('rdl_scalar_value_required', 422)
    if (Object.entries(node.attributes).some(([name, value]) => /(?:^|:)nil$/.test(name) && value === 'true')) return { type: 'null' }
    return { type: 'text', value: node.text }
   }
   const nodes = expressionNodes(node.expression)
   for (const expression of nodes) if (expression.kind === 'parameter') parameter(expression.name)
   if (!table && node.dataset) table = dataset(node.dataset)
   const schema = table?.schema ?? {}
   const scalarFields = (expression: CalculationExpr): string[] => expression.kind === 'aggregate' ? [] : expression.kind === 'field' ? [expression.field] : expression.kind === 'binary' ? [...scalarFields(expression.left), ...scalarFields(expression.right)] : expression.kind === 'unary' ? scalarFields(expression.expression) : expression.kind === 'call' ? expression.args.flatMap(scalarFields) : []
   const fields = scalarFields(node.expression)
   if (fields.length && !row) {
    if (!table) fail('rdl_field_row_context_required', 422)
    if (!table.rows.length) return {type: 'null'}
    for (const field of fields) {
     const values = new Set(table.rows.map(row => JSON.stringify(evaluateCalculatedField({kind: 'field', field}, row, schema))))
     if (values.size !== 1) fail('rdl_ambiguous_group_field', 422)
    }
    row = table.rows[0]
   }
   try {return calculation(() => evaluateRdlExpression(node.expression!, table, row, parameters))} catch (error) {return expressionProblem(node, error)}
  }

  function values(node: RdlNode, declaration: RdlNode): Literal[] {
   const reference = child(node, 'DataSetReference')
   if (reference) {
    if (child(node, 'Values') || child(node, 'ParameterValues')) fail('rdl_parameter_values_ambiguous', 422)
    const source = dataset(text(reference, 'DataSetName')), field = text(reference, 'ValueField')
    if (!own(source.schema, field)) fail('rdl_parameter_value_field_required', 422)
    return source.rows.map(row => literal(asLiteral(evaluateCalculatedField({ kind: 'field', field }, row, source.schema)), declaration))
   }
   const defaults = child(node, 'Values'), valid = child(node, 'ParameterValues')
   if (defaults && valid) fail('rdl_parameter_values_ambiguous', 422)
   const items = defaults ? children(defaults, 'Value') : valid ? children(valid, 'ParameterValue').map(item => child(item, 'Value') ?? fail('rdl_parameter_value_required', 422)) : []
   return items.map(item => literal(item.expression || item.text.trim().startsWith('=') || Object.keys(item.attributes).some(name => /(?:^|:)nil$/.test(name)) ? asLiteral(evaluate(item)) : item.text, declaration))
  }

  function parameter(name: string): Literal {
   if (own(parameters, name)) return parameters[name]
   if (resolving.has(name)) fail('rdl_parameter_dependency_cycle', 422)
   const declaration = declarations.get(name)
   if (!declaration) fail('rdl_unknown_parameter', 422)
   if (text(declaration, 'MultiValue') === 'true') fail('rdl_multivalue_parameter_unsupported', 422)
   resolving.add(name)
   let value: Literal
   if (own(supplied, name)) value = literal(supplied[name], declaration)
   else {
    const definition = child(declaration, 'DefaultValue'), defaults = definition ? values(definition, declaration) : []
    if (defaults.length !== 1) fail('rdl_parameter_default_or_value_required', 422)
    value = defaults[0]
   }
   const valid = child(declaration, 'ValidValues')
   if (valid && !values(valid, declaration).some(allowed => normalized(allowed) === normalized(value))) fail('rdl_parameter_value_not_allowed', 422)
   parameters[name] = value
   resolving.delete(name)
   return value
  }

  function dataset(name: string): RdlTable {
   const cached = cache.get(name)
   if (cached) return cached
   if (resolvingDatasets.has(name)) fail('rdl_parameter_dataset_cycle', 422)
   const definition = datasets.get(name), key = file + '\n' + name
   if (!definition || !own(tables, key)) fail('rdl_dataset_binding_required', 422)
   const source = tables[key]
   if (!source || source.rows.length > 2000) fail('rdl_dataset_limit', 422)
   resolvingDatasets.add(name)
   let rows = source.rows
   const query = child(definition, 'Query'), queryParameters = query && child(query, 'QueryParameters'), used = new Set<string>()
   for (const queryParameter of queryParameters ? children(queryParameters, 'QueryParameter') : []) {
    const parameterName = queryParameter.attributes.Name, field = source.parameterFields[parameterName], value = child(queryParameter, 'Value')
    if (!parameterName || used.has(parameterName) || !own(source.parameterFields, parameterName) || !own(source.schema, field)) fail('rdl_query_parameter_mapping_required', 422)
    used.add(parameterName)
    if (!value?.expression || value.expression.kind !== 'parameter') fail('rdl_query_parameter_expression_unsupported', 422)
    const suppliedValue = parameter(value.expression.name)
    rows = rows.filter(row => {
     const equal = evaluateCalculatedField({ kind: 'binary', op: '=', left: { kind: 'field', field }, right: suppliedValue }, row, source.schema)
     return equal.type === 'boolean' && equal.value
    })
   }
   const result = { ...source, rows }
   cache.set(name, result)
   resolvingDatasets.delete(name)
   return result
  }
  for (const name of declarations.keys()) parameter(name)
  return { parameters, dataset, evaluate }
 } }
}
