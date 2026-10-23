import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { proveAdministrativeSessions } from './journeys/people-sessions.mjs'
const socket = createServer()
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
const origin = `http://127.0.0.1:${port}`
const root = process.cwd(), scratch = await mkdtemp(join(tmpdir(), 'bifocal-member-sessions-'))
const state = join(scratch, '.wrangler/state')
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', RER_DEV_ORIGIN: origin, RER_DEV_KEY: 'synthetic-bifocal-4'.repeat(3), RER_STATE_DIR: state }
let worker, browser, output = ''
try {
 // A committed, disposable checkout keeps private settings and local state
 // separate from the installation being developed. Dependencies are shared.
 const tree = execFileSync('git', ['archive', 'HEAD'], { cwd: root, maxBuffer: 32 * 1024 * 1024 })
 execFileSync('tar', ['-x', '-C', scratch], { input: tree })
 await symlink(join(root, 'node_modules'), join(scratch, 'node_modules'), 'dir')
 await writeFile(join(scratch, '.dev.vars'), `AUTH_LOCAL=true\nAUTH_ORIGIN=${origin}\nOWNER_EMAIL=synthetic-bifocal-1@example.test\nSESSION_SECRET=${'synthetic-bifocal-2'.repeat(3)}\nSETUP_TOKEN=${'synthetic-bifocal-3'.repeat(3)}\nMAIL_PROVIDER=development\nMAIL_FROM=synthetic-bifocal-2@example.test\n`, { mode: 0o600 })
 execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'foundation', '--config', 'wrangler.jsonc', '--local', '--persist-to', state], { cwd: scratch, env, stdio: 'pipe' })
 worker = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: scratch, env, stdio: ['ignore', 'pipe', 'pipe'] })
 worker.stdout.on('data', chunk => { output += chunk }); worker.stderr.on('data', chunk => { output += chunk })
 let ready = false
 for (let attempt = 0; attempt < 180; attempt++) {
  if (worker.exitCode !== null) throw Error('Local Vite entry stopped before readiness')
  try { ready = (await fetch(origin + '/health')).ok } catch {}
  if (ready) break
  await new Promise(resolve => setTimeout(resolve, 500))
 }
 assert.ok(ready, 'Local Vite entry becomes ready')
 browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
 const context = await browser.newContext()
 const page = await context.newPage()
 assert.equal((await context.request.post(origin + '/__dev/key', { headers: { Origin: origin }, data: { key: env.RER_DEV_KEY } })).status(), 204)
 assert.equal((await context.request.post(origin + '/auth/bootstrap', { headers: { Origin: origin }, data: { token: 'synthetic-bifocal-3'.repeat(3), displayName: 'Synthetic owner', returnTo: '/app' }, maxRedirects: 0 })).status(), 303)
 await page.goto(origin + '/setup')
 await page.getByRole('checkbox').check()
 await Promise.all([page.waitForURL(origin + '/app'), page.getByRole('button', { name: 'Finish setup', exact: true }).click()])
 await context.close()
 await proveAdministrativeSessions(origin, browser)
} finally {
 await browser?.close()
 if (worker) { worker.kill('SIGTERM'); await new Promise(resolve => worker.exitCode !== null || worker.signalCode !== null ? resolve() : worker.once('exit', resolve)) }
 await rm(scratch, { recursive: true, force: true })
}
