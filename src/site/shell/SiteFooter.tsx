import { Lockup } from './Lockup'
import { links } from './links'

/** The footer on every run-site page, set as type under a hairline: the lockup, then Docs, Contract and Source. */
export function SiteFooter() {
  return <footer className="site-footer">
    <div className="site-footer-row">
      <Lockup variant="footer" />
      <nav aria-label="Footer">
        <a href={links.docs}>Docs</a>
        <a href={links.contract}>Contract</a>
        <a href={links.source}>Source</a>
      </nav>
    </div>
  </footer>
}
