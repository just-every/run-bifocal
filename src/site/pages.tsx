// The run site (run-bifocal.com) `rer build --site` writes: the homepage with its Run action, /run, the docs from
// docs/*.md, /contract from CONTRACT.md, and the not-found page. Every Run page string and command is in run.json;
// nothing here reads installation data.
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { contractPageHtml } from '../base/contract-page'
import { runPageHtml, siteNotFoundHtml, type RunData, type SiteBuild, type SiteContext } from '../base/run-site'
import { identity } from '../identity'
import { wearSite } from './base-pages'
import { DocsArticle } from './docs/DocsArticle'
import { DocsIndex } from './docs/DocsIndex'
import { docsHead, docsPages } from './docs/pages'
import { Landing } from './landing/Landing'
import run from './run.json'

// Code cards get their Copy button only when script runs; without it the command is still there to select.
const COPY = "document.querySelectorAll('.docs-copy').forEach(b=>{b.hidden=false;b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.closest('.docs-code').querySelector('code').textContent);b.textContent='Copied';setTimeout(()=>{b.textContent='Copy'},1600)}catch{}})})"

// The homepage's title and description (the desk set none for Bifocal: the title names the product and its category,
// the description is the hero's approved line).
const TITLE = 'Bifocal · Free, open source business intelligence'
const DESCRIPTION = 'Ask in plain English. Get the chart, the query, the certified definition and the rows, from every database and app you run.'
const SHARE = `${identity.runSite}/site/share.png`
const FONTS = ['/fonts/mona-sans/mona-sans-latin-wght-normal.woff2', '/fonts/kaushan-script/kaushan-script-latin-400-normal.woff2']

/** The font preloads and share card every run-site page carries, Base's pages included (they bring their own icon links). */
const sharedHead = (title: string, description: string) => <>
  <meta name="theme-color" content="#2e7dfd" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Bifocal" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:image" content={SHARE} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Bifocal shows its work: 1,907 struck through over 1,842 active customers, on cobalt and golden yellow" />
  <meta name="twitter:card" content="summary_large_image" />
  {FONTS.map(href => <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />)}
</>

export function sitePages({ styles, contract }: SiteContext): SiteBuild {
  const data: RunData = run
  const document = (title: string, description: string, body: ReactElement, script = '') => '<!doctype html>' + renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="description" content={description} />
        {sharedHead(title, description)}
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" type="image/svg+xml" href="/favicon-32.svg" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="stylesheet" href="/fonts/fonts.css" />
        {styles.map(href => <link key={href} rel="stylesheet" href={href} />)}
      </head>
      <body>{body}{script ? <script dangerouslySetInnerHTML={{ __html: script }} /> : null}</body>
    </html>,
  )
  // Base's pages keep their composition and wear the site: its tokens, header and footer, and no floor art.
  const site = { ...identity, band: undefined }
  const base = (page: 'run' | 'contract' | 'not-found', html: string, title: string, description: string) => wearSite(html, { page, styles, head: renderToStaticMarkup(sharedHead(title, description)) })
  const docs = (slug?: string) => docsHead(slug)
  return {
    pages: [
      { path: '/', html: document(TITLE, DESCRIPTION, <Landing />) },
      { path: '/run', html: base('run', runPageHtml(site, data, contract), 'Run Bifocal', 'Run Bifocal on your computer. 100% free and open source.') },
      ...(contract ? [{ path: '/contract', html: base('contract', contractPageHtml(site, data, contract), 'Contract · Bifocal', 'What Bifocal is being built to do, and how much of it the code does today.') }] : []),
      { path: '/docs', html: document(docs().title, docs().description, <DocsIndex />) },
      ...docsPages.map(page => ({ path: `/docs/${page.slug}`, html: document(docs(page.slug).title, docs(page.slug).description, <DocsArticle slug={page.slug} />, COPY) })),
      { path: '/404', html: base('not-found', siteNotFoundHtml(site, data, contract), 'Not found · Bifocal', DESCRIPTION) },
    ],
    assets: ['rer-theme.css', 'app-theme.css', 'fonts', 'brand', 'site', 'favicon.ico', 'favicon-32.svg', 'apple-touch-icon.png'],
  }
}
