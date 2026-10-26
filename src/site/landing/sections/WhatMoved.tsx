import { Parts, Question, Screen, Sentence } from '../parts'
import { records, reviewLines } from '../records'

/** 06: the report agent doing real work: one flat white letter-size page on a full yellow field, the top of Fernway's
 * weekly review with each line cited, blank below, resting on the proof baseline. The COO approved the draft. */
export function WhatMoved() {
  return <Screen id="review" className="s-review">
    <div className="screen-copy">
      <Question id="review-title" lines={['What moved', 'last week?']} />
      <Sentence>The report agent drafted Monday's review, each line cited to its query, and the COO approved it.</Sentence>
    </div>
    <figure className="proof review-page" aria-label="The weekly review, drafted with a citation on every line">
      <p className="review-head"><Parts parts={['Weekly review', records.review.day]} /></p>
      <ol className="review-lines">{reviewLines.map((line, index) => <li key={line}><span>{line}</span>{' '}<sup>{index + 1}</sup></li>)}</ol>
    </figure>
  </Screen>
}
