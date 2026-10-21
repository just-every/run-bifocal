import { Arrow } from './Arrow'
import { links } from './links'

/** The page's one action, the square black Run Bifocal, then the text links Try the demo and Read the docs. */
export function Actions({ className = '' }: { className?: string }) {
  return <div className={`cta-row ${className}`.trim()}>
    <a className="run-button" href={links.run}><span>Run Bifocal</span><Arrow /></a>
    <a className="text-link" href={links.demo}>Try the demo</a>
    <a className="text-link" href={links.docs}>Read the docs</a>
  </div>
}
