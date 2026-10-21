import { Lockup } from './Lockup'
import { links } from './links'

/** The header on every run-site page, as the hero draws it: the lockup on the cobalt half, Docs, Contract and Source
 * on the yellow half. On phones it is one yellow bar. `onHero` lays it over the homepage's own split. */
export function SiteHeader({ current, onHero = false }: { current?: 'docs' | 'contract'; onHero?: boolean }) {
  return <header className={`site-header${onHero ? ' on-hero' : ''}`}>
    <a className="skip-link" href="#main">Skip to content</a>
    <div className="site-header-row">
      <Lockup variant="header" />
      <nav aria-label="Main">
        <a href={links.docs} aria-current={current === 'docs' ? 'page' : undefined}>Docs</a>
        <a href={links.contract} aria-current={current === 'contract' ? 'page' : undefined}>Contract</a>
        <a href={links.source}>Source</a>
      </nav>
    </div>
  </header>
}
