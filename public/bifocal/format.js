// Display-only US forms. Figures keep every digit the engine returned (grouping and a currency sign round nothing);
// times read in the viewer's display zone (the company's unless the owner chose one), the same form as
// src/app/time.ts renders on the server: "Tue Oct 6, 2026, 4:26 pm ET". Exact strings and instants stay in the context.
const group = digits => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const symbol = currency => new Intl.NumberFormat('en-US', { style: 'currency', currency }).formatToParts(0).find(part => part.type === 'currency').value

/** "net-sales" reads "Net sales"; an acronym such as "SKU" keeps its capitals. */
export function label(id) {
 const text = String(id).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[-_.\s]+/).filter(Boolean).map(word => /^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase()).join(' ')
 return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "66629.02" money in USD reads "$66,629.02"; "29.9863" percent reads "29.9863%". */
export function figure(text, unit, currency) {
 const match = /^(-?)(\d+)(\.\d+)?$/.exec(String(text))
 if (!match) return text
 const [, sign, whole, fraction = ''] = match, digits = group(whole) + fraction
 return unit === 'money' ? sign + symbol(currency) + digits : sign + digits + (unit === 'percent' ? '%' : '')
}

function parts(date, zone) {
 const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(date).map(part => [part.type, part.value]))
 const name = style => new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: style }).formatToParts(date).find(part => part.type === 'timeZoneName').value
 const generic = name('shortGeneric')
 return { ...values, time: `${values.hour}:${values.minute} ${values.dayPeriod.toLowerCase()}`, zone: /^[A-Z]{2,4}$/.test(generic) ? generic : name('short') }
}

/** "Tue Oct 6, 2026, 4:26 pm ET". */
export function stamp(value, zone) {
 const date = new Date(value)
 if (!value || Number.isNaN(date.getTime())) return value
 const p = parts(date, zone)
 return `${p.weekday} ${p.month} ${p.day}, ${p.year}, ${p.time} ${p.zone}`
}

/** A list's short form: "4:18 pm ET" today, "Oct 2, 4:18 pm ET" this year, "Oct 2, 2025, 4:18 pm ET" before. */
export function when(value, zone, now = new Date()) {
 const date = new Date(value)
 if (!value || Number.isNaN(date.getTime())) return value
 const p = parts(date, zone), today = parts(now, zone)
 if (p.year === today.year && p.month === today.month && p.day === today.day) return `${p.time} ${p.zone}`
 return `${p.month} ${p.day}, ${p.year === today.year ? '' : p.year + ', '}${p.time} ${p.zone}`
}
