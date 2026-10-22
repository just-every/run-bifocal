import test from 'node:test'
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
    } else assert.equal((await claim.json()).error, 'provider_unlinked')
   } finally {
    child.kill('SIGTERM')
    await new Promise(resolve => child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', resolve))
   }
  }
 } finally { await rm(persist, { recursive: true, force: true }) }
})
