// A preparation refusal keeps its code as data; the person reads one plain sentence for it, at the field it concerns
// (its step's own field, or the ID, source or SQL field) or, when no field fits, once at the top of the card.
import { fields } from './preparation-graph.js'

const ID = 'Use lowercase letters, digits and hyphens, starting with a letter (for example, monthly-orders).'
const missing = id => id ? `There’s no dataset with the ID ${id}. Use the ID of a dataset imported in Files.` : 'A dataset this step uses isn’t imported. Use the ID of a dataset imported in Files.'

/** The sentence for an ID the person typed that the pattern refuses, before anything is sent. */
export const idSentence = ID

/** A refused request: [field id or null, sentence]. `values` are the ID and source the person typed. */
export function requestProblem(code, { dataset, sql }) {
 if (code === 'dataset_not_found' || code === 'preparation_source_unavailable') return ['prep-dataset', missing(dataset)]
 if (code === 'preparation_id_required') return ['prep-id', ID]
 if (sql && ['bounded_preparation_sql_required', 'unsupported_preparation_sql', 'unsupported_preparation_step', 'quoted_preparation_identifier_required', 'preparation_cast_rename_refused', 'preparation_join_alias_mismatch', 'preparation_pivot_literal_required', 'preparation_pivot_projection_required', 'preparation_sql_required', 'bounded_preparation_document_required'].includes(code)) return ['prep-sql', 'This SQL isn’t in the bounded dialect. Write one statement per step that reads INPUT, with quoted column and dataset names.']
 if (code === 'preparation_dataset_required') return [null, 'Each dataset ID in the steps uses lowercase letters, digits and hyphens, starting with a letter.']
 if (['stale_preparation_version', 'exact_current_preparation_review_required', 'preparation_conflict'].includes(code)) return [null, 'This preparation changed after it was loaded or reviewed. Load it again, then review before saving.']
 if (code === 'preparation_restore_source_changed') return [null, 'The source data changed after this revision was saved, so it can’t be restored as it was. Load it and review it as a new draft instead.']
 if (code === 'preparation_revision_not_found') return ['prep-revision', 'That revision is no longer saved. Load the preparation again and choose another.']
 if (code === 'preparation_revision_limit') return [null, 'This preparation has reached its limit of saved revisions, so no more can be saved.']
 if (['preparation_metric_impact_limit', 'preparation_chart_impact_limit', 'preparation_check_limit'].includes(code)) return [null, 'This draft reaches too many certified metrics, charts or checks to review at once.']
 if (code === 'preparation_result_limit') return [null, 'This draft’s output is over the limit of 10,000 rows or 64 columns.']
 return [null, 'This preparation request didn’t go through. Reload the page, then try again.']
}

const titleOf = (op, key) => fields[op]?.find(([name]) => name === key)?.[1] ?? key
const blank = (step, key) => Array.isArray(step?.[key]) ? !step[key].length : !String(step?.[key] ?? '').trim()
const first = (step, keys) => keys.find(key => fields[step?.op]?.some(([name]) => name === key))

/** A step the review blocked: [the step's field key or null, sentence]. `step` is the reviewed step itself. */
export function stepProblem(code, step) {
 const op = step?.op, empty = (fields[op] ?? []).map(([key]) => key).find(key => blank(step, key))
 if (code === 'preparation_name_required') return empty ? [empty, `Enter the ${titleOf(op, empty).toLowerCase().replace(/, one per line$/, '')}.`] : [first(step, ['column', 'name', 'left', 'prefix']) ?? null, 'Use a name of 1 to 128 characters.']
 if (code === 'preparation_columns_required') return [empty ?? first(step, ['columns', 'groupBy', 'values']) ?? null, 'List at least one, one per line.']
 if (code === 'duplicate_preparation_column') return [first(step, ['columns', 'groupBy', 'values']) ?? null, 'Each line must name a different column.']
 if (code === 'preparation_column_not_found') return [first(step, ['column', 'left', 'columns', 'groupBy']) ?? null, 'This step names a column its input doesn’t have. Check each column name in this step, including capitals.']
 if (code === 'preparation_type_required') return ['type', 'Choose the type to repair this column to.']
 if (code === 'preparation_type_conversion_failed') return op === 'cast' && step.column ? ['type', `Some values in ${step.column} can’t be read as ${step.type}. Choose another type, or repair those values in the source.`] : [first(step, ['left', 'column']) ?? null, 'Some values in this step can’t be read as its column types. Check the columns it uses.']
 if (code === 'preparation_money_precision') return ['type', `Money keeps at most two decimal places, and some values in ${step?.column ?? 'this column'} have more. Choose number instead.`]
 if (code === 'preparation_numeric_calculation_required') return ['left', 'Calculate needs two number columns and a new column name that isn’t already used.']
 if (code === 'preparation_source_unavailable') return ['dataset', missing(step?.dataset)]
 if (code === 'preparation_union_schema_mismatch') return ['dataset', 'This dataset’s columns differ from the input’s. Both need the same column names and types, in the same order.']
 if (code === 'preparation_join_type_required') return ['right', 'The two key columns must have the same type.']
 if (code === 'preparation_join_name_conflict') return ['prefix', 'With this prefix some new column names repeat existing ones. Choose another prefix.']
 if (code === 'preparation_join_fanout_refused') return ['right', 'Some keys repeat in the other dataset. Its key column must be unique.']
 if (code === 'preparation_unpivot_schema_mismatch') return ['columns', 'Columns to unpivot must share one type, and the new column names must not repeat existing ones.']
 if (code === 'preparation_pivot_schema_mismatch') return ['column', 'The label column must be text and differ from the value and group columns.']
 if (code === 'preparation_pivot_domain_mismatch') return ['values', 'Some labels in the label column aren’t listed. List every label, one per line.']
 if (code === 'preparation_pivot_duplicate_cell') return ['groupBy', 'Some groups have more than one value for a label. Add group columns so each cell holds one value.']
 if (code === 'preparation_result_limit') return [null, 'This step’s output is over the limit of 10,000 rows or 64 columns.']
 if (code === 'preparation_decimal_limit') return [null, 'This step makes a number with too many digits to keep exactly.']
 return [null, 'This step can’t run on the current source data. Check its fields, then review again.']
}

/** One sentence for an error a review reports beside a metric or chart it would change. */
export const impactSentence = error => error.step ? `Step ${error.step}: ${stepProblem(error.code, null)[1]}` : 'The staged draft can’t produce this value.'
