import {queuedEntrypoint} from '@runeditrun/rer/queued-entry';
const queued=await queuedEntrypoint(import.meta.url,'verify:runtime');if(queued!==null)process.exit(queued);
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const socket = createServer()
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
// The installed homepage reads the claim state from D1: run the emitted Worker
// on its own migrated store, never the checkout's local data.
const persist = await mkdtemp(join(tmpdir(), 'foundation-runtime-'))
execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'foundation', '--local', '--persist-to', persist, '--config', 'dist/server/wrangler.json'], { stdio: 'pipe', env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } })
const origin = `http://127.0.0.1:${port}`
const syntheticSetup = 'synthetic-bifocal-1'.repeat(3)
const worker = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--inspector-port', '0', '--local', '--persist-to', persist, '--ip', '127.0.0.1', '--config', 'dist/server/wrangler.json', '--port', String(port), '--var', `AUTH_ORIGIN:${origin}`, '--var', 'AUTH_LOCAL:true', '--var', 'OWNER_EMAIL:synthetic-bifocal-1@example.test', '--var', 'MAIL_FROM:synthetic-bifocal-2@example.test', '--var', `SESSION_SECRET:${'synthetic-bifocal-2'.repeat(3)}`, '--var', `SETUP_TOKEN:${syntheticSetup}`], { stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
worker.stdout.on('data', chunk => { output += chunk })
worker.stderr.on('data', chunk => { output += chunk })
try {
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    if (worker.exitCode !== null) throw new Error(output)
    try { ready = (await fetch(`${origin}/health`)).ok } catch {}
    if (ready) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(ready, output)
  const health = await (await fetch(`${origin}/health`)).json()
  assert.equal(health.status, 'ok')
  assert.equal(health.ok, true)
  assert.deepEqual(Object.keys(health.deployment ?? {}).sort(), ['fingerprint', 'sourceSha', 'versionId'])
  const document = await fetch(origin)
  assert.equal(document.status, 200)
  const branding = JSON.parse(await readFile(new URL('../src/branding.json', import.meta.url)))
  assert.ok((await document.text()).includes(branding.name))
  for (const path of ['/missing', '/health/extra', '/api', '/api/missing']) {
    assert.equal((await fetch(`${origin}${path}`)).status, 404, path)
  }
  // Foundation home: actual bootstrap, setup, private entry and native sign-out.
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    async function proveNotFound(signedIn) {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        const missing = await page.goto(`${origin}/app/import`)
        assert.equal(missing.status(), 404)
        await page.getByRole('heading', { name: 'Page not found', exact: true }).waitFor()
        assert.equal(await page.title(), 'Page not found · Bifocal')
        assert.match(await missing.text(), /<title>Page not found · Bifocal<\/title>/)
        assert.match(await page.locator('main').innerText(), /not built yet/)
        assert.equal(await page.getByRole('link', { name: 'Go to Lobby', exact: true }).getAttribute('href'), '/')
        assert.equal(await page.locator('a[href="/app/import"]').count(), 0)
        await page.keyboard.press('Tab')
        assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Open app home')
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `404 overflow at ${width}`)
        if (process.env.BIFOCAL_PROOF_DIR) await page.screenshot({ path: `${process.env.BIFOCAL_PROOF_DIR}/not-found-${signedIn ? 'signed-in' : 'signed-out'}-${width}.png`, fullPage: true })
        await page.getByRole('link', { name: 'Open app home', exact: true }).click()
        await page.waitForURL(`${origin}${signedIn ? '/app' : '/signin'}`)
        await page.goto(`${origin}/missing`)
        await page.getByRole('link', { name: 'Go to Lobby', exact: true }).click()
        await page.waitForURL(`${origin}/`)
      }
    }
    await proveNotFound(false)
    const refused = await context.request.get(`${origin}/app`, { maxRedirects: 0 })
    assert.equal(refused.status(), 303)
    assert.equal(refused.headers().location, '/signin')
    const bootstrap = await context.request.post(`${origin}/auth/bootstrap`, {
      headers: { Origin: origin }, data: { token: syntheticSetup, displayName: 'Synthetic owner', returnTo: '/app' }, maxRedirects: 0,
    })
    assert.equal(bootstrap.status(), 303)
    await page.goto(`${origin}/setup`)
    await page.getByRole('checkbox').check()
    await Promise.all([page.waitForURL(`${origin}/app`), page.getByRole('button', { name: 'Finish setup' }).click()])
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(`${origin}/app`)
      await page.getByRole('heading', { name: 'Analytics is not built yet' }).waitFor()
      assert.match(await page.locator('main').innerText(), /Signed in as Synthetic owner/)
      assert.equal(await page.getByRole('link', { name: 'Lobby', exact: true }).getAttribute('href'), '/')
      assert.equal(await page.getByRole('link', { name: 'Identity settings', exact: true }).getAttribute('href'), '/auth/settings/identity')
      assert.equal(await page.getByRole('link', { name: 'Run and installation guide' }).getAttribute('href'), 'https://run-bifocal.com/run')
      assert.equal(await page.getByRole('link', { name: 'Product contract' }).getAttribute('href'), 'https://run-bifocal.com/contract')
      assert.equal(await page.locator('a[href="/app/import"]').count(), 0)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `home overflow at ${width}`)
      if (process.env.BIFOCAL_PROOF_DIR) await page.screenshot({ path: `${process.env.BIFOCAL_PROOF_DIR}/home-${width}.png`, fullPage: true })
    }
    await proveNotFound(true)
    console.log('Unknown routes: framed 404, SSR title, keyboard recovery and honest scope signed in/out at 1440/390 passed')
    // People/Invite: a person-facing form delegates to the native invitation door.
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(`${origin}/app`)
      await page.getByRole('link', { name: 'People', exact: true }).click()
      await page.getByRole('heading', { name: 'Invite a person', exact: true }).waitFor()
      assert.equal(await page.getByRole('link', { name: /^Sign in as/ }).count(), 0, 'ordinary Worker must not offer local one-click entry')
      await page.getByLabel('Name', { exact: true }).fill(`Synthetic person ${width}`)
      await page.getByLabel('Email', { exact: true }).fill(`synthetic-bifocal-${width}@example.test`)
      const [invited] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/auth/invite') && response.request().method() === 'POST'), page.getByRole('button', { name: 'Send invitation' }).click()])
      assert.equal(invited.status(), 303)
      await page.waitForURL(/invited=1/)
      await page.getByRole('status').waitFor()
      const people = page.getByRole('list', { name: 'People', exact: true })
      assert.match(await people.innerText(), new RegExp(`synthetic-bifocal-${width}@example.test`))
      assert.match(await people.innerText(), /invited/)
      assert.doesNotMatch(await people.innerText(), /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}/i)
      const native = await (await context.request.get(`${origin}/auth/operators`)).json()
      assert.ok(native.some(person => person.email === `synthetic-bifocal-${width}@example.test` && person.role === 'member' && person.status === 'invited'))
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `people overflow at ${width}`)
      if (process.env.BIFOCAL_PROOF_DIR) await page.screenshot({ path: `${process.env.BIFOCAL_PROOF_DIR}/people-${width}.png`, fullPage: true })
    }
    const invalidInvite = await context.request.post(`${origin}/auth/invite`, { headers: { Origin: origin }, form: { email: 'invalid', displayName: 'Synthetic person', role: 'member' } })
    assert.equal(invalidInvite.status(), 400)
    assert.match(await invalidInvite.text(), /Enter a valid email address/)
    const forgedInvite = await context.request.post(`${origin}/auth/invite`, { headers: { Origin: 'https://foreign.example.test' }, form: { email: 'synthetic-bifocal-3@example.test', displayName: 'Synthetic person', role: 'member' } })
    assert.equal(forgedInvite.status(), 403)
    const afterRefusal = await (await context.request.get(`${origin}/auth/operators`)).json()
    assert.ok(!afterRefusal.some(person => person.email === 'synthetic-bifocal-3@example.test'))
    console.log('People/Invite: native persistence, form errors, CSRF refusal and human HTML at 1440/390 passed')
    // Display-name settings: follow the link, save through the native form,
    // and read the durable value back through the session, settings and home.
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(`${origin}/app`)
      await page.getByRole('link', { name: 'Your settings', exact: true }).click()
      await page.getByLabel('Your name', { exact: true }).fill(`Synthetic owner ${width}`)
      await Promise.all([page.waitForURL(/saved=1/), page.getByRole('button', { name: 'Save name', exact: true }).click()])
      await page.getByRole('status').waitFor()
      await page.reload()
      assert.equal(await page.getByLabel('Your name', { exact: true }).inputValue(), `Synthetic owner ${width}`)
      const current = await (await context.request.get(`${origin}/auth/session`)).json()
      assert.equal(current.operator.displayName, `Synthetic owner ${width}`)
      assert.equal(current.operator.email, 'synthetic-bifocal-1@example.test')
      assert.equal(current.operator.role, 'owner')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `settings overflow at ${width}`)
      if (process.env.BIFOCAL_PROOF_DIR) await page.screenshot({ path: `${process.env.BIFOCAL_PROOF_DIR}/settings-${width}.png`, fullPage: true })
      await page.getByRole('link', { name: 'App home', exact: true }).click()
      assert.match(await page.locator('main').innerText(), new RegExp(`Signed in as Synthetic owner ${width}`))
    }
    const invalidName = await context.request.post(`${origin}/auth/display-name`, { headers: { Origin: origin }, form: { displayName: '   ' } })
    assert.equal(invalidName.status(), 400)
    assert.match(await invalidName.text(), /Enter a name of 1 to 120 characters/)
    const forgedName = await context.request.post(`${origin}/auth/display-name`, { headers: { Origin: 'https://foreign.example.test' }, data: { displayName: 'Synthetic refused' } })
    assert.equal(forgedName.status(), 403)
    assert.equal((await (await context.request.get(`${origin}/auth/session`)).json()).operator.displayName, 'Synthetic owner 390')
    const escapedName = '<synthetic-bifocal-5> & "Owner"'
    assert.equal((await context.request.post(`${origin}/auth/display-name`, { headers: { Origin: origin }, data: { displayName: escapedName } })).status(), 200)
    await page.goto(`${origin}/app/settings`)
    assert.equal(await page.getByLabel('Your name', { exact: true }).inputValue(), escapedName)
    assert.equal(await page.locator('synthetic-bifocal-5').count(), 0)
    await page.goto(`${origin}/app`)
    console.log('Display-name settings: native save, durable readback, escaping and mutation refusals at 1440/390 passed')
    await proveFileImports(origin, context, page)
    // A forged cross-origin form cannot revoke the still-valid session.
    const forged = await context.request.post(`${origin}/auth/signout`, { headers: { Origin: 'https://foreign.example.test' }, form: {}, maxRedirects: 0 })
    assert.equal(forged.status(), 403)
    assert.equal((await context.request.get(`${origin}/auth/session`)).status(), 200)
    // Keep a stale cookie to prove server revocation independently of deletion.
    const staleCookie = (await context.cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
    await Promise.all([page.waitForURL(/\/signin/), page.getByRole('button', { name: 'Sign out', exact: true }).click()])
    assert.equal((await context.request.get(`${origin}/auth/session`)).status(), 401)
    assert.equal((await fetch(`${origin}/auth/session`, { headers: { cookie: staleCookie } })).status, 401)
    assert.equal((await context.request.get(`${origin}/app`, { maxRedirects: 0 })).status(), 303)
    assert.equal((await context.request.get(`${origin}/app/people`, { maxRedirects: 0 })).status(), 303)
    assert.equal((await context.request.get(`${origin}/app/settings`, { maxRedirects: 0 })).status(), 303)
    assert.equal((await context.request.post(`${origin}/auth/display-name`, { headers: { Origin: origin }, data: { displayName: 'Synthetic refused' } })).status(), 401)
    const pendingFile = context.fileImportPending
    assert.equal((await context.request.post(`${origin}/api/operator/import/apply`, { headers: { Origin: origin, 'X-Import-Dataset': pendingFile.dataset }, data: { planId: pendingFile.planId, reviewedFingerprint: pendingFile.fingerprint } })).status(), 401)
    assert.equal((await context.request.get(`${origin}/api/operator/datasets/${pendingFile.dataset}`)).status(), 401)
    console.log('Foundation home: honest capability state, working links and revoked sign-out at 1440/390 passed')
    await context.close()
  } finally { await browser.close() }
  console.log('HTTP-001 passed against emitted local Worker: health, the installed homepage, HTTP and document 404s')
} finally {
  worker.kill('SIGTERM')
  await new Promise(resolve => worker.exitCode !== null ? resolve() : worker.once('exit', resolve))
  await rm(persist, { recursive: true, force: true })
}

// Optional local-only proof against this checkout's actual Vite dev entry.
// The harness starts it with this synthetic gate, never a real browser session.
if (process.env.BIFOCAL_DEV_ORIGIN) {
  const devOrigin = process.env.BIFOCAL_DEV_ORIGIN
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      const exchange = await context.request.post(`${devOrigin}/__dev/key`, { headers: { Origin: devOrigin }, data: { key: 'synthetic-bifocal-4'.repeat(3) } })
      assert.equal(exchange.status(), 204)
      const page = await context.newPage()
      await page.goto(`${devOrigin}/auth/dev/enter?as=owner`)
      if (new URL(page.url()).pathname === '/setup') {
        await page.getByRole('checkbox').check()
        await Promise.all([page.waitForURL(`${devOrigin}/app`), page.getByRole('button', { name: 'Finish setup' }).click()])
      }
      await page.goto(`${devOrigin}/app/people`)
      await page.getByLabel('Name', { exact: true }).fill(`Synthetic local ${width}`)
      await page.getByLabel('Email', { exact: true }).fill(`synthetic-bifocal-local-${width}@example.test`)
      const [invited] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/auth/invite') && response.request().method() === 'POST'), page.getByRole('button', { name: 'Send invitation' }).click()])
      assert.equal(invited.status(), 303)
      await page.waitForURL(/invited=1/)
      const enter = page.getByRole('link', { name: `Sign in as Synthetic local ${width}`, exact: true })
      await enter.waitFor()
      if (process.env.BIFOCAL_PROOF_DIR) await page.screenshot({ path: `${process.env.BIFOCAL_PROOF_DIR}/people-dev-${width}.png`, fullPage: true })
      await enter.click()
      await page.waitForURL(`${devOrigin}/app`)
      assert.match(await page.locator('main').innerText(), new RegExp(`Synthetic local ${width}`))
      assert.equal(await page.getByRole('link', { name: 'People', exact: true }).count(), 0)
      const denied = await page.goto(`${devOrigin}/app/people`)
      assert.equal(denied.status(), 403)
      await page.getByRole('heading', { name: 'People unavailable' }).waitFor()
      assert.equal(await page.getByRole('list', { name: 'People', exact: true }).count(), 0)
      const mutation = await context.request.post(`${devOrigin}/auth/invite`, { headers: { Origin: devOrigin }, form: { email: `synthetic-bifocal-refused-${width}@example.test`, displayName: 'Synthetic refused', role: 'member' } })
      assert.equal(mutation.status(), 403)
      if (process.env.BIFOCAL_PROOF_DIR) await page.screenshot({ path: `${process.env.BIFOCAL_PROOF_DIR}/people-denied-${width}.png`, fullPage: true })
      await context.close()
    }
    console.log('Local People/Invite: native one-click invitation acceptance and member refusal at 1440/390 passed')
  } finally { await browser.close() }
}


// Named public-door journeys on the actual migrated Worker. No SQL fixtures or
// application substitutes: all data, plans and readback use authenticated HTTP.
async function proveFileImports(origin, context, page) {
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
 async function cancel(preview) {
  const response = await post('undo', { planId: preview.planId })
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
 const duplicates = await plan({ ...base, mode: 'append' }, true)
 assert.equal(duplicates.counts.rejected, 1)
 assert.match(duplicates.rejected[0].reason, /DUPLICATE_KEY/)
 await cancel(duplicates)
 const macro = await plan({ ...base, filename: 'synthetic-bifocal-3.xlsm' }, true)
 assert.equal(macro.counts.rejected, 1); assert.match(macro.rejected[0].reason, /FILE_TYPE/)
 await cancel(macro)
 const malformed = await plan({ ...base, data: 'id,date,region,amount,note\n5,"unclosed' }, true)
 assert.equal(malformed.counts.rejected, 1); assert.match(malformed.rejected[0].reason, /CSV_QUOTE/)
 await cancel(malformed)
 const invalidDate = await plan({ ...base, data: 'id,date,region,amount,note\n5,02/30/2026,West,$1.00,Invalid date\n' }, true)
 assert.equal(invalidDate.counts.rejected, 1); assert.match(invalidDate.rejected[0].reason, /column 2: expected date/)
 await cancel(invalidDate)
 const bounds = await plan({ ...base, data: 'id,date,region,amount,note\n' + Array.from({ length: 2001 }, (_, i) => `${i + 10},01/01/2026,West,$1.00,Row\n`).join('') }, true)
 assert.equal(bounds.counts.rejected, 1); assert.match(bounds.rejected[0].reason, /ROW_LIMIT/)
 await cancel(bounds)
 // Resume a multi-chunk upload without changing the visible native dataset.
 const larger = { ...base, data: 'id,date,region,amount,note\n' + Array.from({ length: 700 }, (_, i) => `${i + 10},01/01/2026,West,$1.00,${'x'.repeat(100)}\n`).join('') }
 const resumed = await plan(larger, true, dataset, true)
 assert.equal(resumed.preview.rowCount, 700); assert.deepEqual(await read(), beforeRefusal)
 await apply(resumed)
 assert.equal((await read()).table.rows.length, 700)
 await undo(resumed)
 assert.deepEqual((await read()).table.rows, beforeRefusal.table.rows)
 console.log('File import: reviewed CSV versions, exact money/date/null preview, append/keyed update, Undo, validation and atomic chunk resume passed')
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
 assert.ok((await history.json()).history.some(entry => entry.planId === initial.planId && entry.reviewer === 'operator'))
 // Explicit current-revision consent withdraws originals, staged uploads and
 // plans. It must leave an unrelated native dataset intact and fence replay.
 const erasureUrl = `${origin}/api/operator/datasets/${hostileId}/erase`
 assert.equal((await context.request.post(erasureUrl, { headers: { Origin: origin }, data: { confirmDataset: hostileId, reviewedRevision: 'stale' } })).status(), 409)
 const erased = await context.request.post(erasureUrl, { headers: { Origin: origin }, data: { confirmDataset: hostileId, reviewedRevision: nativeHostile.revision } })
 assert.equal(erased.status(), 200, await erased.text())
 const receipt = await erased.json(); assert.equal(receipt.phase, 'complete'); assert.ok(receipt.stores.length)
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
 const pending = await plan({ ...base, mode: 'replace', data: 'id,date,region,amount,note\n8,03/01/2026,West,$8.00,Pending\n' }, true)
 // Leave the pending plan id for the outer native-signout assertion below.
 context.fileImportPending = { dataset, planId: pending.planId, fingerprint: pending.fingerprint }
 await page.goto(`${origin}/app`)
}
