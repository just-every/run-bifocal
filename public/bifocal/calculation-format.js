/** A readable rendering of the exact native tree; the full typed tree remains
 * available in the reviewed report. No expression is evaluated in the browser. */
export function expressionText(e) {
 if (!e) return 'Unresolved'
 if (e.kind === 'literal') return e.type === 'null' ? 'NULL' : e.type === 'number' ? String(e.value) : JSON.stringify(e.value)
 if (e.kind === 'field') return '[' + e.field + ']'
 if (e.kind === 'parameter') return 'PARAMETER(' + e.name + ')'
 if (e.kind === 'selected-measure') return 'SELECTEDMEASURE()'
 if (e.kind === 'unary') return e.op.toUpperCase() + '(' + expressionText(e.expression) + ')'
 if (e.kind === 'binary') return '(' + expressionText(e.left) + ' ' + e.op.toUpperCase() + ' ' + expressionText(e.right) + ')'
 if (e.kind === 'call') return e.fn.toUpperCase() + '(' + e.args.map(expressionText).join(', ') + ')'
 if (e.kind === 'aggregate') return e.op.toUpperCase() + '(' + (e.expression ? expressionText(e.expression) : '*') + ')'
 if (e.kind === 'calculate') return 'CALCULATE(' + expressionText(e.expression) + '; remove user filters ' + JSON.stringify(e.removeFilters) + '; apply ' + JSON.stringify(e.filters) + ')'
 if (e.kind === 'fixed') return 'FIXED ' + JSON.stringify(e.grain) + ' (' + expressionText(e.expression) + '; ' + e.filters + '; total ' + (e.totals ?? 'recompute') + ')'
 if (e.kind === 'percent-of-total') return 'PERCENT OF TOTAL(' + expressionText(e.expression) + '; partition ' + JSON.stringify(e.partitionBy) + ')'
 return e.op.toUpperCase() + '(' + expressionText(e.expression) + '; partition ' + JSON.stringify(e.partitionBy) + '; order ' + JSON.stringify(e.orderBy) + '; preceding ' + e.preceding + '; following ' + e.following + '; offset ' + e.offset + ')'
}
export function exactText(value) {
 if (value.type === 'null') return 'NULL' + (value.reason ? ' (' + value.reason.replaceAll('_', ' ') + ')' : '')
 if (value.type !== 'number') return String(value.value)
 const numerator=BigInt(value.numerator),denominator=BigInt(value.denominator)
 let rest=denominator,twos=0,fives=0
 while(rest%2n===0n){rest/=2n;twos++}
 while(rest%5n===0n){rest/=5n;fives++}
 const scale=Math.max(twos,fives)
 if(rest!==1n||scale>24)return value.numerator+' ÷ '+value.denominator
 if(!scale)return value.numerator
 const absolute=numerator<0n?-numerator:numerator,digits=(absolute*(10n**BigInt(scale))/denominator).toString().padStart(scale+1,'0')
 return (numerator<0n?'-':'')+digits.slice(0,-scale)+'.'+digits.slice(-scale)
}
