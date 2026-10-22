// An instant in the viewer's display zone, the US form the browser tools render (public/bifocal/format.js):
// "Tue Oct 6, 2026, 4:26 pm ET". The exact instant stays in the element's datetime attribute.
export function stamp(value: string | number, zone: string) {
 const date = new Date(value)
 const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(date).map(part => [part.type, part.value]))
 const name = (style: 'shortGeneric' | 'short') => new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: style }).formatToParts(date).find(part => part.type === 'timeZoneName')!.value
 const generic = name('shortGeneric')
 return `${values.weekday} ${values.month} ${values.day}, ${values.year}, ${values.hour}:${values.minute} ${values.dayPeriod.toLowerCase()} ${/^[A-Z]{2,4}$/.test(generic) ? generic : name('short')}`
}
