import { AiError, aiConfig, createAiClient } from '../../../modules/ai/index.mjs'
import { questionPrompt } from './prompt'
import { responseJson, responsePlan } from './response'
import { PlannerError, plannerFail, type PlannerInput, type PlannerReceipt, type QuestionPlan } from './types'

const DEADLINE_MS = 30000
/** Exactly one production Base AI request, using owner enablement, transport,
 * credentials and explicit AI_MODEL. There is no default model or retry path. */
export async function planQuestion(env: Record<string, unknown>, input: PlannerInput, signal?: AbortSignal): Promise<{ plan: QuestionPlan; provider: PlannerReceipt }> {
 const config = aiConfig(env)
 if (config.enabled !== true) return plannerFail('ai_disabled', 503)
 if (typeof config.model !== 'string' || !config.model.trim() || config.model.length > 256 || /[\s\u0000-\u001f]/.test(config.model)) return plannerFail('ai_misconfigured', 503)
 if (signal?.aborted) return plannerFail('planner_cancelled', 499)
 const prepared = questionPrompt(input), client = createAiClient(config), controller = new AbortController()
 return new Promise((resolve, reject) => {
  let settled = false
  const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancelled) }
  const finish = (error?: unknown, value?: { plan: QuestionPlan; provider: PlannerReceipt }) => { if (settled) return; settled = true; cleanup(); if (error) reject(error); else resolve(value!) }
  const cancelled = () => { controller.abort(); finish(new PlannerError('planner_cancelled', 499)) }
  const timer = setTimeout(() => { controller.abort(); finish(new PlannerError('planner_timeout', 504)) }, DEADLINE_MS)
  signal?.addEventListener('abort', cancelled, { once: true })
  if (signal?.aborted) { cancelled(); return }
  void (async () => {
   try {
    const response = await client.responses({ ...prepared.body, model: config.model }, { feature: 'bifocal.questions', signal: controller.signal })
    const raw = await responseJson(response, controller.signal), { plan, model, responseId, usage } = responsePlan(raw, input)
    finish(undefined, { plan, provider: { model, responseId, usage, promptVersion: prepared.version } })
   } catch (error) {
    if (error instanceof PlannerError) finish(error)
    else if (error instanceof AiError) finish(new PlannerError(error.code, error.status))
    else finish(new PlannerError('planner_unavailable'))
   }
  })()
 })
}
