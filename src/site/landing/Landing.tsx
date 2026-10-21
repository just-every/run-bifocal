import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { Hero } from './Hero'
import { AskYours } from './sections/AskYours'
import { MarginDrop } from './sections/MarginDrop'
import { MatchPowerBI } from './sections/MatchPowerBI'
import { SeeTheRows } from './sections/SeeTheRows'
import { StuckOnFriday } from './sections/StuckOnFriday'
import { WhatMoved } from './sections/WhatMoved'
import { WhichNumber } from './sections/WhichNumber'
import '../styles/tokens.css'
import '../styles/site.css'
import '../styles/landing.css'
import '../styles/sections/hero.css'
import '../styles/sections/which.css'
import '../styles/sections/margin.css'
import '../styles/sections/rows.css'
import '../styles/sections/friday.css'
import '../styles/sections/review.css'
import '../styles/sections/match.css'
import '../styles/sections/ask.css'
import '../styles/base-pages.css'

/**
 * run-bifocal.com's homepage, built from the desk's page round 2 (page-s1/STRUCTURE.md with BUILD-NOTES.md's builder
 * fixes): the owner's hero H, then seven screens, each one Monday question a buyer asks, one sentence and one proof
 * from a different example US company, over flat fields of cobalt, golden yellow, ink and white with straight seams.
 */
export function Landing() {
  return <div className="landing">
    <SiteHeader onHero />
    <main id="main">
      <Hero />
      <WhichNumber />
      <MarginDrop />
      <SeeTheRows />
      <StuckOnFriday />
      <WhatMoved />
      <MatchPowerBI />
      <AskYours />
    </main>
    <SiteFooter />
  </div>
}
