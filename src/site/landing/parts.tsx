// The pieces every screen is made of. Every word and number is HTML over flat fields; nothing is painted.
import { Fragment, type CSSProperties, type ReactNode } from 'react'
import { brushIndent } from '../shell/brush'

/** A screen of the page: one brush question (its id is `${id}-title`), one sentence and one proof. */
export function Screen({ id, className, children }: { id: string; className: string; children: ReactNode }) {
  return <section id={id} className={`screen ${className}`} aria-labelledby={`${id}-title`}>
    <div className="stage">{children}</div>
  </section>
}

/** The brush question every screen opens with, broken where the desk breaks it on wide screens. Where those lines
 * would leave a word alone on a phone, `narrow` breaks the same words its own way below a width (landing.css), each
 * of its lines starting on the margin too. */
export function Question({ id, lines, narrow }: { id: string; lines: string[]; narrow?: { below: 660 | 760; lines: string[] } }) {
  if (!narrow) return <h2 id={id} className="brush question">{lines.map((line, index) => <span className="line" key={index} style={{ textIndent: brushIndent(line) }}>{line}{index < lines.length - 1 ? ' ' : ''}</span>)}</h2>
  // Split the words where either set of lines breaks: each piece sits in its wide line, and the piece that starts a
  // narrow line is pulled onto the margin there, after a break the piece before it draws.
  const words = (set: string[]) => set.flatMap((line, row) => line.split(' ').map((word, index) => ({ word, row, starts: index === 0 })))
  const wide = words(lines), small = words(narrow.lines)
  if (wide.map(w => w.word).join(' ') !== small.map(w => w.word).join(' ')) throw new Error(`Question ${id}: its narrow lines must hold the same words`)
  const pieces: { row: number; text: string; lead: boolean; brk: boolean }[] = []
  wide.forEach(({ word, row, starts }, i) => {
    if (starts || small[i].starts) pieces.push({ row, text: word, lead: i > 0 && small[i].starts, brk: false })
    else pieces[pieces.length - 1].text += ` ${word}`
    pieces[pieces.length - 1].brk = i + 1 < small.length && small[i + 1].starts
  })
  return <h2 id={id} className={`brush question narrow-${narrow.below}`} style={{ textIndent: brushIndent(lines[0]) }}>{lines.map((line, row) =>
    <span className="line" key={row} style={{ textIndent: brushIndent(line) }}>{pieces.filter(piece => piece.row === row).map((piece, index, all) =>
      <span key={index} className={[piece.lead && 'lead', piece.brk && 'brk'].filter(Boolean).join(' ') || undefined} style={piece.lead ? { '--lead': brushIndent(piece.text) } as CSSProperties : undefined}>{piece.text}{index < all.length - 1 || row < lines.length - 1 ? ' ' : ''}</span>)}</span>)}</h2>
}

/** The screen's one sentence. */
export const Sentence = ({ children }: { children: ReactNode }) => <p className="sentence">{children}</p>

/** A label of parts joined by " · ": each part stays whole and its separator stays with the part before it, so a
 * wrapped line never starts with a separator. */
export const Parts = ({ parts }: { parts: ReactNode[] }) =>
  <>{parts.map((part, index) => <Fragment key={index}>{index ? ' ' : ''}<span className="nw">{part}{index < parts.length - 1 ? ' ·' : ''}</span></Fragment>)}</>
