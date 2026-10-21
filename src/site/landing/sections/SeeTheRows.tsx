import { Parts, Question, Screen, Sentence } from '../parts'
import { records } from '../records'

/** 04: Granite West's September invoices: the question on the yellow top, "212 of 212" on the full-bleed cobalt band. */
export function SeeTheRows() {
  const { shown, total, amount } = records.rows
  return <Screen id="rows" className="s-rows fields">
    <div className="screen-copy">
      <Question id="rows-title" lines={['Can I see the rows?']} />
      <Sentence>Three clicks take you from the chart to every invoice behind it, and the export matches.</Sentence>
    </div>
    <figure className="proof rows-figure">
      <p className="numeral"><span className="nw">{shown}</span> <span className="nw">of {total}</span></p>
      <figcaption className="label"><Parts parts={['West invoices', amount]} /></figcaption>
    </figure>
  </Screen>
}
