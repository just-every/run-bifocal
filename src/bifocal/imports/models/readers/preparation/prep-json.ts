type Span = { start: number; end: number }

/** JSON has already been validated by JSON.parse. Record original byte ranges
 * so source expressions keep whitespace, escaping and number spelling. */
export function prepExpressions(text: string): Map<string, string> {
 const spans = new Map<string, Span>()
 let at = 0
 const space = () => { while (/\s/.test(text[at] ?? '') && at < text.length) at++ }
 const string = () => {
  const start = at++
  while (at < text.length) {
   if (text[at++] === '\\') at++
   else if (text[at - 1] === '"') break
  }
  return JSON.parse(text.slice(start, at)) as string
 }
 const value = (path: string, depth = 0): void => {
  if(depth>64||spans.size>20000)throw Error('Preparation JSON nesting or item count exceeds the reader bounds.')
  space()
  const start = at
  if (text[at] === '{') {
   at++; space()
   while (text[at] !== '}') {
    const key = string(); space(); at++
    value(`${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`,depth+1)
    space()
    if (text[at] !== ',') break
    at++; space()
   }
   at++
  } else if (text[at] === '[') {
   at++; space()
   let index = 0
   while (text[at] !== ']') {
    value(`${path}/${index++}`,depth+1); space()
    if (text[at] !== ',') break
    at++
   }
   at++
  } else if (text[at] === '"') string()
  else while (at < text.length && !/[\s,\]}]/.test(text[at])) at++
  if(spans.has(path))throw Error('Duplicate preparation JSON property.')
  spans.set(path, { start, end: at })
 }
 value('')
 return new Map([...spans].map(([path, span]) => [path, text.slice(span.start, span.end)]))
}

export function prepObject(value: unknown): Record<string, unknown> | undefined {
 return value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined
}

/** Configuration stays inert; credentials never become metadata. */
export function prepMetadata(value: unknown): unknown {
 if (Array.isArray(value)) return value.map(prepMetadata)
 const object = prepObject(value)
 if (object) return Object.fromEntries(Object.entries(object)
  .filter(([key]) => !/password|secret|token|credential|authorization|connectionAttributes/i.test(key))
  .map(([key, child]) => [key, prepMetadata(child)]))
 if (typeof value === 'string' && /(?:https?:\/\/|[?&](?:key|sig|token)=)/i.test(value)) return '[inactive reference]'
 return value
}
