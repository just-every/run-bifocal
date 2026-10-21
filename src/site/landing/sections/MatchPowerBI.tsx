import { Question, Screen, Sentence } from '../parts'
import { records } from '../records'

/** 07: Granite's switch from Power BI, as one number. Mirrored from the plate so the hero's cobalt-left split does not
 * come back: the question on yellow at the left, "186" on cobalt at the right. */
export function MatchPowerBI() {
  const { matched, total } = records.tiles
  return <Screen id="match" className="s-match split-screen mirrored fields">
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
