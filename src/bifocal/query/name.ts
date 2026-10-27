// An answer is named as its row in the Answers list reads: the dataset, then its measures ("Demo orders · Revenue,
// Orders"). The words follow public/bifocal/format.js label(), so a page and the list never name one answer twice.
export function label(id: string) {
 const text = id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[-_.\s]+/).filter(Boolean).map(word => /^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase()).join(' ')
 return text.charAt(0).toUpperCase() + text.slice(1)
}
export const answerName = (definition: { dataset: string; measures: { id: string }[] }) =>
 [label(definition.dataset), ...(definition.measures.length ? [definition.measures.map(measure => label(measure.id)).join(', ')] : [])].join(' · ')
