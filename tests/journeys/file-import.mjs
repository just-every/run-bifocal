import assert from 'node:assert/strict'
import { proveErasureReceipt, proveRetentionHold } from './erasure-receipts.mjs'
import { createHash } from 'node:crypto'
import { zipSync, strToU8 } from 'fflate'
import { proveExactQueries } from './exact-queries.mjs'
import { proveFileBrowser } from './file-browser.mjs'

export async function proveFileImports(origin, context, page, restartWorker) {
 const savedUploads = new Map()
 const digest = bytes => createHash('sha256').update(bytes).digest('hex')
 const dataset = 'synthetic-bifocal-sales'
 const base = { version: 1, datasetId: dataset, filename: 'synthetic-bifocal-1.csv', encoding: 'utf-8', delimiter: ',', nullValue: '', mode: 'replace', key: 'id', formulaTreatment: 'literal-text', data: 'id,date,region,amount,note\r\n1,01/15/2026,West,"$1,234.56","First, sale"\r\n2,01/16/2026,East,-$25.50,\r\n' }
 const post = (action, body, id = dataset, extra = {}) => context.request.post(`${origin}/api/operator/import/${action}`, { headers: { Origin: origin, 'X-Import-Dataset': id, ...extra }, data: body })
 const read = async (id = dataset) => {
  const response = await context.request.get(`${origin}/api/operator/datasets/${id}`)
  assert.equal(response.status(), 200, await response.text()); return response.json()
 }
 async function upload(input, id = dataset, interrupt = false) {
  const bytes = Buffer.from(JSON.stringify(input)), chunks = Math.ceil(bytes.length / 65536), bundleSha256 = digest(bytes)
  let uploadId
  for (let index = 0; index < chunks; index++) {
   const chunk = bytes.subarray(index * 65536, (index + 1) * 65536)
   const body = { ...(uploadId ? { uploadId } : {}), name: 'synthetic-bifocal-1.json', bundleSha256, totalBytes: bytes.length, totalChunks: chunks, index, chunkSha256: digest(chunk), base64: chunk.toString('base64') }
   const response = await post('uploads', body, id)
   assert.equal(response.status(), 200, await response.text())
   const progress = await response.json(); uploadId = progress.uploadId
   if (interrupt && index === 0) {
    await restartWorker()
    assert.equal(progress.complete, false)
    const before = await read(); assert.equal(before.table.rows.length, 2)
    const incomplete = await post('plan', { uploadId, catchup: true }, id)
    assert.equal(incomplete.status(), 409)
    assert.equal((await incomplete.json()).error, 'upload_incomplete')
    const inventory = await post('uploads', { uploadId }, id)
    assert.equal((await inventory.json()).received.length, 1)
    // A retry with identical bytes is idempotent; a corrupt chunk is refused.
    assert.equal((await post('uploads', { ...body, uploadId }, id)).status(), 200)
    assert.equal((await post('uploads', { ...body, uploadId, chunkSha256: '0'.repeat(64) }, id)).status(), 400)
   }
  }
  savedUploads.set(id, [...savedUploads.get(id) ?? [], uploadId])
  return uploadId
 }
 async function plan(input, catchup = false, id = dataset, interrupt = false) {
  const response = await post('plan', { uploadId: await upload(input, id, interrupt), ...(catchup ? { catchup: true } : {}) }, id)
  assert.equal(response.status(), 200, await response.text()); return response.json()
 }
 async function apply(preview, id = dataset) {
  let job
  for (let attempt = 0; attempt < 20; attempt++) {
   const response = await post('apply', { planId: preview.planId, reviewedFingerprint: preview.fingerprint }, id)
   assert.equal(response.status(), 200, await response.text()); job = (await response.json()).job
   if (job.state === 'completed') return job
   assert.ok(['queued','applying'].includes(job.state), JSON.stringify(job))
  }
  assert.fail('Import did not complete within its bounded calls')
 }
 async function undo(preview, id = dataset) {
  const response = await post('undo', { planId: preview.planId }, id)
  assert.equal(response.status(), 200, await response.text()); assert.equal((await response.json()).job.state, 'undone')
 }
 async function cancel(preview, id = dataset) {
  const response = await post('undo', { planId: preview.planId }, id)
  assert.equal(response.status(), 200, await response.text()); assert.equal((await response.json()).state, 'cancelled')
 }
 const anonymous = await fetch(`${origin}/api/operator/import/uploads`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Import-Dataset': dataset }, body: '{}' })
 assert.equal(anonymous.status, 401)
 assert.equal((await fetch(`${origin}/api/operator/datasets/${dataset}`)).status, 401)
 assert.equal((await post('uploads', {}, dataset, { Origin: 'https://foreign.example.test' })).status(), 401)
 assert.equal((await context.request.post(`${origin}/api/rer/import/uploads`, { data: {} })).status(), 404)
 const initial = await plan(base)
 assert.equal(initial.counts.rejected, 0)
 assert.deepEqual(initial.preview.columns.map(column => column.type), ['number','date','text','money','text'])
 assert.equal(initial.preview.rowCount, 2)
 assert.deepEqual(initial.preview.sample[0], ['1','2026-01-15','West','1234.56','First, sale'])
 assert.equal(initial.preview.sample[1][4], null)
 assert.equal((await context.request.get(`${origin}/api/operator/datasets/${dataset}`)).status(), 404, 'planning must not publish a table')
 const wrong = await post('apply', { planId: initial.planId, reviewedFingerprint: '0'.repeat(64) })
 assert.equal(wrong.status(), 403)
 assert.equal((await context.request.get(`${origin}/api/operator/datasets/${dataset}`)).status(), 404)
 await apply(initial)
 const january = await read()
 assert.deepEqual(january.table.rows, initial.preview.sample)
 assert.equal(january.table.source.sha256, digest(base.data))
 assert.equal(january.table.source.formulaTreatment, 'literal-text')
 assert.ok(!Number.isNaN(Date.parse(january.table.updatedAt)))
 await restartWorker()
 const replay = await apply(initial); assert.equal(replay.state, 'completed')
 assert.deepEqual((await read()).table.rows, january.table.rows)
 const reconciled = await post('reconcile', { planId: initial.planId })
 assert.equal(reconciled.status(), 200, await reconciled.text()); assert.equal((await reconciled.json()).ok, true)
 const original = await context.request.get(`${origin}/api/operator/import/original/${initial.planId}`, { headers: { 'X-Import-Dataset': dataset } })
 assert.equal(original.status(), 200, await original.text())
 assert.match(original.headers()['content-disposition'], /^attachment/)
 assert.equal(JSON.parse(Buffer.from((await original.json()).originals[0].original.base64, 'base64')).data, base.data)
 const february = await plan({ ...base, mode: 'append', filename: 'synthetic-bifocal-2.csv', data: 'id,date,region,amount,note\n3,02/01/2026,West,$100.00,Second month\n' }, true)
 assert.equal(february.preview.rowCount, 3)
 await apply(february)
 assert.deepEqual((await read()).table.rows[2], ['3','2026-02-01','West','100.00','Second month'])
 await undo(february)
 assert.deepEqual((await read()).table.rows, january.table.rows)
 const keyed = await plan({ ...base, mode: 'keyed-update', data: 'id,date,region,amount,note\n2,01/16/2026,East,$30.10,Corrected refund\n' }, true)
 await apply(keyed)
 assert.equal((await read()).table.rows.length, 2)
 assert.equal((await read()).table.rows[1][3], '30.10')
 const beforeRefusal = await read()
 const changedType = await plan({ ...base, mode: 'append', data: 'id,date,region,amount,note\n4,02/02/2026,West,unparseable,Type change\n' }, true)
 assert.equal(changedType.counts.rejected, 1)
 assert.match(changedType.rejected[0].reason, /TYPE_MISMATCH: row 2, column 4: expected money/)
 assert.equal(changedType.preview, null)
 assert.deepEqual(await read(), beforeRefusal)
 const refusedApply = await post('apply', { planId: changedType.planId, reviewedFingerprint: changedType.fingerprint })
 assert.equal(refusedApply.status(), 422); assert.equal((await refusedApply.json()).error, 'mapping_rejected')
 await cancel(changedType)
 // Complete error pagination remains readable after cancellation, without any
 // cell values appearing in the retained error metadata.
 const errorInventory = await plan({ ...base, mode: 'append', data: 'id,date,region,amount,note\n' + Array.from({length:150},(_,i) => `${i+20},02/02/2026,West,invalid-${i},Review\n`).join('') }, true)
 assert.equal(errorInventory.validation.errorCount,150)
 assert.equal(errorInventory.validation.errors.length,100)
 assert.equal(errorInventory.validation.nextOffset,100)
 await cancel(errorInventory)
 const errorPage = await context.request.get(`${origin}/api/operator/import/review/${errorInventory.planId}?offset=100`,{headers:{'X-Import-Dataset':dataset}})
 assert.equal(errorPage.status(),200,await errorPage.text())
 const lastErrors=await errorPage.json();assert.equal(lastErrors.errors.length,50);assert.equal(lastErrors.errors.at(-1).row,151);assert.equal(lastErrors.nextOffset,null)
 assert.ok(!JSON.stringify(lastErrors).includes('invalid-'))
 const encodedId='synthetic-bifocal-encoded',encodedText='id;name;amount\n1;Café;$1.01\n',encodedBytes=Buffer.from(encodedText,'latin1')
 const encoded=await plan({...base,datasetId:encodedId,delimiter:';',encoding:'windows-1252',data:encodedText,originalBase64:encodedBytes.toString('base64')},false,encodedId)
 assert.equal(encoded.preview.source.encoding,'windows-1252');assert.equal(encoded.preview.source.sha256,digest(encodedBytes));assert.equal(encoded.preview.sample[0][1],'Café')
 assert.ok(encoded.preview.keyCandidates.includes('id'));await apply(encoded,encodedId)
 const remapped = await plan({ ...base, columns: { id: 'number', date: 'date', region: 'text', amount: 'text', note: 'text' }, data: 'id,date,region,amount,note\n4,02/02/2026,West,Reviewed text,Explicit schema\n' }, true)
 assert.equal(remapped.counts.rejected, 0)
 await apply(remapped)
 assert.equal((await read()).table.columns[3].type, 'text')
 assert.equal((await read()).table.rows[0][3], 'Reviewed text')
 await undo(remapped)
 assert.deepEqual(await read(), beforeRefusal)
 const renamed = await plan({ ...base, data: 'id,date,region,revenue,note\n4,02/02/2026,West,$1.00,Renamed column\n' }, true)
 assert.equal(renamed.counts.rejected, 1); assert.match(renamed.rejected[0].reason, /SCHEMA_CHANGED/)
 await cancel(renamed)
 const duplicates = await plan({ ...base, mode: 'append' }, true)
 assert.equal(duplicates.counts.rejected, 1)
 assert.match(duplicates.rejected[0].reason, /DUPLICATE_KEY/)
 await cancel(duplicates)
 const macro = await plan({ ...base, filename: 'synthetic-bifocal-3.xlsm' }, true)
 assert.equal(macro.counts.rejected, 1); assert.match(macro.rejected[0].reason, /FILE_TYPE/)
 await cancel(macro)
 // Header-only input is not a claimed complete provider snapshot without
 // explicit web metadata and full-snapshot review.
 const emptyFile = await plan({ ...base, data: 'id,date,region,amount,note\n' }, true)
 assert.equal(emptyFile.counts.rejected, 1); assert.match(emptyFile.rejected[0].reason, /CSV_EMPTY/)
 assert.deepEqual(await read(), beforeRefusal); await cancel(emptyFile)
 const malformed = await plan({ ...base, data: 'id,date,region,amount,note\n5,"unclosed' }, true)
 assert.equal(malformed.counts.rejected, 1); assert.match(malformed.rejected[0].reason, /CSV_QUOTE/)
 await cancel(malformed)
 const invalidDate = await plan({ ...base, data: 'id,date,region,amount,note\n5,02/30/2026,West,$1.00,Invalid date\n' }, true)
 assert.equal(invalidDate.counts.rejected, 1); assert.match(invalidDate.rejected[0].reason, /column 2: expected date/)
 await cancel(invalidDate)
 // Resume a multi-chunk upload without changing the visible native dataset.
 const larger = { ...base, data: 'id,date,region,amount,note\n' + Array.from({ length: 700 }, (_, i) => `${i + 10},01/01/2026,West,$1.00,${'x'.repeat(100)}\n`).join('') }
 const resumed = await plan(larger, true, dataset, true)
 assert.equal(resumed.preview.rowCount, 700); assert.deepEqual(await read(), beforeRefusal)
 await apply(resumed)
 assert.equal((await read()).table.rows.length, 700)
 await undo(resumed)
 assert.deepEqual((await read()).table.rows, beforeRefusal.table.rows)
 console.log('File import: reviewed CSV versions, exact money/date/null preview, append/keyed update, Undo, validation and atomic chunk resume passed')
 // Real synthetic OOXML bytes (ECMA-376) enter the same upload/plan door.
 const xlsxId = 'synthetic-bifocal-workbook', xlsxBytes = syntheticWorkbook()
 const workbook = { ...base, datasetId: xlsxId, filename: 'synthetic-bifocal-4.xlsx', formulaTreatment: 'cached-values-preserve-formulas', sheet: 'January', data: xlsxBytes.toString('base64') }
 const januarySheet = await plan(workbook, false, xlsxId)
 assert.equal(januarySheet.counts.rejected, 0, JSON.stringify(januarySheet.rejected))
 assert.deepEqual(januarySheet.preview.columns.map(column => column.type), ['number','date','money','text'])
 assert.deepEqual(januarySheet.preview.sample, [['1','2026-01-15','1234.56','West invoice'],['2','2026-01-16','-25.50',null]])
 assert.deepEqual(januarySheet.preview.source.sheets, ['January','February'])
 assert.deepEqual(januarySheet.preview.source.formulas, [{ cell: 'C2', formula: 'SUM(1200,34.56)', cached: '$1234.56' }])
 await apply(januarySheet, xlsxId)
 assert.equal((await read(xlsxId)).table.source.sha256, digest(xlsxBytes))
 const workbookOriginal = await context.request.get(`${origin}/api/operator/import/original/${januarySheet.planId}`, { headers: { 'X-Import-Dataset': xlsxId } })
 assert.equal(workbookOriginal.status(), 200)
 const savedEnvelope = JSON.parse(Buffer.from((await workbookOriginal.json()).originals[0].original.base64, 'base64'))
 assert.equal(savedEnvelope.data, xlsxBytes.toString('base64'))
 const februarySheet = await plan({ ...workbook, sheet: 'February', mode: 'append' }, true, xlsxId)
 assert.equal(februarySheet.preview.rowCount, 3)
 await apply(februarySheet, xlsxId)
 assert.deepEqual((await read(xlsxId)).table.rows[2], ['3','2026-02-01','100.00','East invoice'])
 await undo(februarySheet, xlsxId)
 assert.equal((await read(xlsxId)).table.rows.length, 2)
 const deniedId = 'synthetic-bifocal-workbook-denied'
 const oversized = Buffer.from(xlsxBytes), central = oversized.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]))
 assert.ok(central >= 0); oversized.writeUInt32LE(0x7fffffff, central + 24)
 for (const [bytes, reason] of [
  [syntheticWorkbook({ macro: true }), /XLSX_ACTIVE_CONTENT/],
  [syntheticWorkbook({ external: true }), /XLSX_EXTERNAL_LINK/],
  [syntheticWorkbook({ dtd: true }), /XLSX_ACTIVE_XML/],
  [syntheticWorkbook({ noCache: true }), /XLSX_FORMULA_CACHE/],
  [syntheticWorkbook({ traversal: true }), /XLSX_ZIP_PATH/],
  [oversized, /XLSX_ZIP_LIMIT/],
 ]) {
  const refused = await plan({ ...workbook, datasetId: deniedId, data: bytes.toString('base64') }, false, deniedId)
  assert.equal(refused.counts.rejected, 1)
  assert.match(refused.rejected[0].reason, reason)
  assert.equal((await post('apply', { planId: refused.planId, reviewedFingerprint: refused.fingerprint }, deniedId)).status(), 422)
  assert.equal((await context.request.get(`${origin}/api/operator/datasets/${deniedId}`)).status(), 404)
  await cancel(refused, deniedId)
 }
 assert.deepEqual((await read(xlsxId)).table.rows, januarySheet.preview.sample)
 // A namespace owns retained content even when no table was ever published.
 const erase = (id, reviewedRevision) => context.request.post(`${origin}/api/operator/datasets/${id}/erase`, { headers: { Origin: origin }, data: { confirmDataset: id, reviewedRevision } })
 assert.equal((await erase(deniedId, 'stale')).status(), 409)
 const deniedErasure = await erase(deniedId, null)
 assert.equal(deniedErasure.status(), 200, await deniedErasure.text())
 const deniedReceipt = await deniedErasure.json()
 assert.equal(deniedReceipt.phase, 'complete')
 assert.ok(deniedReceipt.stores.some(store => store.store === 'ik_door_uploads' && store.rows === 6))
 for (const uploadId of savedUploads.get(deniedId)) assert.equal((await post('uploads', { uploadId }, deniedId)).status(), 404)
 const retiredUpload = await upload({ ...workbook, datasetId: deniedId }, deniedId)
 const retiredPlan = await post('plan', { uploadId: retiredUpload }, deniedId)
 assert.equal(retiredPlan.status(), 409, await retiredPlan.text())
 assert.equal((await retiredPlan.json()).error, 'source_erased')
 // Undo of a first import also leaves custody, but no published revision.
 const undoneId = 'synthetic-bifocal-undone'
 const undonePlan = await plan({ ...base, datasetId: undoneId }, false, undoneId)
 await apply(undonePlan, undoneId)
 const undoneRevision = (await read(undoneId)).revision
 assert.equal((await erase(undoneId, null)).status(), 409, 'null consent cannot erase a published table')
 await undo(undonePlan, undoneId)
 const originalFor = async (preview, id) => {
  const response = await context.request.get(`${origin}/api/operator/import/original/${preview.planId}`, { headers: { 'X-Import-Dataset': id } })
  assert.equal(response.status(), 200, await response.text())
  return (await response.json()).originals
 }
 assert.ok((await originalFor(undonePlan, undoneId)).every(item => item.original.status === 'retained'))
 assert.equal((await erase(undoneId, undoneRevision)).status(), 409, 'published-revision consent cannot erase an empty dataset')
 const undoneErasure = await erase(undoneId, null)
 assert.equal(undoneErasure.status(), 200, await undoneErasure.text())
 assert.equal((await undoneErasure.json()).phase, 'complete')
 assert.ok((await originalFor(undonePlan, undoneId)).every(item => item.original.status === 'unavailable'))
 assert.equal((await post('apply', { planId: undonePlan.planId, reviewedFingerprint: undonePlan.fingerprint }, undoneId)).status(), 410)
 // Current, superseded and undone versions share the same erasure namespace.
 const lineageId = 'synthetic-bifocal-lineage'
 const lineageBase = await plan({ ...base, datasetId: lineageId }, false, lineageId)
 await apply(lineageBase, lineageId)
 const superseding = await plan({ ...base, datasetId: lineageId, data: 'id,date,region,amount,note\n9,04/01/2026,West,$9.00,Replacement\n' }, true, lineageId)
 await apply(superseding, lineageId)
 const laterUndone = await plan({ ...base, datasetId: lineageId, mode: 'append', data: 'id,date,region,amount,note\n10,04/02/2026,East,$10.00,Undone\n' }, true, lineageId)
 await apply(laterUndone, lineageId)
 await undo(laterUndone, lineageId)
 const lineageErasure = await erase(lineageId, (await read(lineageId)).revision)
 assert.equal(lineageErasure.status(), 200, await lineageErasure.text())
 const lineageReceipt = await lineageErasure.json()
 assert.equal(lineageReceipt.phase, 'complete')
 assert.match(lineageReceipt.reason, /id is retired/)
 assert.match(lineageReceipt.reason, /fresh installation without the journal cannot detect/)
 for (const preview of [lineageBase, superseding, laterUndone]) {
  assert.ok((await originalFor(preview, lineageId)).every(item => item.original.status === 'unavailable'))
 }
 const lineageHistory = await (await postHistory(lineageId)).json()
 for (const preview of [lineageBase, superseding, laterUndone]) assert.ok(lineageHistory.history.some(entry => entry.planId === preview.planId && entry.fingerprint === preview.fingerprint && entry.owner === 'synthetic-bifocal-1@example.test'))
 assert.equal((await context.request.get(`${origin}/api/operator/datasets/${lineageId}`)).status(), 404)
 console.log('File custody: rejected-only, first-import Undo, superseded and undone originals erased; exact reviewed state, retired id and approval history passed')
 console.log('Workbook import: two-sheet XLSX values, dates/USD, formula cache/original custody, append/Undo and macro/external-link/DTD/traversal/expansion refusals passed')
 // Hostile text and formulas remain inert on the actual JSON read/download door.
 const hostileId = 'synthetic-bifocal-hostile'
 const hostile = { ...base, datasetId: hostileId, key: null, data: 'label,note\n"<script>globalThis.__bifocalInjected=1</script>","=IMPORTXML(""https://internal.example.test"") export salary"\n' }
 const hostilePlan = await plan(hostile, false, hostileId)
 assert.equal(hostilePlan.counts.rejected, 0)
 await apply(hostilePlan, hostileId)
 const nativeHostile = await read(hostileId)
 assert.match(nativeHostile.table.rows[0][0], /<script>/)
 for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: 1000 })
  const response = await page.goto(`${origin}/api/operator/datasets/${hostileId}`)
  assert.match(response.headers()['content-type'], /application\/json/)
  assert.equal(response.headers()['x-content-type-options'], 'nosniff')
  assert.match(response.headers()['content-security-policy'], /sandbox/)
  assert.equal(await page.evaluate(() => globalThis.__bifocalInjected), undefined)
 }
 assert.deepEqual((await (await context.request.get(`${origin}/auth/session`)).json()).operator.role, 'owner')
 const history = await context.request.get(`${origin}/api/operator/import/history`, { headers: { 'X-Import-Dataset': dataset } })
 assert.equal(history.status(), 200)
 assert.ok((await history.json()).history.some(entry => entry.planId === initial.planId && entry.reviewer === 'operator' && entry.owner === 'synthetic-bifocal-1@example.test'))
 // Explicit current-revision consent withdraws originals, staged uploads and
 // plans. It must leave an unrelated native dataset intact and fence replay.
 await proveRetentionHold(origin,context,hostileId,nativeHostile.revision,page)
 const erasureUrl = `${origin}/api/operator/datasets/${hostileId}/erase`
 assert.equal((await context.request.post(erasureUrl, { headers: { Origin: origin }, data: { confirmDataset: hostileId, reviewedRevision: 'stale' } })).status(), 409)
 const erased = await context.request.post(erasureUrl, { headers: { Origin: origin }, data: { confirmDataset: hostileId, reviewedRevision: nativeHostile.revision } })
 assert.equal(erased.status(), 200, await erased.text())
 const receipt = await erased.json(); assert.equal(receipt.phase, 'complete'); assert.ok(receipt.stores.length)
 await proveErasureReceipt(origin,context,receipt.auditId,hostileId,nativeHostile.revision)
 assert.equal((await context.request.get(`${origin}/api/operator/datasets/${hostileId}`)).status(), 404)
 assert.deepEqual((await read()).table.rows, beforeRefusal.table.rows)
 const unrelatedOriginal = await context.request.get(`${origin}/api/operator/import/original/${initial.planId}`, { headers: { 'X-Import-Dataset': dataset } })
 assert.equal(unrelatedOriginal.status(), 200)
 assert.equal((await unrelatedOriginal.json()).originals[0].original.status, 'retained')
 const oldOriginal = await context.request.get(`${origin}/api/operator/import/original/${hostilePlan.planId}`, { headers: { 'X-Import-Dataset': hostileId } })
 assert.equal(oldOriginal.status(), 200, await oldOriginal.text())
 assert.ok((await oldOriginal.json()).originals.every(item => item.original.status === 'unavailable'))
 const resurrect = await post('apply', { planId: hostilePlan.planId, reviewedFingerprint: hostilePlan.fingerprint }, hostileId)
 assert.equal(resurrect.status(), 410)
 assert.equal((await context.request.get(`${origin}/api/operator/datasets/${hostileId}`)).status(), 404)
 console.log('File safety: anonymous/origin/fingerprint denial, inert hostile text and formulas at 1440/390, protected originals, consented erasure and replay fence passed')
 // A stale signed-out session cannot finish work planned while it was active.
 await proveFileBrowser(origin, context, page, syntheticWorkbook())
 await proveExactQueries(origin, context, { plan, apply, read, undo }, page)
 const pending = await plan({ ...base, mode: 'replace', data: 'id,date,region,amount,note\n8,03/01/2026,West,$8.00,Pending\n' }, true)
 // Leave the pending plan id for the outer native-signout assertion below.
 context.fileImportPending = { dataset, planId: pending.planId, fingerprint: pending.fingerprint }
 await page.goto(`${origin}/app`)
 function postHistory(id) { return context.request.get(`${origin}/api/operator/import/history`, { headers: { 'X-Import-Dataset': id } }) }
}


/** Minimal standards-shaped two-sheet workbook, never an application/provider
 * substitute. Expected source values are asserted independently in the journey. */
function syntheticWorkbook({ macro = false, external = false, dtd = false, noCache = false, traversal = false } = {}) {
 const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
 const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
 const inline = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`
 const header = `<row r="1">${['id','date','amount','note'].map((name, i) => inline(`${'ABCD'[i]}1`, name)).join('')}</row>`
 const files = {
  '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  'xl/workbook.xml': `${dtd ? '<!DOCTYPE workbook [<!ENTITY synthetic SYSTEM "http://internal.example.test/">]>' : ''}<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="January" sheetId="1" r:id="rId1"/><sheet name="February" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${rel}/styles" Target="styles.xml"/>${external ? `<Relationship Id="rId4" Type="${rel}/externalLink" TargetMode="External" Target="http://internal.example.test/"/>` : ''}</Relationships>`,
  'xl/styles.xml': `<styleSheet xmlns="${ns}"><fonts count="1"><font/></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="7" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  'xl/worksheets/sheet1.xml': `<worksheet xmlns="${ns}"><sheetData>${header}<row r="2"><c r="A2"><v>1</v></c><c r="B2" s="1"><v>46037</v></c><c r="C2" s="2"><f>SUM(1200,34.56)</f>${noCache ? '' : '<v>1234.56</v>'}</c>${inline('D2','West invoice')}</row><row r="3"><c r="A3"><v>2</v></c><c r="B3" s="1"><v>46038</v></c><c r="C3" s="2"><v>-25.5</v></c></row></sheetData></worksheet>`,
  'xl/worksheets/sheet2.xml': `<worksheet xmlns="${ns}"><sheetData>${header}<row r="2"><c r="A2"><v>3</v></c><c r="B2" s="1"><v>46054</v></c><c r="C2" s="2"><v>100</v></c>${inline('D2','East invoice')}</row></sheetData></worksheet>`,
 }
 if (macro) files['xl/vbaProject.bin'] = 'synthetic-bifocal-5'
 if (traversal) files['../synthetic-bifocal-6.xml'] = '<refused/>'
 return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)]))))
}
