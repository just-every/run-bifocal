import assert from 'node:assert/strict'
import { proveCostControls } from './cost-controls.mjs'
import { proveCompanyBrowser } from './company-browser.mjs'
export async function proveConventions(origin, context, page) {
 await proveCostControls(origin,context)
 const call = async (path, data, method = data === undefined ? 'GET' : 'POST', expected = method === 'POST' && ['/calendars','/rates','/schedules'].includes(path) ? 201 : 200) => {
  const response = await context.request.fetch(origin + '/api/operator' + path, { method, headers: { Origin: origin }, ...(data === undefined ? {} : { data }) })
  assert.equal(response.status(), expected, await response.text()); return response.json()
 }
 assert.equal((await fetch(origin + '/api/operator/company')).status, 401)
 const initial = await call('/company')
 assert.equal(initial.updatedAt, null, 'built-in defaults have no owner-authored update time')
 assert.equal(initial.settings.currency, 'USD'); assert.equal(initial.settings.dateFormat, 'MM/DD/YYYY'); assert.equal(initial.settings.timezone, 'America/New_York')
 const settings = { name: 'Synthetic Bifocal Supply', reportCutoff: '02:00' }
 const saved = await call('/company', { previousRevision: initial.revision, settings }, 'PUT')
 await call('/company', { previousRevision: initial.revision, settings: { name: 'Stale' } }, 'PUT', 409)
 assert.equal((await call('/company')).settings.name, settings.name)
 await call('/viewer-timezone', { previousRevision: null, timezone: 'America/Los_Angeles' }, 'PUT')
 assert.equal((await call('/viewer-timezone')).timezone, 'America/Los_Angeles')
 assert.equal((await call('/company')).settings.timezone, 'America/New_York')
 const july = { name: 'July fiscal', kind: 'fiscal', startMonth: 7 }
 await call('/calendars', { id: 'synthetic-bifocal-july', previousVersion: null, definition: july })
 const leap = await call('/calendars/synthetic-bifocal-july/1/year/2023')
 assert.deepEqual([leap.start, leap.end, leap.days], ['2023-07-01','2024-07-01',366])
 const classification = await call('/calendars/synthetic-bifocal-july/1/date/2024-02-29')
 assert.deepEqual([classification.fiscalYear,classification.period,classification.quarter], [2023,8,3])
 const retail = { name: 'Retail', kind: '445', startMonth: 2, startDay: 1, weekStartsOn: 0, anchor: 'nearest', extraWeekPeriod: 12 }
 await call('/calendars', { id: 'synthetic-bifocal-retail', previousVersion: null, definition: retail })
 const year = await call('/calendars/synthetic-bifocal-retail/1/year/2023')
 assert.deepEqual([year.start,year.end,year.weeks,year.periods[11].days], ['2023-01-29','2024-02-04',53,42])
 await call('/calendars', { id: 'synthetic-bifocal-retail', previousVersion: 1, definition: { ...retail, kind: '454' } })
 const newer = await call('/calendars/synthetic-bifocal-retail/2/year/2023')
 assert.deepEqual(newer.periods.slice(0,3).map(period => period.days), [28,35,28])
 assert.deepEqual((await call('/calendars/synthetic-bifocal-retail/1/year/2023')).periods, year.periods)
 for (const [start,end,expected] of [['2024-02-28','2024-03-02',3],['2026-07-02','2026-07-07',2],['2021-12-30','2022-01-04',2]]) {
  assert.equal((await call('/calendars/synthetic-bifocal-july/1/working-days', { start,end })).workingDays, expected)
 }
 const schedule = { name: 'DST check', localDate: '2026-03-08', time: '02:30', timezone: 'America/New_York', reportCutoff: '02:00', skipped: 'reject', repeated: 'earlier' }
 await call('/time/resolve', schedule, 'POST', 422)
 assert.equal((await call('/time/resolve', { ...schedule, skipped: 'skip' })).resolution.status, 'skipped')
 const shifted = await call('/time/resolve', { ...schedule, skipped: 'shift-forward' })
 assert.equal(shifted.resolution.instants[0].instant, '2026-03-08T07:30:00.000Z')
 const both = await call('/schedules', { id: 'synthetic-bifocal-dst', previousVersion: null, definition: { ...schedule, localDate: '2026-11-01', time: '01:30', repeated: 'both' } })
 const stored = await call('/schedules/synthetic-bifocal-dst/1')
 assert.deepEqual(stored.definition.resolution.instants.map(item => [item.instant,item.offset]), [['2026-11-01T05:30:00.000Z','-04:00'],['2026-11-01T06:30:00.000Z','-05:00']])
 const cutoff = await call('/time/context', { sourceInstant: '2026-07-01T01:30:00-04:00', timezone: 'America/New_York', reportCutoff: '02:00' })
 assert.equal(cutoff.sourceOffset, '-04:00'); assert.equal(cutoff.reportDate, '2026-06-30')
 const rates = { name: 'Owner treasury rates', kind: 'owner-imported', license: 'Owner supplied for authorized internal use', baseCurrency: 'USD', rates: [{ currency: 'EUR',date: '2026-06-19',rate: '0.8' }] }
 await call('/rates', { id: 'synthetic-bifocal-rates', previousVersion: null, definition: rates })
 const conversion = { sourceId: 'synthetic-bifocal-rates', sourceVersion: 1, targetCurrency: 'USD', timezone: 'America/New_York', reportCutoff: '02:00', policy: { date: 'transaction-date',lookup: 'exact' }, rounding: { scale: 2, mode: 'half-even',stage: 'per-line' }, transactions: [{ id:'synthetic-bifocal-1',amount:'100.00',currency:'EUR',date:'2026-06-19' }, { id:'synthetic-bifocal-2',amount:'100.00',currency:'USD',date:'2026-06-19' }] }
 assert.equal((await call('/currency/convert', conversion)).total.amount, '225.00')
 await call('/rates', { id: 'synthetic-bifocal-rates', previousVersion: 1, definition: { ...rates, rates: [{ ...rates.rates[0],rate: '0.9' }] } })
 assert.equal((await call('/currency/convert', conversion)).total.amount, '225.00')
 for (const [amount,mode,expected] of [['9007199254740993.01','half-even','9007199254740993.01'],['1.005','half-even','1.00'],['1.015','half-even','1.02'],['-1.005','half-away-from-zero','-1.01']]) {
  const value = await call('/currency/convert', { ...conversion, rounding: { ...conversion.rounding,mode }, transactions: [{ ...conversion.transactions[1],amount }] })
  assert.equal(value.total.amount, expected)
 }
 const lines = conversion.transactions.map((row,index) => ({ ...row,currency: 'USD',amount: '0.005' }))
 assert.equal((await call('/currency/convert', { ...conversion,transactions: lines })).total.amount, '0.00')
 assert.equal((await call('/currency/convert', { ...conversion,transactions: lines,rounding: { ...conversion.rounding,stage: 'total' } })).total.amount, '0.01')
 assert.ok((await call('/conventions/audit')).entries.some(entry => entry.kind === 'company' && entry.revision === saved.revision))
 await proveCompanyBrowser(origin,page)
 console.log('Native conventions: durable US defaults, fiscal leap/53-week calendars, holidays, DST resolution and exact versioned currency rounding passed')
}
