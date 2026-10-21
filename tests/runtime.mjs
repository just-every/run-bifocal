import {queuedEntrypoint} from '@runeditrun/rer/queued-entry';
const queued=await queuedEntrypoint(import.meta.url,'verify:runtime');if(queued!==null)process.exit(queued);
import assert from 'node:assert/strict'
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
const worker = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--inspector-port', '0', '--local', '--persist-to', persist, '--ip', '127.0.0.1', '--config', 'dist/server/wrangler.json', '--port', String(port), '--var', `AUTH_ORIGIN:${origin}`, '--var', 'AUTH_LOCAL:true', '--var', 'OWNER_EMAIL:synthetic-bifocal-1@example.test', '--var', `SESSION_SECRET:${'synthetic-bifocal-2'.repeat(3)}`, '--var', `SETUP_TOKEN:${syntheticSetup}`], { stdio: ['ignore', 'pipe', 'pipe'] })
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
    console.log('Foundation home: honest capability state, working links and revoked sign-out at 1440/390 passed')
    await context.close()
  } finally { await browser.close() }
  console.log('HTTP-001 passed against emitted local Worker: health, the installed homepage, HTTP and document 404s')
} finally {
  worker.kill('SIGTERM')
  await new Promise(resolve => worker.exitCode !== null ? resolve() : worker.once('exit', resolve))
  await rm(persist, { recursive: true, force: true })
}
