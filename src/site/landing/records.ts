// Every figure the homepage prints, in one place, so the hero and the screens read the same records (desk page round
// 2, page-s1/STRUCTURE.md "Records"). Each screen asks one Monday question of a different example US company; dates
// are 2026, times Eastern. Names beyond the page copy stay off the page.
export const records = {
  // 01 and 02: Tidewell Software's active customers, HubSpot against the board deck built from Stripe.
  customers: { here: '1,907', there: '1,842', between: '65', breakdown: { trials: 41, cancelled: 18, test: 6 } },
  // 03: Granite Supply's certified gross margin, August to September, on a broken 37% axis.
  margin: { aug: 41.2, freight: 1.8, discounts: 0.5, sep: 38.9, axisFrom: 37 },
  // 04: Granite West's September invoices behind the chart, three clicks away.
  rows: { shown: '212', total: '212', amount: '$318,450.00' },
  // 05: Fernway Outfitters' QuickBooks refresh, kept stamped and then current again.
  refresh: { stale: { day: 'Fri Oct 16', time: '2:00 am' }, current: { day: 'Sat Oct 17', time: '9:27 am' } },
  // 06: Fernway's weekly review, drafted by the report agent and sent by the COO.
  review: { day: 'Mon Oct 19', netSales: 612_400, priorNetSales: 577_200, outerwear: 29_800, jackets: 200, jacketPrice: 149 },
  // 07: Granite's Power BI workspace, every tile compared before the switch.
  tiles: { matched: '186', total: '186' },
} as const

const count = (text: string) => Number(text.replaceAll(',', ''))
const money = (value: number) => `$${value.toLocaleString('en-US')}`
const { customers, margin, review } = records

// The figures add up: the 65 sit between the two counts and are the listed records; the waterfall's steps land on
// September; the week's gain, its percentage and the jackets reconcile; the weekdays are 2026's.
const problems = [
  count(customers.here) - count(customers.there) !== count(customers.between) && 'the active customers do not differ by the 65',
  Object.values(customers.breakdown).reduce((sum, n) => sum + n, 0) !== count(customers.between) && 'the 65 are not the listed accounts',
  Math.round((margin.aug - margin.freight - margin.discounts) * 10) !== Math.round(margin.sep * 10) && 'the margin waterfall does not land on September',
  (review.netSales - review.priorNetSales) / review.priorNetSales * 100 < 6.05 && 'net sales are not up 6.1%',
  (review.netSales - review.priorNetSales) / review.priorNetSales * 100 >= 6.15 && 'net sales are not up 6.1%',
  review.jackets * review.jacketPrice !== review.outerwear && 'the jackets do not make the outerwear gain',
  review.outerwear > review.netSales - review.priorNetSales && 'outerwear is more than the whole gain',
  ...([['Fri Oct 16', 16], ['Sat Oct 17', 17], ['Mon Oct 19', 19]] as const).map(([day, date]) =>
    new Date(Date.UTC(2026, 9, date)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', '') !== day && `${day} is not a 2026 date`),
].filter(Boolean)
if (problems.length) throw new Error(`The homepage records do not reconcile: ${problems.join('; ')}.`)

/** The weekly review's three cited lines, from the record. */
export const reviewLines = [
  `Net sales ${money(review.netSales)}, up ${((review.netSales - review.priorNetSales) / review.priorNetSales * 100).toFixed(1)}%`,
  `Outerwear, ${money(review.outerwear)} of the gain`,
  `${review.jackets} more jackets, same price`,
]
