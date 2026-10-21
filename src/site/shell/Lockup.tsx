import { links } from './links'

const MARK = { width: 255, height: 122 }

/** Mark 4 and the Bifocal wordmark in the heading face. `header` wears the cobalt-ground colors on wide screens (the
 * clean ring white, over the cobalt half) and the white-ground mark on phones, where the header sits on yellow. */
export function Lockup({ variant }: { variant: 'header' | 'footer' }) {
  return <a className={`lockup lockup-${variant}`} href={links.home} aria-label="Bifocal home">
    <picture>
      {variant === 'header' && <source media="(min-width: 1024px)" srcSet="/brand/mark-on-cobalt.svg" />}
      <img src="/brand/mark.svg" alt="" width={MARK.width} height={MARK.height} />
    </picture>
    <span>Bifocal</span>
  </a>
}
