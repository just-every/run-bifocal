import { Parts, Question, Screen, Sentence } from '../parts'
import { records } from '../records'

/** 05: the one failure and its recovery, the page's only black screen: Fernway's QuickBooks refresh. The stale stamp is
 * struck through in yellow over the time the data was current again. */
export function StuckOnFriday() {
  const { stale, current } = records.refresh
  return <Screen id="friday" className="s-friday">
    <div className="screen-copy">
      <Question id="friday-title" lines={['Why is finance', 'stuck on Friday?']} />
      <Sentence>When the QuickBooks admin left, Bifocal kept Friday’s numbers stamped, named the fix, and finance reconnected.</Sentence>
    </div>
    <figure className="proof stamp">
      <p className="stamp-stale"><s><span className="nw">as of {stale.day},</span> <span className="nw">{stale.time}</span></s></p>
      <p className="numeral stamp-time">{current.time}</p>
      <figcaption className="label"><Parts parts={[current.day, 'current']} /></figcaption>
    </figure>
  </Screen>
}
