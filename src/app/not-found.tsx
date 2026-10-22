import { HydrationUnit } from '../base/hydration/unit'
import { identity } from '../identity'

// Match the existing foundation card and its declared theme tokens. Shared
// Base sources, the Lobby, public Run site and brand assets stay untouched.
export const notFoundStyle = '.bifocal-not-found{box-sizing:border-box;max-width:480px;margin:32px auto;padding:36px;background:var(--rer-surface,#fff);border-radius:var(--rer-radius,12px);box-shadow:0 1px 2px #0000000d,0 14px 36px #00000014;overflow-wrap:anywhere}'
 + '.bifocal-not-found .brand{display:flex;align-items:center;gap:12px;margin:0 0 28px;font-size:18px;font-weight:600}.bifocal-not-found .brand img{width:32px;height:32px}'
 + '.bifocal-not-found h1{font-size:30px;line-height:1.25;margin:0 0 16px}.bifocal-not-found p{margin:0 0 20px;color:var(--rer-muted,#475569)}'
 + '@media(max-width:480px){.bifocal-not-found{margin:8px auto;padding:28px 20px}.bifocal-not-found h1{font-size:26px}}'

export function NotFoundPage() {
 return <HydrationUnit><main className="bifocal-not-found">
  <div className="brand"><img src={identity.mark} alt="" /><span>{identity.deployment}</span></div>
  <h1>Page not found</h1>
  <p>This address has no page in this installation.</p>
  <p>This route is unavailable. App home lists the bounded file import, exact-answer and account tools you can use; full BI authoring remains unfinished.</p>
  <nav aria-label="Page recovery"><ul><li><a href="/app">Open app home</a></li><li><a href="/">Go to Lobby</a></li></ul></nav>
 </main></HydrationUnit>
}
