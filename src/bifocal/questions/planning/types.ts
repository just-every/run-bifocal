import type { Filter, Measure } from '../../query/types'
export type QuestionPeriod = { kind: 'all' | 'range' | 'quarter-to-date' | 'year-to-date' | 'last-quarter' | 'month' | 'last-month'; column: string; asOf: string; from: string; to: string }
export type QuestionPlanFilter = { column: string; op: 'eq' | 'ne' | 'in' | 'gte' | 'lte'; value: string; values: string[] }
export type QuestionPlan = {
 decision: 'answer' | 'clarify' | 'refuse'; message: string; missing: string[]; intent: 'query' | 'why'
 measureIds: string[]; groupBy: string[]; filters: QuestionPlanFilter[]
 period: QuestionPeriod; comparison: QuestionPeriod | null; drivers: string[]
 priceVolume: { revenue: string; quantity: string; product: string } | null
}
export type PlannerInput = {
 question: string
 model: { id: string; revision: string; viewId: string; dimensions: { column: string; type: 'text' | 'number' | 'money' | 'date' | 'boolean' }[]; measures: Measure[]; calendar: { id: string; version: number; definition: Record<string, unknown> }; timezone: string; immutableFilters: Filter[]; rowRules: Filter[]; fiscal: Record<string, unknown> | null }
 context: { groupBy: string[]; measureIds: string[]; filters: Filter[]; period: QuestionPeriod | null } | null
 asOf: string
}
export type PlannerReceipt = { model: string; responseId: string; usage: unknown; promptVersion: string }
export class PlannerError extends Error {
 readonly code: string
 readonly status: number
 constructor(code: string, status = 502) {
  const messages: Record<string, string> = { ai_disabled: 'AI question planning is off.', ai_misconfigured: 'Configure the AI transport and an explicit model for question planning.', planner_input_invalid: 'The question or permitted model metadata is invalid.', planner_scope_invalid: 'The question plan references unavailable model fields or measures.', planner_too_large: 'The question planning request or response exceeds its size limit.', planner_refused: 'The AI provider declined this question.', planner_incomplete: 'The AI provider did not complete a question plan.', planner_invalid_response: 'The AI provider returned an invalid question plan.', planner_timeout: 'Question planning exceeded its deadline.', planner_cancelled: 'Question planning was cancelled.', planner_unavailable: 'Question planning is unavailable.' }
  super(messages[code] ?? messages.planner_unavailable); this.name = 'PlannerError'; this.code = code; this.status = status
 }
}
export const plannerFail = (code: string, status = 502): never => { throw new PlannerError(code, status) }
