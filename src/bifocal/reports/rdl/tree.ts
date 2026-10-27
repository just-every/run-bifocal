import { fail } from '../../query/types'
import type { RdlNode } from './parse'

export const children = (node: RdlNode | undefined, name: string): RdlNode[] => node ? node.children.filter(item => item.name === name && item.namespace === node.namespace) : []
export function child(node: RdlNode | undefined, name: string): RdlNode | undefined {
 const matches = children(node, name)
 if (matches.length > 1) fail('rdl_duplicate_' + name.toLowerCase(), 422)
 return matches[0]
}
export const text = (node: RdlNode | undefined, name: string): string => child(node, name)?.text.trim() ?? ''
export function descendants(node: RdlNode | undefined, name: string): RdlNode[] {
 if (!node) return []
 const found: RdlNode[] = [], pending = [...node.children].reverse()
 while (pending.length) {
  const next = pending.pop()!
  if (next.namespace !== node.namespace) continue
  if (next.name === name) found.push(next)
  pending.push(...[...next.children].reverse())
 }
 return found
}
