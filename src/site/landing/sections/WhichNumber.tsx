import { Question, Screen, Sentence } from '../parts'
import { records } from '../records'

/** 02: Tidewell's two counts and the one certified definition: a full yellow field, one cobalt square low right. */
export function WhichNumber() {
  const { here, there, between } = records.customers
  return <Screen id="which-number" className="s-which">
    <div className="screen-copy">
      <Question id="which-number-title" lines={['Which number', 'is right?']} />
      <Sentence>Bifocal listed the free trials, cancellations and test accounts between them, and finance certified one definition.</Sentence>
    </div>
    <figure className="proof which-square">
      <p className="numeral">{between}</p>
      <figcaption className="label"><span className="nw">between {here}</span> <span className="nw">and {there}</span></figcaption>
    </figure>
  </Screen>
}
