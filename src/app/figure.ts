// A figure as public/bifocal/format.js figure() writes it in the browser: "66629.02" money in USD reads "$66,629.02",
// "29.9863" percent reads "29.9863%". Grouping and a currency sign round nothing; the exact string stays in the context.
const symbol = (currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).formatToParts(0).find(part => part.type === 'currency')!.value

export function figure(text: string, unit: string, currency: string) {
 const match = /^(-?)(\d+)(\.\d+)?$/.exec(text)
 if (!match) return text
 const [, sign, whole, fraction = ''] = match, digits = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + fraction
 return unit === 'money' ? sign + symbol(currency) + digits : sign + digits + (unit === 'percent' ? '%' : '')
}
