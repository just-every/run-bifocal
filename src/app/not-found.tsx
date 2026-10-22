import { HydrationUnit } from '../base/hydration/unit'
import { identity } from '../identity'

// The app's quiet card (public/bifocal/app.css): a hairline, the app radius, mark 4 at its own width, read from the
// declared --rer-* tokens. Shared Base sources, the Lobby, public Run site and brand assets stay untouched.
export const notFoundStyle = '.bifocal-not-found{box-sizing:border-box;max-width:440px;margin:48px auto;padding:40px;background:var(--rer-surface,#fff);border:1px solid var(--app-line,#e3e6ec);border-radius:var(--rer-radius,8px);overflow-wrap:anywhere}'
 + '.bifocal-not-found .brand{display:flex;align-items:center;gap:10px;margin:0 0 32px;font:700 22px/1 var(--rer-font-heading,inherit);letter-spacing:-.01em}.bifocal-not-found .brand img{width:50px;height:24px}'
 + '.bifocal-not-found h1{font:700 28px/1.2 var(--rer-font-heading,inherit);letter-spacing:-.015em;margin:0 0 16px}.bifocal-not-found p{margin:0 0 16px;color:var(--rer-muted,#5b6475)}'
 + '.bifocal-not-found ul{display:flex;flex-wrap:wrap;gap:8px 20px;margin:24px 0 0;padding:0;list-style:none}.bifocal-not-found a{color:var(--rer-link,#1d5ed8);font-weight:600}'
 + '@media(max-width:480px){.bifocal-not-found{margin:16px auto;padding:28px 20px}.bifocal-not-found h1{font-size:26px}}'

export function NotFoundPage() {
 return <HydrationUnit><main className="bifocal-not-found">
  <div className="brand"><img src={identity.mark} alt="" /><span>{identity.deployment}</span></div>
  <h1>Page not found</h1>
  <p>This address has no page in this installation.</p>
  <p>This route is unavailable. App home lists the bounded file import, exact-answer and account tools you can use; full BI authoring remains unfinished.</p>
  <nav aria-label="Page recovery"><ul><li><a href="/app">Open app home</a></li><li><a href="/">Go to Lobby</a></li></ul></nav>
 </main></HydrationUnit>
}
