import { rejectedResponse } from './base/rejected-response'
import { createDependencies } from './modules/dependencies/index.mjs'
import { createIdpOwnerClaimHandler, createOwnerClaimHandler } from './modules/owner-claim/index.mjs'
import { firstRunResponse } from './base/setup'
import { fontDocumentResponse } from './base/font-response'
import { createOperatorAuth, createAuthHandler, createSignInHandler, type AuthConfig } from './modules/operator-auth/index.mjs'
import { operatorMail } from './mail.server.mjs'
import branding from './branding.json'
import { homePage } from './app/home'
import { currentAuthority } from './bifocal/catalog/authority.server'
import { homeEntries } from './bifocal/apps/reader.server'
import { ownerPlaces } from './bifocal/home/places.server'
import { accountSide, appDocument, appPolicy, type Place, type Viewer } from './app/shell'
import { installedDocs } from './app/docs'
import { peoplePage, peopleUnavailable, inviteNotice, type InviteRefusal } from './app/people'
import { settingsPage, nameNotice, sessionNotice, type AccountSession } from './app/settings'
import { displayZone } from './bifocal/company/display-zone'

// The edition's declared theme (public/app-theme.css), as Base frames link it.
const theme = { href: '/app-theme.css', productName: branding.name, accentColor: branding.primaryColor }

export interface Bindings {
 BIFOCAL_ACTION_ORIGINS?: string
 BIFOCAL_VANE_ORIGIN?: string
 DB: D1Database
 /** Built browser files; hosted deploys run the Worker first (staticAssetResponse). */
 ASSETS?: Fetcher
 RER_DEPLOY_SOURCE?: string
 RER_DEPLOY_FINGERPRINT?: string
 RER_VERSION?: { id: string }
 IDENTITY_PROVIDER?: string
 AUTH_ORIGIN: string
 AUTH_LOCAL?: string
 RER_DEV_ORIGIN?: string
 /** Local runtimes only: the checkout's key gate and dev identity switch. Deploy refuses both. */
 RER_MODELS_SERVICE?: string
 RER_MODELS_KEY?: string
 RER_DEMO?: string
 RER_OWNER_CLAIM_ISSUER?: string
 RER_OWNER_CLAIM_INSTALLATION_ID?: string
 RER_OWNER_CLAIM_PUBLIC_KEYS?: string
 RER_DEV_KEY?: string
 RER_DEV_IDENTITY?: string
 RER_INSTALLATION_ID?: string
 RER_MANAGEMENT_ORIGIN?: string
 AI_ENABLED?: string
 AI_MODEL?: string
 AI_API_KEY?: string
 AI_BASE_URL?: string
 MODELS_SERVICE?: string
 MODELS_KEY?: string
 OWNER_EMAIL: string
 SESSION_SECRET: string
 INSTALLATION_KEY?: string
 INSTALLATION_KEY_PREVIOUS?: string
 SETUP_TOKEN?: string
 MAIL_PROVIDER?: 'development' | 'rer' | 'resend' | 'sendgrid' | 'cloudflare'
 MAIL_FROM?: string
 MAIL_API_KEY?: string
 MAIL_RELAY_URL?: string
 MAIL_ACCOUNT_ID?: string
}

export const runtimeBindings = (env: Bindings): Bindings => env.RER_DEV_ORIGIN && env.AUTH_LOCAL === 'true' ? { ...env, AUTH_ORIGIN: env.RER_DEV_ORIGIN } : env
export const authConfig = (env: Bindings): AuthConfig => ({ dependencies: true, origin: env.AUTH_ORIGIN, local: env.AUTH_LOCAL === 'true', OWNER_EMAIL: env.OWNER_EMAIL, SESSION_SECRET: env.SESSION_SECRET, INSTALLATION_KEY: env.INSTALLATION_KEY, INSTALLATION_KEY_PREVIOUS: env.INSTALLATION_KEY_PREVIOUS, SETUP_TOKEN: env.SETUP_TOKEN, MAIL_FROM: env.MAIL_FROM, branding: { productName: branding.name, accentColor: branding.primaryColor, signInPath: '/signin', theme: theme.href } })
export function operatorAuth(env: Bindings) {
 return createOperatorAuth({ db: env.DB, config: authConfig(env), mailSender: operatorMail(env), clientIp: request => request.headers.get('CF-Connecting-IP') ?? '' })
}

const privateHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' }
// Every app page wears the frame (src/app/shell.ts); the installed guide wears it signed out too, without tools.
function html(main: string, title: string, viewer: Viewer | null, place: Place, status = 200) {
 const side = viewer && place !== 'home' ? accountSide(viewer.role, place) : ''
 return new Response(appDocument({ title, viewer, place, side, main, head: place === 'home' ? '<link rel="stylesheet" href="/bifocal/apps.css">' : place === 'settings' && viewer?.role === 'owner' ? '<script type="module" src="/bifocal/protection-settings.js"></script>' : '' }), { status, headers: { ...privateHeaders, 'referrer-policy': 'strict-origin', 'content-type': 'text/html; charset=utf-8', 'content-security-policy': `default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; ${appPolicy}; ${place === 'settings' ? "script-src 'self'; connect-src 'self'" : ''}` } })
}

// What a refused invite form carried, read no further than the native door's own 8 KiB input bound.
async function typedForm(body: ReadableStream<Uint8Array> | null) {
 const reader = body?.getReader(), decoder = new TextDecoder()
 let text = '', length = 0
 while (reader) {
  const next = await reader.read()
  if (next.done) break
  length += next.value.byteLength
  if (length > 8192) { await reader.cancel(); return new URLSearchParams() }
  text += decoder.decode(next.value, { stream: true })
 }
 return new URLSearchParams(text + decoder.decode())
}

async function handleAuthResponse(request: Request, original: Bindings): Promise<Response | null> {
 const env = runtimeBindings(original), url = new URL(request.url)
 if (url.pathname === '/docs') {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { ...privateHeaders, allow: 'GET, HEAD' } })
  const session = await operatorAuth(env).getSession(request)
  return html(installedDocs(), `Installation guide · ${branding.name}`, session?.operator ?? null, 'guide')
 }
 if (url.pathname.startsWith('/.well-known/rer-') || url.pathname.startsWith('/auth/dependencies/')) {
  const linked = await createDependencies({ db: env.DB, origin: env.AUTH_ORIGIN, name: branding.name, provider: env.IDENTITY_PROVIDER, local: env.AUTH_LOCAL === 'true', INSTALLATION_KEY: env.INSTALLATION_KEY, INSTALLATION_KEY_PREVIOUS: env.INSTALLATION_KEY_PREVIOUS, auth: operatorAuth(env), claimOwner: token => createIdpOwnerClaimHandler({db:env.DB,authConfig:authConfig(env),clientIp:()=>request.headers.get('CF-Connecting-IP')??''})(new Request(env.AUTH_ORIGIN+'/auth/owner-claim',{method:'POST',headers:{Host:new URL(env.AUTH_ORIGIN).host,Origin:env.AUTH_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({token})})) }).handle(request)
  if (linked) return linked
 }
 if (url.pathname === '/auth/owner-claim') {
  // Only the native demo host's per-visitor bindings enable signed claims.
  if (env.RER_DEMO === '1' && env.RER_OWNER_CLAIM_PUBLIC_KEYS) return createOwnerClaimHandler({
   db: env.DB, authConfig: authConfig(env), clientIp: req => req.headers.get('CF-Connecting-IP') ?? '',
   issuer: env.RER_OWNER_CLAIM_ISSUER ?? '', installationId: env.RER_OWNER_CLAIM_INSTALLATION_ID ?? '',
   appOrigin: env.AUTH_ORIGIN, expectedEmail: env.OWNER_EMAIL, publicKeys: JSON.parse(env.RER_OWNER_CLAIM_PUBLIC_KEYS),
  })(request)
  return createIdpOwnerClaimHandler({db:env.DB,authConfig:authConfig(env),clientIp:req=>req.headers.get('CF-Connecting-IP')??''})(request)
 }
 // The shared server-rendered sign-in page: plain forms that work before any script.
 if (url.pathname === '/signin') {
  const page = await createSignInHandler(operatorAuth(env), {
   defaultReturnTo: '/setup',
  })(request)
  if (page) return fontDocumentResponse(page)
 }
 const settingsResponse = async (notice = '', status = 200) => {
  const auth = operatorAuth(env)
  const session = await auth.getSession(request)
  if (!session) return new Response(null, { status: 303, headers: { ...privateHeaders, location: '/signin?returnTo=%2Fapp%2Fsettings' } })
  const response = await createAuthHandler(auth)(new Request(new URL('/auth/sessions', url), { headers: request.headers }))
  const sessions = response?.ok ? await response.json() as AccountSession[] : null
  return html(settingsPage(session.operator, sessions, session.id, await displayZone(env, session.operator.email), notice), `Your settings · ${branding.name}`, session.operator, 'settings', status)
 }
 const peopleResponse = async (notice = '', status = 200, refusal?: InviteRefusal) => {
  const auth = operatorAuth(env)
  const session = await auth.getSession(request)
  if (!session) return new Response(null, { status: 303, headers: { ...privateHeaders, location: '/signin?returnTo=%2Fapp%2Fpeople' } })
  // Use the same native read adapter as /auth/operators; no UI-only access grant.
  const response = await createAuthHandler(auth)(new Request(new URL('/auth/operators', url), { headers: request.headers }))
  if (!response?.ok) return html(peopleUnavailable(), `People unavailable · ${branding.name}`, session.operator, 'people', response?.status ?? 503)
  return html(peoplePage(await response.json(), session.operator, notice, refusal), `People · ${branding.name}`, session.operator, 'people', status)
 }
 if (url.pathname.startsWith('/auth/')) {
  // A refused invitation comes back with what the person typed, so keep a copy of the form the native door reads.
  const typed = url.pathname === '/auth/invite' && request.method === 'POST' && request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded') ? request.clone() : null
  const response = await createAuthHandler(operatorAuth(env))(request)
  // Keep native authorization, origin checks and cookie revocation. A browser
  // form receives a useful destination; API clients retain the native 204.
  if (url.pathname === '/auth/signout' && response?.status === 204 && request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
   const headers = new Headers(response.headers)
   headers.set('location', '/signin')
   return new Response(null, { status: 303, headers })
  }
  if (typed) {
   if (response?.ok) {
    await typed.body?.cancel()
    return new Response(null, { status: 303, headers: { ...privateHeaders, location: '/app/people?invited=1' } })
   }
   const error = await response?.json() as { error?: string } | undefined
   const form = await typedForm(typed.body)
   return peopleResponse('', response?.status ?? 503, { code: error?.error ?? '', displayName: form.get('displayName') ?? '', email: form.get('email') ?? '', role: form.get('role') ?? '' })
  }
  if (['/auth/invite/cancel', '/auth/operator/status'].includes(url.pathname) && request.method === 'POST' && request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
   if (response?.ok) return new Response(null, { status: 303, headers: { ...privateHeaders, location: '/app/people?updated=1' } })
   const error = await response?.json() as { error?: string } | undefined
   return peopleResponse(inviteNotice(error?.error ?? ''), response?.status ?? 503)
  }
  if (url.pathname === '/auth/session/revoke' && request.method === 'POST' && request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
   // Native authorization handles self and administrative revocations. An ended
   // current session redirects via settings' ordinary sign-in guard.
   if (response?.ok) return new Response(null, { status: 303, headers: { ...privateHeaders, location: '/app/settings?ended=1' } })
   const error = await response?.json() as { error?: string } | undefined
   return settingsResponse(sessionNotice(error?.error ?? ''), response?.status ?? 503)
  }
  if (url.pathname === '/auth/display-name' && request.method === 'POST' && request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
   if (response?.ok) return new Response(null, { status: 303, headers: { ...privateHeaders, location: '/app/settings?saved=1' } })
   const error = await response?.json() as { error?: string } | undefined
   return settingsResponse(nameNotice(error?.error ?? ''), response?.status ?? 503)
  }
  return fontDocumentResponse(response)
 }
 if (url.pathname === '/setup' || url.pathname === '/app' || url.pathname.startsWith('/app/')) {
  const setup = await firstRunResponse(request, env, operatorAuth(env), { theme })
  if (setup) return setup
 }
 if (url.pathname === '/app/settings' && ['GET', 'HEAD'].includes(request.method)) {
  return settingsResponse(url.searchParams.get('saved') === '1' ? '<p class="status" role="status">Your display name is saved.</p>' : url.searchParams.get('ended') === '1' ? '<p class="status" role="status">The session has ended.</p>' : '')
 }
 if (url.pathname === '/app/people' && ['GET', 'HEAD'].includes(request.method)) {
  return peopleResponse(url.searchParams.get('invited') === '1' ? '<p class="status" role="status">Invitation requested. The person’s current status is shown below.</p>' : url.searchParams.get('updated') === '1' ? '<p class="status" role="status">Access updated. The person’s current status is shown below.</p>' : '')
 }
 if (url.pathname === '/app') {
  const session = await operatorAuth(env).getSession(request)
  if (!session) return new Response(null, { status: 303, headers: { ...privateHeaders, location: '/signin' } })
  const actor = await currentAuthority(request, env)
  return html(homePage(actor && actor.role !== 'owner' ? await homeEntries(env, actor) : [], actor?.role === 'owner' ? await ownerPlaces(env, actor) : null), `App home · ${branding.name}`, session.operator, 'home')
 }
 return null
}

export async function authResponse(request: Request, original: Bindings): Promise<Response | null> {
 const response = await handleAuthResponse(request, original)
 return response ? rejectedResponse(request, response) : null
}
