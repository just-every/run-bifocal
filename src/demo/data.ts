/** Cedar & Finch Demo: entirely fictional, authored retail data for the demo.
 * Names describe invented customers, not actual people. No scraped data is used.
 * All amounts are USD; returned goods are restocked at their original unit cost.
 */
type ColumnType = 'text' | 'money' | 'number' | 'date' | 'boolean'
type Dataset = { id: string; filename: string; key: string; columns: Record<string, ColumnType>; data: string }
type Cell = string | number | boolean
const money = (cents: number) => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`
const date = (month: number, day: number) => `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/2026`
const csv = (rows: Cell[][]) => rows.map(row => row.map(value => {
 const text = String(value)
 return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}).join(',')).join('\r\n') + '\r\n'
function dataset(id: string, key: string, columns: Record<string, ColumnType>, rows: Cell[][]): Dataset {
 return { id, filename: `${id}.csv`, key, columns, data: csv([Object.keys(columns), ...rows]) }
}

const names = [
 'Mara Whitcombe', 'Jonah Bellford', 'Celia Rowan', 'Ellis Hartwell',
 'Nina Ashcroft', 'Theo Larkspur', 'Priya Bellamy', 'Owen Thistledown',
 'Leah Bracken', 'Miles Fenwick', 'Ada Northcott', 'Felix Alderbrook',
 'Sofia Wrenfield', 'Noah Pennwick', 'Iris Cloverton', 'Leo Marlowe',
 'Amara Winslow', 'Hugo Fairbourne', 'Esme Willowby', 'Arlo Beckworth',
 'Talia Stonewell', 'Jasper Fernley', 'Mina Brookhaven', 'Ronan Westcott',
 'Lila Thornbury', 'Silas Meadowcroft', 'Anika Birchwell', 'Finn Rosemere',
 'Clara Oakley', 'Evan Mossbrook', 'Zara Hollingford', 'Luca Fielding',
]
const regions = ['West', 'South', 'Northeast', 'Midwest']
const customers = names.map((name, index) => ({ id: `CF-C${String(index + 1).padStart(3, '0')}`, name, region: regions[index % regions.length] }))
// Prices and costs are authored integer cents. Weight controls relative demand.
const products = [
 { id:'CF-P01', name:'Everyday stoneware mug', category:'Tableware', price:1800, cost:650, weight:15 },
 { id:'CF-P02', name:'Rimmed dinner plate set', category:'Tableware', price:6400, cost:2600, weight:9 },
 { id:'CF-P03', name:'Linen tea towel pair', category:'Kitchen', price:2400, cost:850, weight:13 },
 { id:'CF-P04', name:'Maple serving board', category:'Kitchen', price:4800, cost:1850, weight:10 },
 { id:'CF-P05', name:'Amber glass vase', category:'Decor', price:3600, cost:1250, weight:9 },
 { id:'CF-P06', name:'Cedar soy candle', category:'Decor', price:2800, cost:900, weight:14 },
 { id:'CF-P07', name:'Woven cotton throw', category:'Textiles', price:8900, cost:3700, weight:8 },
 { id:'CF-P08', name:'Botanical cushion cover', category:'Textiles', price:3200, cost:1100, weight:8 },
 { id:'CF-P09', name:'Rattan table lamp', category:'Lighting', price:12900, cost:5700, weight:4 },
 { id:'CF-P10', name:'Brass reading light', category:'Lighting', price:15900, cost:7200, weight:3 },
 { id:'CF-P11', name:'Seagrass storage basket', category:'Storage', price:5400, cost:2100, weight:5 },
 { id:'CF-P12', name:'Oak entryway tray', category:'Storage', price:4200, cost:1500, weight:6 },
]
let randomState = 20260117
const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296 }
const totalWeight = products.reduce((sum, product) => sum + product.weight, 0)
function pickProduct() {
 let ticket = Math.floor(random() * totalWeight)
 for (const product of products) { ticket -= product.weight; if (ticket < 0) return product }
 throw new Error('Demo product weights must cover every ticket')
}

const orders: Cell[][] = [], returns: Cell[][] = []
const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
const monthDays = [31, 28, 31, 30, 31, 30]
const volumes = [32, 38, 47, 51, 61, 71]
const returnReasons = ['Changed mind', 'Damaged in transit', 'Color did not suit room', 'Wrong size', 'Duplicate gift']
let orderNumber = 0
for (let month = 1; month <= months.length; month++) {
 for (let row = 0; row < volumes[month - 1]; row++) {
  const order = `CF-O${String(++orderNumber).padStart(4, '0')}`
  const customer = customers[Math.floor(random() * customers.length)]
  const product = pickProduct(), channel = random() < 0.67 ? 'Online' : 'Store'
  const quantity = random() < 0.72 ? 1 : random() < 0.82 ? 2 : 3
  const day = 1 + Math.floor(row * monthDays[month - 1] / volumes[month - 1])
  // Campaign discounts vary by order and are allocated to each unit exactly.
  const discountPercent = random() < (month >= 5 ? 0.30 : 0.18) ? 10 : 0
  const unitDiscount = Math.round(product.price * discountPercent / 100)
  const gross = product.price * quantity, discount = unitDiscount * quantity
  const returnedQuantity = orderNumber % 13 === 4 ? (quantity > 1 && random() < 0.5 ? 1 : quantity) : 0
  const refunded = (product.price - unitDiscount) * returnedQuantity
  const revenue = gross - discount - refunded
  const profit = revenue - product.cost * (quantity - returnedQuantity)
  orders.push([order, date(month, day), months[month - 1], customer.id, customer.name,
   product.id, product.name, product.category, customer.region, channel, quantity,
   money(gross), money(discount), money(refunded), money(revenue), money(profit)])
  if (returnedQuantity) returns.push([
   `CF-R${String(returns.length + 1).padStart(3, '0')}`, order,
   date(month, Math.min(day + 3 + Math.floor(random() * 5), monthDays[month - 1])),
   months[month - 1], customer.id, product.id, product.name, product.category,
   customer.region, channel, returnedQuantity, money(refunded),
   returnReasons[Math.floor(random() * returnReasons.length)],
  ])
 }
}

export const retailDatasets: Dataset[] = [
 dataset('demo-customers', 'customer', { customer:'text', customer_name:'text', region:'text' },
  customers.map(customer => [customer.id, customer.name, customer.region])),
 dataset('demo-products', 'product', { product:'text', product_name:'text', category:'text', price:'money', cost:'money' },
  products.map(product => [product.id, product.name, product.category, money(product.price), money(product.cost)])),
 dataset('demo-orders', 'order', {
  order:'text', date:'date', month:'text', customer:'text', customer_name:'text',
  product:'text', product_name:'text', category:'text', region:'text', channel:'text',
  quantity:'number', gross:'money', discount:'money', refunded:'money', revenue:'money', profit:'money',
 }, orders),
 dataset('demo-returns', 'return', {
  return:'text', order:'text', date:'date', month:'text', customer:'text', product:'text',
  product_name:'text', category:'text', region:'text', channel:'text', quantity:'number',
  refunded:'money', reason:'text',
 }, returns),
]
