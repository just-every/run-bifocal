import { approvalTooltips } from './approval-tooltips.js'
approvalTooltips()
import { instanceControls } from './report-instance.js'
import { element, metadata, table } from './file-view.js'
import { figure, label, stamp } from './format.js'

const $ = id => document.getElementById(id), runId = document.body.dataset.runId, zone = document.body.dataset.zone
const root = '/api/operator/report-runs/' + encodeURIComponent(runId), json = value => JSON.stringify(value, null, 2)
const downloadable = new Set(['approved', 'accepted', 'development'])
let instance
let run = null, people = [], grants = [], reviewed = null, busy = false
const messages = {
 session_required: 'Your native session ended. Sign in again to check report access.',
 report_not_found: 'This report is unavailable to your current account. A reviewer grant may have expired or been revoked.',
 report_withdrawn_or_retention_expired: 'The controlled artifact was withdrawn or its retention expired.',
 report_not_downloadable: 'This report is not currently downloadable.',
 download_expired_or_revoked: 'This download expired or its access was revoked.',
 report_artifact_integrity_failed: 'The artifact failed its integrity check. Access is unavailable.',
 exact_reviewer_artifact_review_required: 'The exact artifact review changed. Refresh access and review the person, digest and expiry again.',
 reviewer_membership_changed: 'The selected person’s membership changed. Refresh access before reviewing a new grant.',
 reviewer_grant_expiry_required: 'Choose a future expiry within seven days and within the artifact retention cutoff.',
}
function status(message, error = false) { $('report-status').textContent = message; $('report-status').dataset.error = String(error); $('report-status').setAttribute('role', error ? 'alert' : 'status') }
async function checked(response) {
 if (response.ok) return response
 const value = await response.json(), error = Error(messages[value.error] ?? value.reason ?? String(value.error).replaceAll('_', ' ')); error.status = response.status; throw error
}
async function request(path, method = 'GET', body) {
 const response = await checked(await fetch(path, { method, cache: 'no-store', credentials: 'same-origin', redirect: 'error', headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
 return response.status === 204 ? null : response.json()
}
function invalidateReview() { instance?.invalidate(); reviewed = null; $('report-grant-confirm').checked = false; $('report-grant-preview').hidden = true; $('report-grant-save').disabled = true }
function clearReport() {
 run = null; people = []; grants = []; invalidateReview(); $('report-workspace').hidden = true; $('owner-report-tools').hidden = true; $('report-owner-history').hidden = true; $('report-title').textContent = 'Report access unavailable'
 for (const id of ['report-metadata', 'report-related', 'report-totals', 'report-rows', 'report-cutoffs', 'report-grants', 'report-pending', 'report-history', 'report-grant-summary', 'report-reviewer']) $(id).replaceChildren()
 for (const id of ['report-state', 'report-narrative', 'report-definition', 'report-json', 'report-access', 'report-correction', 'report-freshness', 'report-external-copies']) $(id).textContent = ''
 $('report-grant-expiry').value = ''
}
async function act(work) {
 if (busy) return
 busy = true; $('report-workspace').inert = true; $('report-refresh').disabled = true; $('report-workspace').setAttribute('aria-busy', 'true'); status('Checking current report access…')
 try { await work() } catch (error) {
  invalidateReview()
  if ([401, 403, 404, 410].includes(error.status)) clearReport()
  if (error.status === 401) { $('report-sign-in').href = '/signin?returnTo=' + encodeURIComponent(location.pathname); $('report-sign-in').hidden = false }
  status(error.message, true)
 } finally { busy = false; $('report-workspace').inert = false; $('report-refresh').disabled = false; $('report-workspace').removeAttribute('aria-busy'); approvalControl() }
}
function approvalControl() { $('report-grant-save').disabled = !reviewed || !$('report-grant-confirm').checked }
const owner = () => run?.access.kind === 'owner' && run.access.readOnly === false
const personName = id => { const person = people.find(person => person.id === id); return person ? person.displayName + ' · ' + person.email : id }
function artifactView() {
 const artifact = run.artifact; $('report-artifact').hidden = !artifact
 if (!artifact) return
 $('report-title').textContent = artifact.title; $('report-narrative').textContent = artifact.narrative; $('report-narrative').hidden = !artifact.narrative
 $('report-freshness').textContent = artifact.staleLabel ?? artifact.freshnessMeaning; $('report-freshness').hidden = false
 const totals = $('report-totals'); totals.replaceChildren()
 const shown = value => value.state === 'value' ? figure(value.value, value.unit, artifact.context.currency) : label(value.state), measures = Object.keys(artifact.answer.totals)
 for (const id of measures) { const tile = element('div', undefined, 'kpi'); tile.append(element('span', label(id), 'kpi-label'), element('strong', shown(artifact.answer.totals[id]), 'kpi-value')); totals.append(tile) }
 const dimensionCount = artifact.answer.rows[0]?.dimensions.length ?? 0
 $('report-rows').replaceChildren(table('Exact retained artifact rows', [...Array.from({ length: dimensionCount }, (_, index) => 'Group ' + (index + 1)), ...measures.map(label)], artifact.answer.rows.map(row => [...row.dimensions, ...measures.map(id => shown(row.values[id]))])))
 $('report-cutoffs').replaceChildren(table('Frozen source cutoffs', ['Dataset', 'Revision', 'Source updated', 'Digest'], artifact.sourceCutoffs.map(source => [source.dataset, source.revision, stamp(source.updatedAt, zone), source.sha256])))
 $('report-definition').textContent = json({ artifactRevision: artifact.revision, artifactCreatedAt: artifact.artifactCreatedAt, snapshotCreatedAt: artifact.snapshotCreatedAt, metricVersion: artifact.metricVersion, metricRef: artifact.metricRef, definitionVersions: artifact.definitionVersions, filters: artifact.filters, audience: artifact.audience, freshness: artifact.freshness, freshnessMeaning: artifact.freshnessMeaning, observedSources: artifact.observedSources })
 $('report-json').textContent = json(artifact); $('report-download').disabled = !downloadable.has(run.state)
}
function grantsView() {
 const box = $('report-grants'); box.replaceChildren()
 if (!grants.length) box.append(element('p', 'No named reviewer grants have been recorded for this artifact.'))
 for (const grant of grants) {
  const name = personName(grant.reviewerId), section = element('div', undefined, 'report-grant-row'), state = grant.revokedAt ? 'Revoked' : grant.active ? 'Active' : Date.parse(grant.expiresAt) <= Date.now() ? 'Expired' : 'Inactive'
  section.append(element('h4', name), metadata([['State', state], ['Exact artifact digest', grant.digest], ['Expires', stamp(grant.expiresAt, zone)], ['Created', stamp(grant.createdAt, zone)], ['Revoked', grant.revokedAt ? stamp(grant.revokedAt, zone) : 'No revocation recorded'], ['Reviewer version', grant.reviewerVersion]]))
  if (!grant.revokedAt) { const revoke = element('button', 'Revoke access for ' + name); revoke.type = 'button'; revoke.onclick = () => act(async () => { await request(root + '/grants/' + encodeURIComponent(grant.id), 'DELETE'); await load(); status('The named grant was revoked. Future downloads require current access.') }); section.append(revoke) }
  box.append(section)
 }
}
function ownerView() {
 instance?.render(run)
 $('owner-report-tools').hidden = !owner(); $('report-owner-history').hidden = !owner()
 if (!owner()) return
 const picker = $('report-reviewer'); picker.replaceChildren(new Option('Choose an active person', ''))
 for (const person of people.filter(person => person.status === 'active' && person.role !== 'owner')) picker.add(new Option(person.displayName + ' · ' + person.email, person.id))
 $('report-grant-review').disabled = !run.artifact || !downloadable.has(run.state); grantsView()
 $('report-pending').replaceChildren(table('Pending recipients without artifact authority', ['Person', 'Reviewed person version', 'Currently active'], run.pendingRecipients.map(person => [personName(person.reviewerId), person.reviewerVersion, person.active ? 'Yes' : 'No'])))
 $('report-history').replaceChildren(table('Custody audit', ['Actor', 'Action', 'Custody version', 'Recorded'], run.audit.map(event => [event.actor_id, label(event.action), event.version, stamp(event.recorded_at, zone)])), table('Historical dispatch facts', ['Attempt', 'Recipient', 'Outcome', 'Provider', 'Recorded'], run.dispatches.map(event => [event.id, personName(event.recipient_id), label(event.outcome), event.provider, stamp(event.recorded_at, zone)])))
}
function render() {
 $('report-workspace').hidden = false; $('report-sign-in').hidden = true; $('report-title').textContent = 'Report artifact'; $('report-state').textContent = 'Custody state: ' + label(run.state)
 $('report-metadata').replaceChildren(metadata([['Report run', run.id], ['Series', run.seriesId], ['Artifact revision', run.revision], ['Period', run.period], ['Custody state version', run.version], ['Artifact digest', run.digest ?? 'No controlled artifact'], ...(run.createdAt ? [['Run created', stamp(run.createdAt, zone)]] : []), ...(run.artifact ? [['Artifact rendered', stamp(run.artifact.artifactCreatedAt, zone)], ['Source snapshot saved', stamp(run.artifact.snapshotCreatedAt, zone)]] : []), ['Retention cutoff', run.retainUntil ? stamp(run.retainUntil, zone) : 'No dated cutoff recorded']]))
 $('report-correction').textContent = run.corrects ? 'This revision corrects report run ' + run.corrects + '. The original artifact remains unchanged.' : 'This is the original artifact in this report series.'
 $('report-related').replaceChildren()
 if (run.corrects) { const link = element('a', 'Check access to the referenced original version'); link.href = '/app/report-runs/' + encodeURIComponent(run.corrects); $('report-related').append(link) }
 $('report-access').textContent = owner() ? 'Current installation owner access. Reviewer grants are separate from the artifact’s frozen audience.' : 'Named reviewer access to this exact artifact only. Grant expires ' + stamp(run.access.expiresAt, zone) + '.'
 $('report-external-copies').textContent = run.externalCopies ?? ''; $('report-external-copies').hidden = !run.externalCopies
 $('report-freshness').hidden = true; artifactView(); ownerView()
 if (!run.artifact) status(['cancelled', 'erased'].includes(run.state) ? 'This report is ' + run.state + '. No controlled artifact is available to download.' : 'No immutable artifact is available in the current custody state.')
 else status('This exact immutable artifact is available under your current native session.')
}
async function load() {
 invalidateReview(); const value = await request(root)
 let operatorList = [], grantList = []
 if (value.access.kind === 'owner' && !value.access.readOnly) { const results = await Promise.all([request('/auth/operators'), request(root + '/grants')]); operatorList = results[0]; grantList = results[1].grants }
 run = value; people = operatorList; grants = grantList; render()
}
function grantInput() {
 if (!owner() || !run.artifact || !downloadable.has(run.state)) throw Error('An approved retained artifact and current owner access are required.')
 if (!$('report-grant-form').reportValidity()) throw Error('Choose an active named reviewer and an exact expiry.')
 const person = people.find(person => person.id === $('report-reviewer').value && person.status === 'active' && person.role !== 'owner')
 if (!person) throw Error('Choose an active person from the native account list.')
 const expiry = new Date($('report-grant-expiry').value).getTime(), now = Date.now()
 if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 7 * 86400000 || run.retainUntil && expiry > Date.parse(run.retainUntil)) throw Error('The expiry must be in the future, within seven days and within the retained artifact cutoff.')
 return { reviewerId: person.id, reviewerVersion: person.version, digest: run.digest, previousVersion: run.version, expiresAt: new Date(expiry).toISOString() }
}
$('report-refresh').onclick = () => act(load)
$('report-grant-form').oninput = invalidateReview
$('report-grant-form').onsubmit = event => { event.preventDefault(); act(async () => {
 const input = grantInput(); invalidateReview(); reviewed = input
 $('report-grant-summary').replaceChildren(metadata([['Named person', personName(input.reviewerId)], ['Person id', input.reviewerId], ['Person version', input.reviewerVersion], ['Report title', run.artifact.title], ['Report run', run.id], ['Artifact revision', run.revision], ['Exact artifact digest', input.digest], ['Custody version', input.previousVersion], ['Expiry', stamp(input.expiresAt, zone)], ['Exact UTC expiry', input.expiresAt]]))
 $('report-grant-preview').hidden = false; status('Review the exact person, artifact digest and expiry, then explicitly approve the grant.')
}) }
$('report-grant-confirm').onchange = approvalControl
$('report-grant-save').onclick = () => act(async () => {
 if (!reviewed || !$('report-grant-confirm').checked) throw Error('Review and explicitly approve this exact named grant first.')
 if (json(grantInput()) !== json(reviewed)) { invalidateReview(); throw Error('The grant changed. Review the current exact person, artifact and expiry again.') }
 const input = reviewed; invalidateReview(); await request(root + '/grants', 'POST', input); await load(); status('The named reviewer now has expiring access to this exact artifact version through their own native sign-in.')
})
$('report-download').onclick = () => act(async () => {
 if (!run?.artifact) throw Error('No controlled artifact is available to download.')
 const response = await checked(await fetch(root + '/download', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' })), bytes = await response.blob(), url = URL.createObjectURL(bytes), link = element('a')
 link.href = url; link.download = 'bifocal-report-' + runId + '.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
 status('The authorized immutable artifact was downloaded through the native audited route.')
})
instance = instanceControls({request,act,load,status,getRun:()=>run})
await act(load)
