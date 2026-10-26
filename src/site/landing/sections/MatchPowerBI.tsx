import { Question, Screen, Sentence } from '../parts'
import { records } from '../records'

/** 07: the hero's exact split returns: the question on yellow at the right, "186" on cobalt at the left. */
export function MatchPowerBI() {
  const { matched, total } = records.tiles
  return <Screen id="match" className="s-match split-screen fields">
    <div className="screen-copy">
      <Question id="match-title" lines={['Does it', 'match', 'Power BI?']} />
      <Sentence>Import the Power BI workspace, run both side by side, and compare every tile before you switch.</Sentence>
    </div>
    <figure className="proof match-figure">
      <p className="numeral">{matched}</p>
      <figcaption className="label">of {total} tiles match</figcaption>
    </figure>
  </Screen>
}
