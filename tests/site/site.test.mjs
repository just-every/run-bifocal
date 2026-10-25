// The run site (run-bifocal.com) as `rer build --site` writes it: a visitor reaches /run from the homepage's primary
// action, every page's links and files resolve inside the site, no page links an instance-only route, and no page
// outside /docs carries what a local run prints (the held-out site check's no-owner-data rule).
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = new URL('../..', import.meta.url).pathname
const site = join(root, 'dist/site')
const pages = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? pages(join(dir, entry.name)) : entry.name.endsWith('.html') ? [join(dir, entry.name)] : [])
const served = path => [path, `${path}.html`, join(path, 'index.html')].some(candidate => existsSync(join(site, candidate)) && !candidate.endsWith('/'))
const attrs = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'gi'))].map(match => match[1].replaceAll('&amp;', '&'))
const anchors = html => [...html.matchAll(/<a\b[^>]*\shref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(([, href, inner]) => ({ href, text: inner.replace(/<[^>]+>/g, '').replace(/&nbsp;|\s+/g, ' ').trim() }))

test('the run site builds, its Run Bifocal actions open /run, and every link and file it names resolves', () => {
  // A nested rer child sends its result to its owning capture. Assert the
  // public terminal boundary, including when this test itself runs in Verify.
  const rer = join(root, 'node_modules/.bin/rer')
  const output = execFileSync(rer, ['queue', 'site-output', '--', rer, 'build', '--site'], { cwd: root, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, PWD: root.replace(/\/$/, '') } })
  assert.match(output, /Run site written to dist\/site \(\d+ pages, \d+ files\)/, 'the published pin names the usable checkout-relative site path')
  assert.match(output, /Run site written to dist\/site[^\n]*:\s*\[REDACTED\](?:\/?dist\/site)?\s*$/m, 'the private absolute destination stays redacted across nested command capture')
  assert.ok(!output.includes(root), 'the checkout path must not bypass global redaction')
  const home = readFileSync(join(site, 'index.html'), 'utf8')
  const runs = anchors(home).filter(a => /^Run Bifocal\b/.test(a.text))
  assert.ok(runs.length > 0, 'the homepage leads with Run Bifocal')
  for (const action of runs) assert.equal(action.href, '/run', `"${action.text}" opens /run`)
  for (const path of ['run', 'docs', 'contract']) assert.ok(served(path), `/${path} is built`)
  for (const file of pages(site)) {
    const html = readFileSync(file, 'utf8'), where = relative(site, file)
    const refs = [...attrs(html, 'href'), ...attrs(html, 'src'), ...attrs(html, 'srcset').flatMap(set => set.split(',').map(part => part.trim().split(/\s+/)[0]))]
    for (const ref of refs.filter(ref => ref.startsWith('/') && !ref.startsWith('//'))) {
      const path = decodeURIComponent(ref.split(/[?#]/)[0])
      assert.doesNotMatch(path, /^\/(signin|login|sign-in|setup|app|auth|api|health)(\/|$)/, `${where} links the instance-only ${path}`)
      if (path !== '/') assert.ok(served(path), `${where} names ${path}, which the site does not serve`)
    }
    if (!where.startsWith('docs')) {
      assert.doesNotMatch(html, /\bRER_(?:OPEN|READY|SIGNED_IN|SITE)\b/, `${where} prints a rer dev output line`)
      assert.doesNotMatch(html, /\b(?:127\.0\.0\.1|localhost|\[::1\]):\d{2,5}\b/, `${where} names a loopback address`)
      assert.doesNotMatch(html, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.test\b/, `${where} names a local dev identity`)
    }
  }
})
