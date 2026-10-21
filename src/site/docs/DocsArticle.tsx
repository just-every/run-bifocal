import { brushIndent } from '../shell/brush'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { docsPath } from '../shell/links'
import { DocsMenu, DocsSidebar } from './DocsNav'
import { docsNeighbors, getDocsPage } from './pages'
import '../styles/tokens.css'
import '../styles/site.css'
import '../styles/docs.css'

/** One docs page: the section sidebar, the article rendered from Markdown at build time, "On this page", and previous and next. */
export function DocsArticle({ slug }: { slug: string }) {
  const page = getDocsPage(slug)
  if (!page) throw new Error(`No docs page "${slug}"`)
  const { previous, next } = docsNeighbors(slug)
  const toc = page.toc.filter(entry => entry.depth === 2)
  return <>
    <SiteHeader current="docs" />
    <div className="docs-shell">
      <DocsSidebar current={slug} />
      <main id="main" className="docs-main">
        <DocsMenu current={slug} />
        <article aria-labelledby="docs-title">
          <header className="docs-page-head">
            <h1 id="docs-title" className="brush" style={{ textIndent: brushIndent(page.title) }}>{page.title}</h1>
            <p className="docs-lead">{page.summary}</p>
          </header>
          <div className="docs-prose" dangerouslySetInnerHTML={{ __html: page.html }} />
        </article>
        {(previous || next) && <nav className="docs-pager" aria-label="Previous and next">
          {previous ? <a className="docs-pager-link" href={docsPath(previous.slug)} rel="prev"><span className="docs-pager-dir">Previous</span><span className="docs-pager-title">{previous.title}</span></a> : <span />}
          {next ? <a className="docs-pager-link next" href={docsPath(next.slug)} rel="next"><span className="docs-pager-dir">Next</span><span className="docs-pager-title">{next.title}</span></a> : <span />}
        </nav>}
      </main>
      {toc.length > 1 ? <nav className="docs-toc" aria-label="On this page"><p className="docs-nav-section">On this page</p><ul>{toc.map(entry => <li key={entry.id}><a href={`#${entry.id}`}>{entry.text}</a></li>)}</ul></nav> : <span className="docs-toc-empty" />}
    </div>
    <SiteFooter />
  </>
}
