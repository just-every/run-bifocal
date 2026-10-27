import test from 'node:test'
import { prepareMachineRestore } from './journeys/machine-doors.mjs'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

test('signed owner claims require both demo mode and trusted runtime keys', async () => {
 const persist = await mkdtemp(join(tmpdir(), 'bifocal-demo-claim-'))
 const socket = createServer()
 await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
 const port = socket.address().port
 await new Promise(resolve => socket.close(resolve))
 const origin = `http://127.0.0.1:${port}`, email = 'synthetic-bifocal-1@example.test'
 const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
 const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey)
 const keys = JSON.stringify({ synthetic: { kty, crv, x, y } })
 const iat = Math.floor(Date.now() / 1000)
 const segment = value => Buffer.from(JSON.stringify(value)).toString('base64url')
 const message = `${segment({ alg: 'ES256', typ: 'rer-owner-claim+jwt', kid: 'synthetic' })}.${segment({ v: 1, iss: origin, aud: origin, installationId: 'synthetic-bifocal-1', email, jti: crypto.randomUUID(), iat, exp: iat + 300 })}`
 const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(message))
 const token = `${message}.${Buffer.from(signature).toString('base64url')}`
 const config = ['--config', 'dist/server/wrangler.json']
 const vars = { AUTH_ORIGIN: origin, AUTH_LOCAL: 'true', OWNER_EMAIL: email, SESSION_SECRET: 'synthetic-bifocal-2'.repeat(3), SETUP_TOKEN: 'synthetic-bifocal-3'.repeat(3), RER_OWNER_CLAIM_ISSUER: origin, RER_OWNER_CLAIM_INSTALLATION_ID: 'synthetic-bifocal-1' }
 const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }
 const wrangler = ['node_modules/wrangler/bin/wrangler.js']
 try {
  execFileSync(process.execPath, [...wrangler, 'd1', 'migrations', 'apply', 'foundation', '--local', '--persist-to', persist, ...config], { env, stdio: 'pipe' })
  for (const mode of [{ RER_OWNER_CLAIM_PUBLIC_KEYS: keys }, { RER_DEMO: '1' }, { RER_DEMO: '1', RER_OWNER_CLAIM_PUBLIC_KEYS: keys }]) {
   const trustedDemo = mode.RER_DEMO === '1' && Boolean(mode.RER_OWNER_CLAIM_PUBLIC_KEYS)
   let output = ''
   const child = spawn(process.execPath, [...wrangler, 'dev', '--local', '--inspector-port', '0', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persist, ...config, ...Object.entries({ ...vars, ...mode }).flatMap(([name, value]) => ['--var', `${name}:${value}`])], { env, stdio: ['ignore', 'pipe', 'pipe'] })
   child.stdout.on('data', chunk => { output += chunk })
   child.stderr.on('data', chunk => { output += chunk })
   try {
    let ready = false
    for (let attempt = 0; attempt < 120; attempt++) {
     assert.equal(child.exitCode, null, 'Worker stays running')
     try { ready = (await fetch(origin + '/health')).ok } catch {}
     if (ready) break
     await new Promise(resolve => setTimeout(resolve, 250))
    }
    assert.ok(ready, output)
    const claim = await fetch(origin + '/auth/owner-claim', { method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/json', 'x-rer-demo': '1', 'x-rer-owner-claim-public-keys': keys }, body: JSON.stringify({ token, returnTo: '/app' }) })
    assert.equal(claim.status, trustedDemo ? 303 : 403)
    assert.equal(claim.headers.has('set-cookie'), trustedDemo)
    const cookie = trustedDemo ? claim.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') : ''
    const session = await fetch(origin + '/auth/session', { headers: { cookie } })
    assert.equal(session.status, trustedDemo ? 200 : 401)
    if (trustedDemo) {
     assert.equal((await session.json()).operator.role, 'owner')
     const app = await fetch(origin + '/app', { headers: { cookie }, redirect: 'manual' })
     assert.equal(app.status, 200, 'demo seed completes first run')
     await app.arrayBuffer()
     const orders = await fetch(origin + '/api/operator/datasets/demo-orders', { headers: { cookie } })
     assert.equal(orders.status, 200)
     assert.equal((await orders.json()).table.rows.length, 300, 'demo imports the complete retail source')
     const library = await (await fetch(origin + '/api/operator/library/search?tag=demo', { headers: { cookie } })).json()
     assert.equal(library.total, 1)
     const dashboardPath = library.items[0].sourceLinks[0].replace('/app/', '/api/operator/')
     const dashboard = await (await fetch(origin + dashboardPath, { headers: { cookie } })).json()
     assert.equal(dashboard.answer.rows.length, 6, 'demo dashboard retains all six monthly groups')
     assert.equal(dashboard.answer.totals.orders.value, '300')
     assert.equal((await fetch(origin + dashboardPath)).status, 401, 'demo answers retain owner authorization')
    } else assert.equal((await claim.json()).error, 'provider_unlinked')
   } finally {
    child.kill('SIGTERM')
    await new Promise(resolve => child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', resolve))
   }
  }
 } finally {
  await rm(persist, { recursive: true, force: true })
  // wrangler dev keeps its scratch (.wrangler/tmp) beside the config it runs, which here is the emitted Worker; the artifact producer refuses that folder in dist/server, so leave the build output as rer build wrote it.
  await rm('dist/server/.wrangler', { recursive: true, force: true })
 }
})

// Installer/archive qualification is intentionally outside push Verify. Run this
// committed public-door journey explicitly, with the exact candidate checked out.
test('restored owner definitions survive archives and browser setup refuses a different owner', { skip: process.env.BIFOCAL_RESTORE_OWNER_PROOF !== '1', timeout: 600_000 }, async () => {
 const { cp, mkdir, writeFile, readFile, access, rename } = await import('node:fs/promises')
 const { spawnSync } = await import('node:child_process')
 const { createHash } = await import('node:crypto')
 const { chromium } = await import('@playwright/test')
 const { startInstaller } = await import('@runeditrun/rer/installer-server')
 const root = process.cwd(), scratch = await mkdtemp(join(tmpdir(), 'bifocal-restored-owner-'))
 const originalOwner = 'synthetic-bifocal-1@example.test', changedOwner = 'synthetic-bifocal-9@example.test'
 const syntheticSecret = 'synthetic-bifocal-2'.repeat(3), syntheticSetup = 'synthetic-bifocal-3'.repeat(3)
 const syntheticInstallationKey = createHash('sha256').update('synthetic-bifocal-6').digest('hex')
 const environment = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }
 let worker, installer, browser
 const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: scratch, env: environment, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  const errors = (result.stdout ?? '').split('\n').flatMap(line => { try { const event = JSON.parse(line); return event.event === 'error' ? [event.message] : [] } catch { return [] } })
  assert.equal(result.status, 0, `Disposable archive journey command exits successfully: ${args[1] ?? command.split('/').at(-1)}; ${errors.join(' ')}`)
  return result.stdout
 }
 const rer = (...args) => run(process.execPath, [join(scratch, 'node_modules/@runeditrun/rer/bin/rer.mjs'), ...args, '--non-interactive', '--json'])
 try {
  const tree = execFileSync('git', ['archive', 'HEAD'], { cwd: root, maxBuffer: 32 * 1024 * 1024 })
  execFileSync('tar', ['-x', '-C', scratch], { input: tree })
  await cp(join(root, 'node_modules'), join(scratch, 'node_modules'), { recursive: true, verbatimSymlinks: true })
  await cp(join(root, 'dist'), join(scratch, 'dist'), { recursive: true, verbatimSymlinks: true })
  const socket = createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  const origin = `http://127.0.0.1:${port}`
  const privateSettings = `AUTH_ORIGIN=${origin}\nAUTH_LOCAL=true\nOWNER_EMAIL=${originalOwner}\nSESSION_SECRET=${syntheticSecret}\nINSTALLATION_KEY=${syntheticInstallationKey}\nSETUP_TOKEN=${syntheticSetup}\nMAIL_PROVIDER=development\nMAIL_FROM=synthetic-bifocal-2@example.test\n`
  await writeFile(join(scratch, '.dev.vars'), privateSettings, { mode: 0o600 })
  const wrangler = ['node_modules/wrangler/bin/wrangler.js']
  const normalization = join(scratch, 'migrations/core/0024_company_defaults_restore.sql')
  await rename(normalization, join(scratch, 'pending-company-defaults.sql'))
  run(process.execPath, [...wrangler, 'd1', 'migrations', 'apply', 'foundation', '--local', '--config', 'wrangler.jsonc'])
  let workerOutput = ''
  const startWorker = (mode = {}) => { const child = spawn(process.execPath, [...wrangler, 'dev', '--config', 'dist/server/wrangler.json', '--persist-to', '.wrangler/state', '--local', '--inspector-port', '0', '--ip', '127.0.0.1', '--port', String(port), ...Object.entries({ AUTH_ORIGIN: origin, AUTH_LOCAL: 'true', OWNER_EMAIL: originalOwner, SESSION_SECRET: syntheticSecret, SETUP_TOKEN: syntheticSetup, INSTALLATION_KEY: syntheticInstallationKey, ...mode }).flatMap(([key, value]) => ['--var', `${key}:${value}`])], { cwd: scratch, env: environment, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.on('data', b => { workerOutput += b }); child.stderr.on('data', b => { workerOutput += b }); return child }
  const waitReady = async () => {
   let ready = false
   for (let attempt = 0; attempt < 120; attempt++) {
    assert.equal(worker.exitCode, null, workerOutput.split('\n').filter(line => /error|exception|failed|invalid/i.test(line)).join('\n'))
    try { ready = (await fetch(origin + '/health')).ok } catch {}
    if (ready) break
    await new Promise(resolve => setTimeout(resolve, 250))
   }
   assert.ok(ready)
  }
  worker = startWorker()
  await waitReady()
  const claim = await fetch(origin + '/auth/bootstrap', { method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: syntheticSetup, displayName: 'Synthetic retained owner', returnTo: '/app' }) })
  assert.equal(claim.status, 303)
  const cookie = claim.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  await claim.body?.cancel()
  const currentCompany = await (await fetch(origin + '/api/operator/company', { headers: { cookie } })).json()
  assert.ok(currentCompany.updatedAt, 'the prior migration stamped built-in defaults at install time')
  const changedCompany = await fetch(origin + '/api/operator/company', { method: 'PUT', headers: { cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ previousRevision: currentCompany.revision, settings: { name: 'Synthetic retained company' } }) })
  assert.equal(changedCompany.status, 200)
  const savedCompany = await changedCompany.json()
  assert.ok(savedCompany.updatedAt)
  const content = await fetch(origin + '/api/operator/library/items', { method: 'POST', headers: { cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'notebook', title: 'Retained quarterly analysis', description: 'Owner catalog record', tags: ['quarterly'], definition: {}, sourceLinks: [], verified: false, collectionId: null, sourceDatasets: [] }) })
  assert.equal(content.status, 201)
  const catalogItem = await content.json()
  const search = async sessionCookie => {
   const response = await fetch(origin + '/api/operator/library/search?q=quarterly', { headers: { cookie: sessionCookie } })
   assert.equal(response.status, 200)
   const result = await response.json()
   assert.equal(result.total, 1)
   assert.deepEqual(result.items.map(item => item.id), [catalogItem.id])
  }
  await search(cookie)
  const machineCredential = await prepareMachineRestore({ origin, cookie })
  worker.kill('SIGTERM')
  await new Promise(resolve => worker.exitCode !== null || worker.signalCode !== null ? resolve() : worker.once('exit', resolve))
  worker = undefined
  await rename(join(scratch, 'pending-company-defaults.sql'), normalization)
  run(process.execPath, [...wrangler, 'd1', 'migrations', 'apply', 'foundation', '--local', '--config', 'wrangler.jsonc'])
  await mkdir(join(scratch, 'exports'))
  rer('export', '--output', 'exports/owner.rer')
  const archive = await readFile(join(scratch, 'exports/owner.rer'), 'utf8')
  const { fileRecords } = await import('@runeditrun/rer/modules/portability/files')
  let manifest
  for await (const record of fileRecords(join(scratch, 'exports/owner.rer'))) if (record.kind === 'manifest') manifest = record
  assert.ok(manifest.tables.some(table => table.name === 'oa_operators'), 'archive includes original owner definitions')
  assert.ok(manifest.tables.some(table => table.name === 'bf_machine_source_rules'), 'bounded machine source restrictions travel as definitions')
  assert.ok(!manifest.tables.some(table => table.name.startsWith('bf_catalog_search')), 'derived search and shadow tables never travel')
  for (const name of ['oa_sessions', 'oa_provider_sessions', 'rer_dependency_keys', 'bf_machine_credentials']) assert.ok(!manifest.tables.some(table => table.name === name), `${name} does not travel`)
  assert.ok(!archive.includes(machineCredential.token), 'machine bearer never travels')
  assert.ok(!archive.includes(syntheticSecret) && !archive.includes(syntheticSetup) && !archive.includes(syntheticInstallationKey), 'private settings do not travel')
  await rm(join(scratch, '.wrangler'), { recursive: true, force: true })
  await rm(join(scratch, '.dev.vars'))
  await rm(join(scratch, '.seed'), { recursive: true, force: true })
  await rm(join(scratch, '.rer'), { recursive: true, force: true })
  rer('import', '--input', 'exports/owner.rer', '--yes')
  const owners = () => JSON.parse(run(process.execPath, [...wrangler, 'd1', 'execute', 'foundation', '--local', '--config', 'wrangler.jsonc', '--command', "SELECT email,role,status FROM oa_operators WHERE role='owner'", '--json']))[0].results
  assert.deepEqual(owners(), [{ email: originalOwner, role: 'owner', status: 'active' }])
  const company = () => JSON.parse(run(process.execPath, [...wrangler, 'd1', 'execute', 'foundation', '--local', '--config', 'wrangler.jsonc', '--command', 'SELECT revision,value_json,updated_at,updated_by FROM bf_company_settings', '--json']))[0].results
  const expectedCompany = [{ revision: savedCompany.revision, value_json: JSON.stringify(savedCompany.settings), updated_at: savedCompany.updatedAt, updated_by: originalOwner }]
  assert.deepEqual(company(), expectedCompany, 'owner-saved values and time survive restore exactly')
  await writeFile(join(scratch, '.dev.vars'), privateSettings, { mode: 0o600 })
  const devKey = 'synthetic-bifocal-4'.repeat(3)
  worker = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: scratch, env: { ...environment, RER_STATE_DIR: join(scratch, '.wrangler/state'), RER_DEV_ORIGIN: origin, RER_DEV_KEY: devKey }, stdio: ['ignore', 'ignore', 'ignore'] })
  await waitReady()
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--use-mock-keychain', '--password-store=basic', '--no-sandbox'] })
  const restoredContext = await browser.newContext(), restoredPage = await restoredContext.newPage()
  assert.equal((await restoredContext.request.post(origin + '/__dev/key', { headers: { Origin: origin }, data: { key: devKey } })).status(), 204)
  await restoredPage.goto(origin + '/auth/dev/enter?as=owner')
  if (new URL(restoredPage.url()).pathname === '/setup') {
   await restoredPage.getByRole('checkbox').check()
   await Promise.all([restoredPage.waitForURL(origin + '/app'), restoredPage.getByRole('button', { name: 'Finish setup', exact: true }).click()])
  }
  const restoredCredential = await fetch(origin + '/api/v1/definitions', { headers: { Authorization: 'Bearer ' + machineCredential.token } })
  assert.equal(restoredCredential.status, 401, 'supported CLI restore cannot revive an issued machine credential')
  await restoredCredential.arrayBuffer()
  const restoredMachineHistory = await restoredContext.request.get(origin + '/api/operator/credentials')
  assert.equal(restoredMachineHistory.status(), 200)
  const machineHistory = await restoredMachineHistory.json()
  assert.deepEqual(machineHistory.credentials, [])
  assert.ok(machineHistory.history.some(event => event.credential_id === machineCredential.id && event.actor_kind === 'human' && event.action === 'issued-exact-review'), 'attributed human issuance history survives without authority')
  const restoredPolicy = await restoredContext.request.get(origin + '/api/operator/credentials/sources/synthetic-bifocal-restore')
  assert.equal(restoredPolicy.status(), 200)
  assert.deepEqual((await restoredPolicy.json()).definition, { columns: ['invoice', 'region', 'revenue'], filters: [{ column: 'region', op: 'eq', value: 'West' }] }, 'archive preserves the exact source restrictions without machine activation')
  const restoredSearch = await restoredContext.request.get(origin + '/api/operator/library/search?q=quarterly')
  assert.equal(restoredSearch.status(), 200)
  const restoredResults = await restoredSearch.json()
  assert.equal(restoredResults.total, 1)
  assert.deepEqual(restoredResults.items.map(item => item.id), [catalogItem.id])
  for (const width of [1440, 390]) {
   await restoredPage.setViewportSize({ width, height: 1000 })
   await restoredPage.goto(origin + '/app/library?q=quarterly')
   await restoredPage.getByRole('link', { name: 'Retained quarterly analysis', exact: true }).waitFor()
   assert.ok(await restoredPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
   if (process.env.BIFOCAL_PROOF_DIR) await restoredPage.screenshot({ path: `${process.env.BIFOCAL_PROOF_DIR}/restored-search-${width}.png`, fullPage: true })
  }
  await restoredContext.close()
  await browser.close()
  browser = undefined
  worker.kill('SIGTERM')
  await new Promise(resolve => worker.exitCode !== null || worker.signalCode !== null ? resolve() : worker.once('exit', resolve))
  worker = undefined
  await rm(join(scratch, '.dev.vars'))
  rer('export', '--output', 'exports/restored-owner.rer')
  const nonempty = spawnSync(process.execPath, [join(scratch, 'node_modules/@runeditrun/rer/bin/rer.mjs'), 'import', '--input', 'exports/owner.rer', '--yes', '--non-interactive', '--json'], { cwd: scratch, env: environment, encoding: 'utf8' })
  assert.equal(nonempty.status, 4, 'a populated destination still refuses restore')
  assert.match(nonempty.stdout, /target_not_empty/)
  assert.deepEqual(owners(), [{ email: originalOwner, role: 'owner', status: 'active' }])
  assert.deepEqual(company(), expectedCompany, 'refused restore makes no partial writes')
  const { createSeed } = await import(new URL('file://' + join(scratch, 'scripts/installer/seed.mjs')))
  installer = await startInstaller(scratch, { seed: createSeed(scratch) })
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--use-mock-keychain', '--password-store=basic', '--no-sandbox'] })
  const context = await browser.newContext(), page = await context.newPage()
  const response = await page.goto(installer.origin)
  const token = /<meta name="installer-token" content="([^"]+)"/.exec(await response.text())?.[1]
  assert.ok(token)
  const headers = { Origin: installer.origin, 'x-installer-token': token }
  assert.equal((await context.request.post(installer.origin + '/api/draft', { headers, data: { OWNER_EMAIL: changedOwner, displayName: 'Synthetic changed owner' } })).status(), 200)
  assert.equal((await context.request.post(installer.origin + '/api/start', { headers, data: {} })).status(), 202)
  let state
  for (let attempt = 0; attempt < 300; attempt++) {
   state = await (await context.request.get(installer.origin + '/api/state', { headers })).json()
   if (['complete', 'failed'].includes(state.phase)) break
   await new Promise(resolve => setTimeout(resolve, 1000))
  }
  assert.equal(state.phase, 'failed', 'changed-owner setup cannot silently succeed after restore')
  assert.match(state.logs.join('\n'), /Local database already belongs to synthetic-bifocal-1@example.test/)
  assert.match(state.logs.join('\n'), /Existing data and private settings were kept/)
  assert.deepEqual(owners(), [{ email: originalOwner, role: 'owner', status: 'active' }])
  await assert.rejects(access(join(scratch, '.dev.vars')), { code: 'ENOENT' })
  for (const width of [1440, 390]) {
   await page.setViewportSize({ width, height: 1000 })
   await page.reload()
   await page.getByRole('heading', { name: 'Installation needs attention', exact: true }).waitFor()
   assert.match(await page.getByLabel('Installation log', { exact: true }).innerText(), /Local database already belongs to synthetic-bifocal-1@example.test/)
   await page.getByRole('button', { name: 'Review saved answers', exact: true }).waitFor()
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
   if (process.env.BIFOCAL_PROOF_DIR) await page.screenshot({ path: `${process.env.BIFOCAL_PROOF_DIR}/restored-owner-refusal-${width}.png`, fullPage: true })
  }
  await context.close()
 } finally {
  await browser?.close()
  await installer?.close()
  if (worker) {
   worker.kill('SIGTERM')
   await new Promise(resolve => worker.exitCode !== null || worker.signalCode !== null ? resolve() : worker.once('exit', resolve))
  }
  await rm(scratch, { recursive: true, force: true })
 }
})
