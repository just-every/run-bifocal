import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { ownerSigninDigest, OWNER_SIGNIN_PATH } from '../src/modules/operator-auth/owner-signin-grant.mjs'

// The built Worker as a hosted install (AUTH_LOCAL=false, https) with MAIL_PROVIDER=none: email sign-in
// refuses plainly, and the owner signs in with the one-time grant `rer signin` writes into the deployment's D1.
test('hosted mail off: email sign-in refuses and the owner signs in through a rer signin grant', async () => {
 const root = process.cwd()
 const require = createRequire(await realpath(join(root, 'node_modules/wrangler/package.json')))
 const { Miniflare, convertV4MiniflareOptions } = require('miniflare')
 const { unstable_splitSqlQuery: splitSql } = require('wrangler')
 const config = JSON.parse(await readFile(join(root, 'dist/server/wrangler.json'), 'utf8'))
 const socket = createServer()
 await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
 const port = socket.address().port
 await new Promise(resolve => socket.close(resolve))
 const origin = `https://127.0.0.1:${port}`, email = 'synthetic-bifocal-1@example.test', setup = 'synthetic-bifocal-3'.repeat(3)
 const persist = await mkdtemp(join(tmpdir(), 'bifocal-mail-off-'))
 const assets = (await readdir(join(root, 'dist/server/assets'))).filter(file => file.endsWith('.js')).map(file => `assets/${file}`)
 const mf = new Miniflare({ ...convertV4MiniflareOptions({
  host: '127.0.0.1', port, https: true, modulesRoot: join(root, 'dist/server'),
  modules: [config.main, ...assets].map(file => ({ type: 'ESModule', path: join(root, 'dist/server', file) })),
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  assets: { directory: join(root, 'dist/client'), routerConfig: { has_user_worker: true } },
  d1Databases: { DB: 'mail-off' },
  bindings: { AUTH_ORIGIN: origin, AUTH_LOCAL: 'false', MAIL_PROVIDER: 'none', MAIL_FROM: '', OWNER_EMAIL: email, SESSION_SECRET: 'synthetic-bifocal-2'.repeat(3), SETUP_TOKEN: setup, INSTALLATION_KEY: 'a'.repeat(64) },
  // No outbound request is expected: mail off has no sender.
  outboundService: request => { throw new Error(`Unexpected outbound request to ${request.url}`) },
 }), resourcePersistencePath: join(persist, 'state') })
 const request = (path, { method = 'GET', body, cookie } = {}) => mf.dispatchFetch(origin + path, { method, redirect: 'manual',
  headers: { origin, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
 try {
  await mf.ready
  const db = await mf.getD1Database('DB')
  for (const file of (await readdir(join(root, 'migrations/core'))).filter(file => file.endsWith('.sql')).sort())
   for (const sql of splitSql(await readFile(join(root, 'migrations/core', file), 'utf8'))) await db.prepare(sql).run()
  // The owner is claimed at set-up with the setup token, as rer deploy does.
  const claimed = await request('/auth/bootstrap', { method: 'POST', body: { token: setup, displayName: 'Synthetic owner', returnTo: '/app' } })
  assert.equal(claimed.status, 303, await claimed.clone().text())
  await claimed.arrayBuffer()

  const signin = await request('/signin')
  assert.equal(signin.status, 200)
  assert.doesNotMatch(await signin.text(), /action="\/auth\/magic-link"/)
  const magic = await request('/auth/magic-link', { method: 'POST', body: { email } })
  assert.equal(magic.status, 503)
  assert.equal((await magic.json()).error, 'mail_unavailable')

  // The grant rer signin writes at the Cloudflare D1 boundary (modules/deploy-kit/owner-signin.mjs).
  const token = randomBytes(32).toString('base64url'), now = Date.now()
  const grant = await db.prepare(`INSERT INTO oa_owner_signins(id,token_hash,operator_id,operator_version,created_at,expires_at)
   SELECT ?,?,o.id,o.version,?,? FROM oa_operators o LEFT JOIN oa_bootstrap b ON b.claim_id=o.id WHERE o.role='owner' AND o.status='active'
   ORDER BY b.claim_id IS NULL, o.created_at, o.id LIMIT 1`).bind(randomUUID(), await ownerSigninDigest(token), now, now + 600_000).run()
  assert.equal(grant.meta.changes, 1)
  const page = await request(`${OWNER_SIGNIN_PATH}?token=${token}`)
  assert.equal(page.status, 200)
  await page.arrayBuffer()
  const confirmed = await request(OWNER_SIGNIN_PATH, { method: 'POST', body: { token } })
  assert.equal(confirmed.status, 303, await confirmed.clone().text())
  await confirmed.arrayBuffer()
  const cookie = confirmed.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const session = await request('/auth/session', { cookie })
  assert.equal(session.status, 200)
  assert.equal((await session.json()).operator.email, email)
  const again = await request(OWNER_SIGNIN_PATH, { method: 'POST', body: { token } })
  assert.equal(again.status, 400, 'a grant signs in once')
  await again.arrayBuffer()
 } finally {
  await mf.dispose()
  await rm(persist, { recursive: true, force: true })
 }
})
