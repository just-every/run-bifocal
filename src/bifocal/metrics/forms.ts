// The owner form pages (Metrics, Goals, Data quality) draw every form the same way: a panel with its heading, one
// control per field with its hint beneath, and the one filled action. A refused submit re-renders the same page with
// the person's values kept, the offending field marked (aria-invalid and a described plain sentence) or, when no single
// field is at fault, one plain sentence at the top of that form. The refusal code is never shown, only carried as data.
import { escapeHtml } from '../../app/shell'

/** A refused submit: the form it came from, what the person entered, the field at fault (if one) and the sentence. */
export type Refusal = { form: string; values: Record<string, unknown>; field: string | null; message: string; code: string }

const own = (refusal: Refusal | undefined, form: string) => refusal?.form === form ? refusal : undefined
const kept = (refusal: Refusal | undefined, name: string) => typeof refusal?.values[name] === 'string' ? refusal.values[name] as string : undefined

type ControlOptions = { value?: string; kind?: string; refusal?: Refusal; hint?: string; rows?: number; required?: boolean }

/** One labelled field. A refused value comes back as entered; the field at fault is marked and focused. */
export function control(form: string, name: string, label: string, { value = '', kind = 'text', refusal, hint, rows, required = true }: ControlOptions = {}) {
 const mine = own(refusal, form), id = `${form}-${name}`, invalid = mine?.field === name, current = kept(mine, name) ?? value
 const described = [hint ? id + '-hint' : '', invalid ? id + '-error' : ''].filter(Boolean).join(' ')
 const attrs = `id="${id}" name="${name}"${required ? ' required' : ''}${described ? ` aria-describedby="${described}"` : ''}${invalid ? ' aria-invalid="true" autofocus' : ''}`
 const field = rows ? `<textarea ${attrs} rows="${rows}" spellcheck="false">${escapeHtml(current)}</textarea>` : `<input ${attrs} type="${kind}" value="${escapeHtml(current)}">`
 return `<div class="control"><label for="${id}">${escapeHtml(label)}</label>${field}${hint ? `<p class="hint" id="${id}-hint">${hint}</p>` : ''}${invalid ? `<p class="field-error" id="${id}-error">${escapeHtml(mine!.message)}</p>` : ''}</div>`
}

/** A confirmation checkbox beside its text. `keep` is false when the thing confirmed changed under the person. */
export function checkbox(form: string, name: string, value: string, label: string, refusal?: Refusal, keep = true) {
 const mine = own(refusal, form), id = `${form}-${name}`, invalid = mine?.field === name, checked = keep && kept(mine, name) === value
 return `<label class="checkbox"><input type="checkbox" id="${id}" name="${name}" value="${value}" required${checked ? ' checked' : ''}${invalid ? ` aria-invalid="true" aria-describedby="${id}-error" autofocus` : ''}>${escapeHtml(label)}</label>${invalid ? `<p class="field-error" id="${id}-error">${escapeHtml(mine!.message)}</p>` : ''}`
}

/** The sentence for a refusal no single field explains, at the top of its form or page. */
export const refusalLine = (refusal: Refusal | undefined, form: string) => {
 const mine = own(refusal, form)
 return mine && !mine.field ? `<p class="status" data-error="true" role="alert" data-refusal="${escapeHtml(mine.code)}">${escapeHtml(mine.message)}</p>` : ''
}

/** One form in its card: heading with room, the form-level sentence if any, then the fields and actions. */
export function formPanel(form: string, heading: string, action: string, body: string, refusal?: Refusal) {
 const mine = own(refusal, form)
 return `<section class="panel" id="${form}"${mine ? ` data-refusal="${escapeHtml(mine.code)}"` : ''}><h2>${escapeHtml(heading)}</h2>${refusalLine(refusal, form)}<form method="post" action="${action}">${body}</form></section>`
}

/** A quiet disclosure inside a card (the card already draws the edge). */
export const disclosure = (label: string, value: unknown) => `<details><summary>${escapeHtml(label)}</summary><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></details>`

export const actions = (label: string, primary = true) => `<div class="actions"><button type="submit"${primary ? ' class="primary"' : ''}>${escapeHtml(label)}</button></div>`
