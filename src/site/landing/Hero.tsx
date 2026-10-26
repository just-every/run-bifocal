import { Actions } from '../shell/Actions'
import { brushIndent } from '../shell/brush'
import { records } from './records'

/** A giant figure, its leading "1," drawn as tight as the plate draws it. */
const figure = (value: string) => value.startsWith('1,') ? <><span className="tight">1,</span>{value.slice(2)}</> : value

/** 01: the approved image converted to editable panels, integrated with the site's own fonts, mark and real links.
 * Page-s2's build default removes the ruled list and makes the offer one sentence. On phones the offer precedes
 * the whole customer-count proof. */
export function Hero() {
  const { here, there } = records.customers
  return <section className="home-hero" aria-labelledby="hero-title">
    <div className="hero-offer">
      <h1 id="hero-title" className="brush"><span className="line" style={{ textIndent: brushIndent('B') }}>Bifocal shows </span><span className="line line-2" style={{ textIndent: brushIndent('i') }}>its work.</span></h1>
      <p className="hero-line">Ask in plain English and get the chart, query, certified definition and rows from every database and app you run.</p>
      <p className="hero-alt">100% free, open source alternative to <b>Power&nbsp;BI</b>, <b>Tableau</b> and <b>Looker</b></p>
      <Actions className="hero-actions" />
    </div>
    <div className="hero-proof">
      <p className="hero-struck numeral"><s>{here}</s></p>
      <p className="hero-figure numeral">{figure(there)}</p>
      <p className="hero-label">Active customers</p>
    </div>
  </section>
}
