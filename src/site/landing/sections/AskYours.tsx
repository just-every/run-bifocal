import { Actions } from '../../shell/Actions'
import { Question, Screen } from '../parts'

/** 08: the closing, the one white screen: the question handed to the reader, the license line and the actions top left,
 * mark 4 alone bottom right. */
export function AskYours() {
  return <Screen id="ask" className="s-ask">
    <div className="screen-copy">
      <Question id="ask-title" lines={['Ask yours.']} />
      <p className="sentence closing-line">100% free and open source, MIT licensed.</p>
      <Actions className="closing-actions" />
    </div>
    <img className="closing-mark" src="/brand/mark.svg" alt="" width={255} height={122} loading="lazy" decoding="async" />
  </Screen>
}
