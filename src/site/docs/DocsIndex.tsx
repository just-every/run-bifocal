import { Arrow } from '../shell/Arrow'
import { brushIndent } from '../shell/brush'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { docsPath } from '../shell/links'
import { docsLead, docsSections } from './pages'
import '../styles/tokens.css'
import '../styles/site.css'
import '../styles/docs.css'

/** The docs home: the brush title, then every section as a ruled list, each page's title over its one-line summary. */
export function DocsIndex() {
  return <>
    <SiteHeader current="docs" />
    <main id="main" className="docs-home">
      <header className="docs-home-head"><h1 className="brush" style={{ textIndent: brushIndent('Docs') }}>Docs</h1><p className="docs-lead">{docsLead}</p></header>
      {docsSections.map((section, index) => <section key={section.title} aria-labelledby={`docs-section-${index}`} className="docs-home-section">
        <h2 id={`docs-section-${index}`} className="docs-section-title">{section.title}</h2>
        <ul className="docs-rows">{section.pages.map(page => <li key={page.slug}><a className="docs-row" href={docsPath(page.slug)}><span className="docs-row-title">{page.title}</span><span className="docs-row-summary">{page.summary}</span><Arrow className="arrow docs-row-arrow" /></a></li>)}</ul>
      </section>)}
    </main>
    <SiteFooter />
  </>
}
