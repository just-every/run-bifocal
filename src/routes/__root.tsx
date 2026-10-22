import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { fontLinks } from '../base/font-head'
import { pageStyle } from '../base/page-style'
import { introCss, introGuardScript } from '../base/hydration/intro-guard'
import { NotFoundPage, notFoundStyle } from '../app/not-found'
import { identity } from '../identity'

// Hydration units (src/base/hydration/README.md): every page section and any
// root chrome sits in a HydrationUnit. Never set shellComponent, wrapInSuspense
// or pendingComponent on this root route.
export const Route = createRootRoute({
  head: ({ matches }) => ({ meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width,initial-scale=1' }, { title: matches.some(match => match.status === 'notFound' || match._notFound) ? `Page not found · ${identity.deployment}` : identity.deployment }] }),
  // A root not-found boundary replaces the root component, so it must retain
  // the document frame too; returning only a heading loses head and theme.
  notFoundComponent: () => <Document><NotFoundPage /></Document>,
  component: () => <Document><Outlet /></Document>,
})

function Document({ children }: { children: ReactNode }) {
 return <html lang="en"><head>
    {fontLinks.map(link => <link key={link.href} {...link} />)}
    <link rel="stylesheet" href="/app-theme.css" />
    <HeadContent />
    <script dangerouslySetInnerHTML={{ __html: introGuardScript }} />
    <style>{introCss}</style>
    <style>{pageStyle}</style>
    <style>{notFoundStyle}</style>
  </head><body>{children}<Scripts /></body></html>
}
