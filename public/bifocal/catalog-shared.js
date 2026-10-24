export const $ = id => document.getElementById(id)
export const itemUrl = id => '/app/library/items/' + encodeURIComponent(id)
export const apiItem = id => '/api/operator/library/items/' + encodeURIComponent(id)
export function element(tag, attributes = {}, ...children) {
 const node = document.createElement(tag)
 for (const [key, value] of Object.entries(attributes)) if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value === true ? '' : String(value))
 for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)))
 return node
}
const messages = { session_required: 'Your session ended. Sign in again before continuing.', owner_required: 'This action requires the current owner.', content_not_found: 'This content is unavailable to your current account.', catalog_conflict: 'Your session, grant, content or privacy policy changed. Reload and review the current state.', exact_archive_review_required: 'This archive review is out of date. Review the current dependencies again.', usage_privacy_consent_required: 'Usage is disabled. Review the privacy settings before importing events or inspecting hygiene.', exact_owner_privacy_consent_required: 'The privacy policy changed. Reload settings and review this consent again.', current_metadata_review_required: 'This metadata version changed. Reopen the item before editing it.', restore_before_edit: 'Restore archived content before editing it.', usage_event_outside_ninety_days: 'Every usage event must be a UTC ISO timestamp within the last 90 days.', bounded_authorized_events_required: 'Review up to 200 authorized events against the current privacy policy.', grant_enabled_required: 'Choose an access change.', typed_metric_query_required: 'A certified metric requires an executable typed query definition.' }
export async function request(path, method = 'GET', body) {
 const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
 let data; try { data = await response.json() } catch { throw Error('The library returned an unreadable response. Reload this page.') }
 if (!response.ok) throw Error(messages[data.error] ?? 'The library refused this action. Check the entered values and reload the current state.')
 return data
}
export function status(message = '', error = false, id = 'library-status') { const node = $(id); if (node) { node.textContent = message; node.dataset.error = String(error) } }
export function action(node, work) {
 node.addEventListener(node.tagName === 'FORM' ? 'submit' : 'click', async event => {
  event.preventDefault(); const button = node.tagName === 'FORM' ? event.submitter : node
  if (button) button.disabled = true
  try { await work(event); status('') } catch (error) { status(error.message || 'Could not complete this action.', true) } finally { if (button) button.disabled = false }
 })
}
export function safeLink(value) {
 if (typeof value !== 'string') return null
 if (value.startsWith('/') && !value.startsWith('//') && !/[?#\\]/.test(value)) return value
 try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url.href : null } catch { return null }
}
export function sourceLinks(item) {
 const links = item.sourceLinks.map(safeLink).filter(Boolean)
 return links.length ? element('ul', { class: 'library-links' }, links.map(href => element('li', {}, element('a', { href, rel: 'noreferrer' }, href)))) : element('p', { class: 'meta' }, 'No source links are registered.')
}
export function metadata(form) {
 const values = new FormData(form), lines = name => String(values.get(name) ?? '').split('\n').map(value => value.trim()).filter(Boolean)
 let definition; try { definition = JSON.parse(String(values.get('definition'))) } catch { throw Error('Enter valid JSON for the content definition. Your edits have been kept.') }
 if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw Error('The content definition must be a JSON object.')
 return { title: String(values.get('title')), kind: String(values.get('kind')), description: String(values.get('description')), tags: lines('tags'), sourceLinks: lines('sourceLinks'), definition, collectionId: values.get('collectionId') || null, verified: values.get('verified') === 'on', sourceDatasets: String(values.get('sourceDatasets') ?? '').split(',').map(value => value.trim()).filter(Boolean) }
}
export function table(caption, headings, rows) {
 return element('div', { class: 'tablewrap', tabindex: '0', role: 'region', 'aria-label': caption }, element('table', {}, element('caption', {}, caption), element('thead', {}, element('tr', {}, headings.map(name => element('th', { scope: 'col' }, name)))), element('tbody', {}, rows.map(cells => element('tr', {}, cells.map(value => element('td', {}, value)))))))
}
export const json = value => element('pre', {}, JSON.stringify(value, null, 2))
export const contentLink = (id, title) => element('a', { href: itemUrl(id) }, title ?? id)
let peoplePromise
export function people() { peoplePromise ??= request('/auth/operators'); return peoplePromise }
export function readers(select, operators) { select.replaceChildren(element('option', { value: '' }, 'Choose an active reader'), ...operators.filter(person => person.status === 'active').map(person => element('option', { value: person.id }, `${person.displayName} · ${person.email}`))) }
