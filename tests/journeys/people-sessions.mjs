import assert from 'node:assert/strict'

const screenshot = async (page, name, width) => {
 assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflow at ${width}`)
 if (process.env.BIFOCAL_PROOF_DIR) await page.screenshot({ path: `${process.env.BIFOCAL_PROOF_DIR}/${name}-${width}.png`, fullPage: true })
}

// The emitted Worker proves navigation, real native session readback and the
// empty/error states without the optional local identity layer.
export async function provePeopleSessions(origin, context, page) {
 const current = await (await context.request.get(`${origin}/auth/session`)).json()
 const people = await (await context.request.get(`${origin}/auth/operators`)).json()
 const invited = people.find(person => person.status === 'invited')
 assert.ok(invited)
 for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: 1000 })
  await page.goto(`${origin}/app/people`)
  await screenshot(page, 'people-session-links', width)
  await page.getByRole('link', { name: `View sessions for ${current.operator.displayName}`, exact: true }).click()
  await page.getByRole('heading', { name: `Sessions for ${current.operator.displayName}`, exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'End this session', exact: true }).count(), 1)
  assert.match(await page.locator('main').innerText(), /does not deactivate the account/)
  const response = await context.request.get(page.url())
  assert.match(response.headers()['cache-control'], /no-store/)
  const rejected = await context.request.post(page.url(), { headers: { Origin: 'https://foreign.example.test' }, form: { sessionId: current.id } })
  assert.equal(rejected.status(), 403)
  assert.equal((await context.request.get(`${origin}/auth/session`)).status(), 200)
  await screenshot(page, 'people-sessions-own', width)
  await page.getByRole('link', { name: 'Back to People', exact: true }).click()
  await page.getByRole('link', { name: `View sessions for ${invited.displayName}`, exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'No active sessions' }).waitFor()
  assert.equal(await page.getByRole('button', { name: /^End / }).count(), 0)
  await screenshot(page, 'people-sessions-empty', width)
  const missing = await page.goto(`${origin}/app/people/sessions?person=synthetic-bifocal-404`)
  assert.equal(missing.status(), 404)
  await page.getByRole('alert').waitFor()
  await screenshot(page, 'people-sessions-unavailable', width)
  await page.getByRole('link', { name: 'Back to People', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.waitForURL(`${origin}/app/people`)
 }
 const signedOut = await context.browser().newContext()
 try {
  assert.equal((await signedOut.request.get(`${origin}/app/people/sessions?person=${current.operator.id}`, { maxRedirects: 0 })).status(), 303)
  assert.equal((await signedOut.request.post(`${origin}/app/people/sessions?person=${current.operator.id}`, { form: { sessionId: current.id }, maxRedirects: 0 })).status(), 303)
 } finally { await signedOut.close() }
 console.log('People sessions: native listing, private refusal, CSRF refusal and empty/error recovery at 1440/390 passed')
}

// Independent signed-in people use the actual local invitation/sign-in doors.
// No DB fixtures and no application replacement are involved.
export async function proveAdministrativeSessions(origin, browser) {
 for (const width of [1440, 390]) {
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext({ viewport: { width, height: 1000 } })))
  const [owner, admin, member, other] = contexts
  try {
   for (const context of contexts) assert.equal((await context.request.post(`${origin}/__dev/key`, { headers: { Origin: origin }, data: { key: 'synthetic-bifocal-4'.repeat(3) } })).status(), 204)
   const page = await owner.newPage()
   await page.goto(`${origin}/auth/dev/enter?as=owner`)
   const invited = []
   for (const role of ['admin', 'member']) {
    await page.goto(`${origin}/app/people`)
    await page.getByLabel('Name', { exact: true }).fill(`Synthetic ${role} ${width}`)
    await page.getByLabel('Email', { exact: true }).fill(`synthetic-bifocal-sessions-${role}-${width}@example.test`)
    await page.getByLabel('Foundation role', { exact: true }).selectOption(role)
    await Promise.all([page.waitForURL(/invited=1/), page.getByRole('button', { name: 'Send invitation', exact: true }).click()])
    invited.push((await (await owner.request.get(`${origin}/auth/operators`)).json()).find(person => person.displayName === `Synthetic ${role} ${width}`))
   }
   const [administrator, person] = invited
   for (const [context, target] of [[admin, administrator], [member, person], [other, person]]) {
    assert.equal((await context.request.get(new URL(target.signInUrl, origin).href)).status(), 200)
   }
   const administratorPage = await admin.newPage(), memberPage = await member.newPage()
   const ownerSession = await (await owner.request.get(`${origin}/auth/session`)).json()
   const firstSession = await (await member.request.get(`${origin}/auth/session`)).json()
   const secondSession = await (await other.request.get(`${origin}/auth/session`)).json()
   assert.equal((await member.request.get(`${origin}/app/people/sessions?person=${administrator.id}`)).status(), 403)
   assert.equal((await admin.request.get(`${origin}/app/people/sessions?person=${ownerSession.operator.id}`)).status(), 403)
   assert.equal((await admin.request.post(`${origin}/app/people/sessions?person=${person.id}`, { headers: { Origin: origin }, form: { sessionId: ownerSession.id } })).status(), 403)
   assert.equal((await owner.request.get(`${origin}/auth/session`)).status(), 200)
   await memberPage.goto(`${origin}/app/people/sessions?person=${administrator.id}`)
   await memberPage.getByRole('alert').waitFor()
   await screenshot(memberPage, 'people-sessions-permission', width)
   await administratorPage.goto(`${origin}/app/people`)
   assert.equal(await administratorPage.getByRole('link', { name: `View sessions for ${ownerSession.operator.displayName}`, exact: true }).count(), 0)
   await administratorPage.getByRole('link', { name: `View sessions for ${person.displayName}`, exact: true }).click()
   await administratorPage.getByRole('heading', { name: `Sessions for ${person.displayName}`, exact: true }).waitFor()
   assert.equal(await administratorPage.getByRole('list', { name: 'Active sessions', exact: true }).getByRole('listitem').count(), 2)
   await screenshot(administratorPage, 'people-sessions-admin', width)
   for (const [context, session] of [[member, firstSession], [other, secondSession]]) {
    const stale = (await context.cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
    const form = administratorPage.locator('form').filter({ has: administratorPage.locator(`input[name="sessionId"][value="${session.id}"]`) })
    await form.getByRole('button').focus()
    const [ended] = await Promise.all([administratorPage.waitForResponse(response => new URL(response.url()).pathname === '/app/people/sessions' && response.request().method() === 'POST'), administratorPage.keyboard.press('Enter')])
    assert.equal(ended.status(), 303)
    assert.equal((await fetch(`${origin}/auth/session`, { headers: { cookie: stale } })).status, 401)
    if (context === member) assert.equal((await other.request.get(`${origin}/auth/session`)).status(), 200)
    assert.equal((await admin.request.get(`${origin}/auth/session`)).status(), 200)
   }
   await administratorPage.getByRole('status').filter({ hasText: 'No active sessions' }).waitFor()
   await screenshot(administratorPage, 'people-sessions-ended', width)
   const readback = await (await owner.request.get(`${origin}/auth/sessions?operatorId=${person.id}`)).json()
   assert.ok(readback.every(session => !session.active))
   // A revoked session can be replaced by a new sign-in; the old one stays dead.
   assert.equal((await member.request.get(new URL(person.signInUrl, origin).href)).status(), 200)
   assert.equal((await member.request.get(`${origin}/auth/session`)).status(), 200)
   await administratorPage.goto(`${origin}/app/people`)
   await administratorPage.getByRole('link', { name: `View sessions for ${administrator.displayName}`, exact: true }).click()
   await Promise.all([administratorPage.waitForURL(/\/signin/), administratorPage.getByRole('button', { name: 'End this session', exact: true }).click()])
   assert.equal((await admin.request.get(`${origin}/auth/session`)).status(), 401)
   await screenshot(administratorPage, 'people-sessions-self-ended', width)
  } finally { for (const context of contexts) await context.close() }
 }
 console.log('Administrative sessions: invited admin/member, native scope, selective revocation, stale-cookie denial and fresh sign-in at 1440/390 passed')
}
