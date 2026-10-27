import type { Element } from '@xmldom/xmldom'

const children = (element: Element, name: string) => Array.from(element.childNodes)
 .filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === name && (node as Element).namespaceURI === element.namespaceURI)
const unique = (elements: Element[]) => {
 const groups = new Map<string, Element[]>()
 for (const element of elements) {
  const name = element.getAttribute('Name') ?? ''
  groups.set(name, [...groups.get(name) ?? [], element])
 }
 return new Map([...groups].filter(([name, items]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && items.length === 1).map(([name, items]) => [name, items[0]]))
}

// A field belongs to its source dataset. Never flatten identically named
// fields from different datasets into a single translation namespace.
export function reportScopes(root: Element) {
 const datasets = unique(children(root, 'DataSets').flatMap(node => children(node, 'DataSet')))
 const parameters = unique(children(root, 'ReportParameters').flatMap(node => children(node, 'ReportParameter')))
 const fields = (dataset: string) => {
  const definition = datasets.get(dataset)
  return definition ? Object.fromEntries([...unique(children(definition, 'Fields').flatMap(node => children(node, 'Field')))].map(([name]) => [name, name])) : {}
 }
 function expressionScope(element: Element): { dataset?: string; fields: Record<string, string> } {
  for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentNode?.nodeType === 1 ? ancestor.parentNode as Element : null) {
   if (ancestor.namespaceURI !== root.namespaceURI) continue
   if (ancestor.localName === 'DataSet') {
    const dataset = ancestor.getAttribute('Name') ?? ''
    return { dataset, fields: fields(dataset) }
   }
   const names = children(ancestor, 'DataSetName')
   if (names.length) {
    const dataset = names.length === 1 ? (names[0].textContent ?? '').trim() : ''
    return { dataset, fields: fields(dataset) }
   }
  }
  // An unbound data region can inherit the sole report dataset. Ambiguous
  // multi-dataset references stay unresolved until an explicit scope exists.
  if (datasets.size === 1) {
   const dataset = datasets.keys().next().value!
   return { dataset, fields: fields(dataset) }
  }
  return { fields: {} }
 }
 return { datasets, parameters, fields, expressionScope }
}
