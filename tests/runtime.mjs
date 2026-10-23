import {queuedEntrypoint} from '@runeditrun/rer/queued-entry';
const queued=await queuedEntrypoint(import.meta.url,'verify:runtime');if(queued!==null)process.exit(queued);
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { proveContentGovernance } from './journeys/content-governance.mjs'
import { proveAnalyticsBoundaries } from './journeys/analytics-boundaries.mjs'
import { proveFileImports } from './journeys/file-import.mjs'
import { proveSpreadsheetEdges } from './journeys/spreadsheet-edge.mjs'
import { proveConventions } from './journeys/conventions.mjs'
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
const syntheticInstallationKey = createHash('sha256').update('synthetic-bifocal-6').digest('hex')
function startWorker() {
 const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--inspector-port', '0', '--local', '--persist-to', persist, '--ip', '127.0.0.1', '--config', 'dist/server/wrangler.json', '--port', String(port), '--var', `AUTH_ORIGIN:${origin}`, '--var', 'AUTH_LOCAL:true', '--var', 'OWNER_EMAIL:synthetic-bifocal-1@example.test', '--var', 'MAIL_FROM:synthetic-bifocal-2@example.test', '--var', `SESSION_SECRET:${'synthetic-bifocal-2'.repeat(3)}`, '--var', `SETUP_TOKEN:${syntheticSetup}`, '--var', `INSTALLATION_KEY:${syntheticInstallationKey}`], { stdio: ['ignore', 'pipe', 'pipe'] })
 child.stdout.on('data', chunk => { output += chunk })
 child.stderr.on('data', chunk => { output += chunk })
 return child
}
let output = '', worker = startWorker()
async function restartWorker() {
 worker.kill('SIGTERM')
 await new Promise(resolve => worker.exitCode !== null ? resolve() : worker.once('exit', resolve))
 worker = startWorker()
 for (let attempt = 0; attempt < 120; attempt++) {
  if (worker.exitCode !== null) throw new Error(output)
  try { if ((await fetch(`${origin}/health`)).ok) return } catch {}
  await new Promise(resolve => setTimeout(resolve, 250))
 }
 throw new Error('Restart did not become ready')
}
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
  // Adopted dependency custody: discover through the public link door, then
  // inspect the real persisted row. Public JWKS and sector survive a restart;
  // the private signing material is stored only in an authenticated envelope.
  const discovery = await fetch(`${origin}/.well-known/rer-dependencies`)
  assert.equal(discovery.status, 200)
  const dependency = await discovery.json()
  const jwks = await (await fetch(dependency.jwks_uri)).json()
  assert.equal(jwks.keys.length, 1)
  assert.equal(jwks.keys[0].kty, 'EC')
  assert.equal(jwks.keys[0].d, undefined)
  const stored = JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'foundation', '--local', '--persist-to', persist, '--config', 'dist/server/wrangler.json', '--command', 'SELECT k.private_key, i.keys_sealed FROM rer_dependency_keys k CROSS JOIN rer_dependency_installation i', '--json'], { encoding: 'utf8', env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] }))[0].results
  assert.equal(stored.length, 1)
  assert.equal(stored[0].keys_sealed, 1)
  const envelope = JSON.parse(stored[0].private_key)
  assert.deepEqual(Object.keys(envelope).sort(), ['ciphertext', 'iv', 'kid', 'version'])
  assert.equal(envelope.version, 1)
  assert.ok(envelope.ciphertext.length > 40)
  assert.ok(!stored[0].private_key.includes(syntheticInstallationKey))
  await restartWorker()
  assert.equal((await (await fetch(`${origin}/.well-known/rer-dependencies`)).json()).sector_id, dependency.sector_id)
  assert.deepEqual(await (await fetch(dependency.jwks_uri)).json(), jwks)
  console.log('Dependency custody: public discovery/JWKS, sealed persisted key and stable restart passed')
  // Foundation home: actual bootstrap, setup, private entry and native sign-out.
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    async function proveNotFound(signedIn) {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        const missing = await page.goto(`${origin}/app/not-built`)
        assert.equal(missing.status(), 404)
        await page.getByRole('heading', { name: 'Page not found', exact: true }).waitFor()
        assert.equal(await page.title(), 'Page not found · Bifocal')
        assert.match(await missing.text(), /<title>Page not found · Bifocal<\/title>/)
        assert.match(await page.locator('main').innerText(), /bounded file import, exact-answer and account tools/)
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
    // Installed docs: public, same-origin and static before any owner sign-in.
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      const requested = []
      const collect = request => requested.push(request.url())
      page.on('request', collect)
      const docs = await page.goto(`${origin}/docs`)
      assert.equal(docs.status(), 200)
      await page.getByRole('heading', { name: 'Installation guide', exact: true }).waitFor()
      assert.equal(await page.title(), 'Installation guide · Bifocal')
      const guide = await page.locator('main').innerText()
      assert.match(guide, /Restore is not an ownership-transfer path/)
      assert.match(guide, /original owner, operator and membership definitions/)
      assert.match(guide, /Ordinary memberships and import grants are not automatically inactive/)
      assert.match(guide, /Native sessions, provider session.link credentials, private settings and platform bookkeeping are excluded/)
      assert.match(guide, /Both CLI setup and the supported browser installer check the retained owner and refuse a different email/)
      assert.match(guide, /browser installer uses the same CLI setup command/)
      assert.match(guide, /Use the archived owner’s email after restore/)
      assert.match(guide, /MAIL_FROM: auth@example.invalid/)
      assert.match(guide, /placeholder that shared setup.deploy syntax validation currently accepts/)
      assert.match(guide, /Passing validation does not verify sender ownership or mail delivery/)
      assert.match(guide, /reads target secret-binding names.*CLOUDFLARE_ACCOUNT_ID.*CLOUDFLARE_API_TOKEN/)
      assert.match(guide, /Missing credentials or a refused target read fail the dry run/)
      assert.match(guide, /no provider writes, uploads, secret changes or resource creation/)
      assert.match(guide, /default environment is production/)
      assert.match(guide, /successful dry run does not prove hosted health or mail delivery/)
      assert.equal(await page.locator('form').count(), 0)
      assert.ok(requested.every(url => new URL(url).origin === origin), 'installed docs must not load an external site')
      page.off('request', collect)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `docs overflow at ${width}`)
      if (process.env.BIFOCAL_PROOF_DIR) await page.screenshot({ path: `${process.env.BIFOCAL_PROOF_DIR}/docs-${width}.png`, fullPage: true })
      await page.getByRole('link', { name: 'Sign in', exact: true }).click()
      await page.waitForURL(`${origin}/signin`)
    }
    const docsHead = await context.request.head(`${origin}/docs`)
    assert.equal(docsHead.status(), 200)
    assert.equal((await docsHead.body()).length, 0)
    assert.equal((await context.request.post(`${origin}/docs`, { data: {} })).status(), 405)
    console.log('Installed docs: signed-out static guide, same-origin assets, useful sign-in and nonoverflowing 1440/390 layouts passed')
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
      await page.getByRole('link', { name: 'Files', exact: true }).waitFor()
      assert.match(await page.locator('main').innerText(), /Signed in as Synthetic owner/)
      assert.equal(await page.getByRole('link', { name: 'Lobby', exact: true }).getAttribute('href'), '/')
      assert.equal(await page.getByRole('link', { name: 'Identity settings', exact: true }).getAttribute('href'), '/auth/settings/identity')
      assert.equal(await page.getByRole('link', { name: 'Run and installation guide' }).getAttribute('href'), 'https://run-bifocal.com/run')
      assert.equal(await page.getByRole('link', { name: 'Product contract' }).getAttribute('href'), 'https://run-bifocal.com/contract')
      assert.equal(await page.locator('a[href="/app/import"]').count(), 1)
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
    // Cancellation cannot be bypassed by an ordinary reactivation request.
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(`${origin}/app/people`)
      const target = (await (await context.request.get(`${origin}/auth/operators`)).json()).find(person => person.email === `synthetic-bifocal-${width}@example.test`)
      const forgedCancel = await context.request.post(`${origin}/auth/invite/cancel`, { headers: { Origin: 'https://foreign.example.test' }, form: { operatorId: target.id } })
      assert.equal(forgedCancel.status(), 403)
      assert.equal((await (await context.request.get(`${origin}/auth/operators`)).json()).find(person => person.id === target.id).status, 'invited')
      await Promise.all([page.waitForURL(/updated=1/), page.getByRole('button', { name: `Cancel invitation for Synthetic person ${width}`, exact: true }).click()])
      const cancelled = (await (await context.request.get(`${origin}/auth/operators`)).json()).find(person => person.id === target.id)
      assert.equal(cancelled.status, 'inactive')
      assert.ok(cancelled.version > target.version)
      const [reactivated] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/auth/operator/status')), page.getByRole('button', { name: `Reactivate Synthetic person ${width}`, exact: true }).click()])
      assert.equal(reactivated.status(), 409)
      assert.match(await page.getByRole('alert').innerText(), /Send a new invitation/)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      if (process.env.BIFOCAL_PROOF_DIR) await page.screenshot({ path: `${process.env.BIFOCAL_PROOF_DIR}/people-cancelled-${width}.png`, fullPage: true })
      await page.getByLabel('Name', { exact: true }).fill(`Synthetic person ${width}`)
      await page.getByLabel('Email', { exact: true }).fill(target.email)
      await Promise.all([page.waitForURL(/invited=1/), page.getByRole('button', { name: 'Send invitation', exact: true }).click()])
      const reinvited = (await (await context.request.get(`${origin}/auth/operators`)).json()).find(person => person.id === target.id)
      assert.equal(reinvited.status, 'invited')
      assert.ok(reinvited.version > cancelled.version)
    }
    console.log('People cancellation: native form/version fence, CSRF refusal, cancelled reactivation refusal and same-account reinvitation at 1440/390 passed')
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
      await page.getByRole('heading', { name: 'This session', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'End this session', exact: true }).count(), 1)
      const forgedRevoke = await context.request.post(`${origin}/auth/session/revoke`, { headers: { Origin: 'https://foreign.example.test' }, form: { sessionId: current.id } })
      assert.equal(forgedRevoke.status(), 403)
      assert.equal((await context.request.get(`${origin}/auth/session`)).status(), 200)
      await page.reload()
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
    const journeyErrors = []
    for (const [name, run] of [
      ['conventions', () => proveConventions(origin, context, page)],
      ['analytics boundaries', () => proveAnalyticsBoundaries(origin, context, page, persist)],
      ['spreadsheet edges', () => proveSpreadsheetEdges(origin, context, persist)],
      ['file and exact-answer journeys', () => proveFileImports(origin, context, page, restartWorker)],
    ]) {
      try { await run() } catch (error) { journeyErrors.push(error); console.error(`Failed ${name}:`, error.message) }
    }
    if (journeyErrors.length) throw new AggregateError(journeyErrors, 'Public-door journey failures')

    // A forged cross-origin form cannot revoke the still-valid session.
    const forged = await context.request.post(`${origin}/auth/signout`, { headers: { Origin: 'https://foreign.example.test' }, form: {}, maxRedirects: 0 })
    assert.equal(forged.status(), 403)
    assert.equal((await context.request.get(`${origin}/auth/session`)).status(), 200)
    // Keep a stale cookie to prove server revocation independently of deletion.
    const staleCookie = (await context.cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
    await Promise.all([page.waitForURL(/\/signin/), page.getByRole('button', { name: 'Sign out', exact: true }).click()])
    assert.equal((await context.request.get(`${origin}/auth/session`)).status(), 401)
    assert.equal((await fetch(`${origin}/auth/session`, { headers: { cookie: staleCookie } })).status, 401)
    for(const path of [`/api/operator/queries/${context.exactAnswerAuth.query}`,`/api/operator/reports/${context.exactAnswerAuth.report}`])assert.equal((await fetch(origin+path,{headers:{cookie:staleCookie}})).status,401)
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
} catch(error) {
  console.error(output.split('\n').filter(line=>/error|exception|body|promise|reset/i.test(line)).join('\n'))
  throw error
} finally {
  worker.kill('SIGTERM')
  await new Promise(resolve => worker.exitCode !== null ? resolve() : worker.once('exit', resolve))
  await rm(persist, { recursive: true, force: true })
}

await proveContentGovernance()

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
    // Real native memberships and separate browser sessions, never SQL fixtures.
    for (const width of [1440, 390]) {
      const owner = await browser.newContext({ viewport: { width, height: 1000 } })
      const member = await browser.newContext({ viewport: { width, height: 1000 } })
      try {
        for (const context of [owner, member]) {
          assert.equal((await context.request.post(`${devOrigin}/__dev/key`, { headers: { Origin: devOrigin }, data: { key: 'synthetic-bifocal-4'.repeat(3) } })).status(), 204)
        }
        const page = await owner.newPage()
        await page.goto(`${devOrigin}/auth/dev/enter?as=owner`)
        await page.goto(`${devOrigin}/app/people`)
        const people = await (await owner.request.get(`${devOrigin}/auth/operators`)).json()
        const target = people.find(person => person.email === `synthetic-bifocal-local-${width}@example.test`)
        assert.ok(target?.signInUrl)
        await member.request.get(new URL(target.signInUrl, devOrigin).href)
        const session = await (await member.request.get(`${devOrigin}/auth/session`)).json()
        const staleMember = (await member.cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
        const ownerSession = await (await owner.request.get(`${devOrigin}/auth/session`)).json()
        assert.equal((await member.request.post(`${devOrigin}/auth/session/revoke`, { headers: { Origin: devOrigin }, form: { sessionId: ownerSession.id } })).status(), 403)
        assert.equal((await owner.request.get(`${devOrigin}/auth/session`)).status(), 200)
        await Promise.all([page.waitForURL(/updated=1/), page.getByRole('button', { name: `Deactivate Synthetic local ${width}`, exact: true }).click()])
        assert.equal((await member.request.get(`${devOrigin}/auth/session`)).status(), 401)
        for (const path of ['/auth/session', '/api/operator/queries', '/api/operator/dashboards', '/api/operator/reports']) {
          assert.equal((await fetch(devOrigin + path, { headers: { cookie: staleMember } })).status, 401)
        }
        const refusedEntry = await member.request.get(new URL(target.signInUrl, devOrigin).href, { maxRedirects: 0 })
        assert.equal(refusedEntry.status(), 404)
        await page.reload()
        assert.equal(await page.getByRole('link', { name: `Sign in as Synthetic local ${width}`, exact: true }).count(), 0)
        if (process.env.BIFOCAL_PROOF_DIR) await page.screenshot({ path: `${process.env.BIFOCAL_PROOF_DIR}/people-deactivated-${width}.png`, fullPage: true })
        await Promise.all([page.waitForURL(/updated=1/), page.getByRole('button', { name: `Reactivate Synthetic local ${width}`, exact: true }).click()])
        assert.equal((await fetch(`${devOrigin}/auth/session`, { headers: { cookie: staleMember } })).status, 401, 'reactivation must not revive old sessions')
        await member.request.get(new URL(target.signInUrl, devOrigin).href)
        assert.equal((await member.request.get(`${devOrigin}/auth/session`)).status(), 200)
        const memberPage = await member.newPage()
        await memberPage.goto(`${devOrigin}/app/settings`)
        await memberPage.getByRole('heading', { name: 'This session', exact: true }).waitFor()
        const staleNewSession = (await member.cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
        if (process.env.BIFOCAL_PROOF_DIR) await memberPage.screenshot({ path: `${process.env.BIFOCAL_PROOF_DIR}/sessions-member-${width}.png`, fullPage: true })
        await Promise.all([memberPage.waitForURL(/\/signin/), memberPage.getByRole('button', { name: 'End this session', exact: true }).click()])
        assert.equal((await fetch(`${devOrigin}/auth/session`, { headers: { cookie: staleNewSession } })).status, 401)
        assert.equal((await member.request.get(`${devOrigin}/app/settings`, { maxRedirects: 0 })).status(), 303)
        assert.equal((await owner.request.get(`${devOrigin}/auth/session`)).status(), 200)
        const ended = await owner.request.get(`${devOrigin}/auth/sessions?operatorId=${encodeURIComponent(target.id)}`)
        assert.ok((await ended.json()).every(item => !item.active))
        assert.equal((await owner.request.post(`${devOrigin}/auth/invite`, { headers: { Origin: devOrigin }, data: { email: `synthetic-bifocal-no-analytics-${width}@example.test`, displayName: 'Synthetic refused', role: 'viewer' } })).status(), 400)
        assert.equal(session.operator.role, 'member')
      } finally { await owner.close(); await member.close() }
    }
    console.log('Native membership controls: deactivation, stale-cookie read denial, inactive sign-in refusal, reactivation without revival and self-session revocation at 1440/390 passed')
  } finally { await browser.close() }
}


// Named public-door journeys on the actual migrated Worker. No SQL fixtures or
// application substitutes: all data, plans and readback use authenticated HTTP.
