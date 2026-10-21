// The pieces every screen is made of. Every word and number is HTML over flat fields; nothing is painted.
import { Fragment, type ReactNode } from 'react'
import { brushIndent } from '../shell/brush'

/** A screen of the page: one brush question (its id is `${id}-title`), one sentence and one proof. */
export function Screen({ id, className, children }: { id: string; className: string; children: ReactNode }) {
  return <section id={id} className={`screen ${className}`} aria-labelledby={`${id}-title`}>
    <div className="stage">{children}</div>
  </section>
}

/** The brush question every screen opens with, broken where the desk breaks it on wide screens. */
export const Question = ({ id, lines }: { id: string; lines: string[] }) =>
  <h2 id={id} className="brush question">{lines.map((line, index) => <span className="line" key={index} style={{ marginLeft: brushIndent(line) }}>{line}{index < lines.length - 1 ? ' ' : ''}</span>)}</h2>

/** The screen's one sentence. */
export const Sentence = ({ children }: { children: ReactNode }) => <p className="sentence">{children}</p>

/** A label of parts joined by " · ": each part stays whole and its separator stays with the part before it, so a
 * wrapped line never starts with a separator. */
export const Parts = ({ parts }: { parts: ReactNode[] }) =>
  <>{parts.map((part, index) => <Fragment key={index}>{index ? ' ' : ''}<span className="nw">{part}{index < parts.length - 1 ? ' ·' : ''}</span></Fragment>)}</>
