// Kaushan Script's left side bearing for the letters a brush line starts with (canvas metrics, em), less the reach of
// the brush's stroke (half of --brush-stroke, calc(.064em - 1.8px) in tokens.css), so a line's ink starts on the margin
// instead of inside it.
const BEARING: Record<string, number> = { A: .061, B: .135, C: .142, D: .156, G: .141, I: .131, P: .130, R: .129, S: .101, W: .219, f: .088, i: .098, l: .096, m: .086, o: .090, s: .020, t: .125 }

/** The left offset that puts a brush line's first letter on the margin, as a text-indent, so a line that wraps starts
 * its next row on the margin too. */
export const brushIndent = (line: string) => line[0] in BEARING ? `calc(${+(.032 - BEARING[line[0]]).toFixed(3)}em - .9px)` : '0em'
