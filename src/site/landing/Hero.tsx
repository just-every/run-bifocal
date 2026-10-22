import { Actions } from '../shell/Actions'
import { Arrow } from '../shell/Arrow'
import { brushIndent } from '../shell/brush'
import { records } from './records'

/** A giant figure, its leading "1," drawn as tight as the plate draws it. */
const figure = (value: string) => value.startsWith('1,') ? <><span className="tight">1,</span>{value.slice(2)}</> : value

/** 01, the owner's hero H as drawn: a hard 50/50 split. Cobalt holds the struck 1,907 over the giant 1,842, "Active
 * customers" and the ruled list; yellow holds the brush headline, the approved two-sentence line, the alternative line
 * and the actions. On phones the yellow half comes first, under the header, then the cobalt block. The header itself
 * (SiteHeader onHero) lies over the hero from the landing wrapper, outside <main>. */
export function Hero() {
  const { here, there } = records.customers
  return <section className="home-hero" aria-labelledby="hero-title">
    <div className="hero-offer">
      <h1 id="hero-title" className="brush"><span className="line" style={{ textIndent: brushIndent('B') }}>Bifocal shows </span><span className="line line-2" style={{ textIndent: brushIndent('i') }}>its work.</span></h1>
      <p className="hero-line">Ask in plain English. Get the chart, the query, the certified definition and the rows, from every database and app you run.</p>
      <p className="hero-alt">100% free, open source alternative to <b>Power&nbsp;BI</b>, <b>Tableau</b> and <b>Looker</b></p>
      <Actions className="hero-actions" />
    </div>
    <div className="hero-proof">
      <p className="hero-struck numeral"><s>{here}</s></p>
      <p className="hero-figure numeral">{figure(there)}</p>
      <p className="hero-label">Active customers</p>
      <ul className="hero-list">
        <li><span className="nw">{here} here</span></li>
        <li><span className="nw">{there} there</span></li>
        <li>one certified <span className="nw">definition <Arrow /></span> <span className="nw">{there} everywhere</span></li>
      </ul>
    </div>
  </section>
}
