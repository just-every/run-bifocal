// Kaushan Script's left side bearing for the letters a brush line starts with, less the reach of its stroke
// (.014 em), so a line's ink starts on the margin instead of inside it.
const BEARING: Record<string, number> = { A: .047, B: .121, C: .128, D: .142, G: .127, P: .116, R: .115, S: .087, W: .205, i: .084, l: .082, m: .072, s: .006 }

/** The left offset that puts a brush line's first letter on the margin. */
export const brushIndent = (line: string) => `${-(BEARING[line[0]] ?? 0)}em`
