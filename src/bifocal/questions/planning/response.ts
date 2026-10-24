import { plannerFail, type PlannerInput, type QuestionPlan } from './types'
import { plain, shortText, validateQuestionPlan } from './validate'
const MAX_RESPONSE_BYTES = 262144
export async function responseJson(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
 const contentType = response.headers.get('content-type') ?? ''
 if (!/^application\/(?:[a-z0-9.-]+\+)?json(?:\s*;|$)/i.test(contentType) || !response.body) { await response.body?.cancel(); return plannerFail('planner_invalid_response') }
 const declared = response.headers.get('content-length')
 if (declared && Number(declared) > MAX_RESPONSE_BYTES) { await response.body.cancel(); return plannerFail('planner_too_large') }
 const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true }); let size = 0, text = ''
 const cancel = () => { void reader.cancel().catch(() => undefined) }
 signal.addEventListener('abort', cancel, { once: true })
 try {
  if (signal.aborted) return plannerFail('planner_cancelled', 499)
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > MAX_RESPONSE_BYTES) return plannerFail('planner_too_large'); text += decoder.decode(chunk.value, { stream: true }) }
  if (signal.aborted) return plannerFail('planner_cancelled', 499)
  text += decoder.decode()
  let parsed: unknown; try { parsed = JSON.parse(text) } catch { return plannerFail('planner_invalid_response') }
  if (!plain(parsed)) return plannerFail('planner_invalid_response')
  return parsed
 } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
export function responsePlan(raw: Record<string, unknown>, input: PlannerInput): { plan: QuestionPlan; responseId: string; model: string; usage: unknown } {
 if (raw.status !== 'completed' || raw.incomplete_details != null) return plannerFail('planner_incomplete')
 if (raw.error != null || !Array.isArray(raw.output) || !raw.output.length || raw.output.length > 32) return plannerFail('planner_invalid_response')
 const texts: string[] = []
 for (const item of raw.output) {
  if (!plain(item)) return plannerFail('planner_invalid_response')
  if (item.type === 'reasoning') continue
  if (item.type !== 'message' || item.role !== 'assistant' || item.status !== 'completed' || !Array.isArray(item.content) || item.content.length > 16) return plannerFail('planner_invalid_response')
  for (const content of item.content) {
   if (!plain(content)) return plannerFail('planner_invalid_response')
   if (content.type === 'refusal' || content.refusal !== undefined) return plannerFail('planner_refused', 422)
   if (content.type !== 'output_text' || !shortText(content.text, 65536)) return plannerFail('planner_invalid_response')
   texts.push(content.text)
  }
 }
 if (texts.length !== 1 || !shortText(raw.id, 160) || !/^[A-Za-z0-9_-]+$/.test(raw.id) || !shortText(raw.model, 256) || !/^[A-Za-z0-9@][A-Za-z0-9._:/@-]*$/.test(raw.model)) return plannerFail('planner_invalid_response')
 let parsed: unknown; try { parsed = JSON.parse(texts[0]) } catch { return plannerFail('planner_invalid_response') }
 const plan = validateQuestionPlan(parsed, input)
 // Receipt output deliberately admits fixed numeric token fields only. Raw
 // provider extension strings and exception content never reach application UI.
 let usage: Record<string, unknown> | null = null
 if (raw.usage != null) {
  if (!plain(raw.usage)) return plannerFail('planner_invalid_response')
  usage = {}
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) if (raw.usage[key] !== undefined) { const value = raw.usage[key]; if (!Number.isSafeInteger(value) || Number(value) < 0) return plannerFail('planner_invalid_response'); usage[key] = value }
  for (const [key, detail] of [['input_tokens_details', 'cached_tokens'], ['output_tokens_details', 'reasoning_tokens']] as const) if (raw.usage[key] != null) { const value = raw.usage[key]; if (!plain(value) || !Number.isSafeInteger(value[detail]) || Number(value[detail]) < 0) return plannerFail('planner_invalid_response'); usage[key] = { [detail]: value[detail] } }
 }
 return { plan, responseId: raw.id, model: raw.model, usage }
}
