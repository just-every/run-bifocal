# Native US conventions

The owner browser tools at `/app/company` and native APIs provide company settings, fiscal calendars,
working-day calculations, civil-time resolution and exact currency conversions.
Saved USD reports over dated currency conversions use the exact-answer doors. Schedule execution, licensed map boundaries, non-owner viewer access and complete workflow accessibility qualification remain unfinished. BIF-036 remains partial.

Mount `conventionsResponse(request, bindings)` from
`src/bifocal/company/server.ts` before the application router and apply
`migrations/core/0019_company.sql`. No new dependencies or provider calls are
required. Unknown unrelated paths return `null` to the caller.

All listed doors require the native current owner session. Request origin, Host
and fetch-site checks reuse `fileOwner`. A write must send the exact application
`Origin` and `Content-Type: application/json`. Every database read and mutation
rechecks session expiry/revocation, current operator role/version and linked
identity-provider policy within the same atomic D1 batch. Unauthorized requests
return 401, invalid semantics 422, oversized bodies 413, missing versions 404,
and concurrent revisions or a failing database guard 409. Bodies are capped at
256 KiB; rate batches and conversion batches at 1,000 records. Responses are
private and non-cacheable. No incoming amount or secret enters error diagnostics.

Every mutation creates an actor-attributed audit entry. The audit door returns
metadata, not definitions or financial values. Definitions and their actor email
are retained natively and included in the installer archive inventory. Full product restore/erasure and retention qualification remains BIF-033/BIF-034 work.

## Company and display timezone

`GET /api/operator/company` returns `{revision,settings,updatedAt,updatedBy}`.
The migration creates durable defaults before product setup:

```json
{"name":"","currency":"USD","dateFormat":"MM/DD/YYYY","timezone":"America/New_York","reportCutoff":"00:00"}
```

An empty name means company setup is unfinished. Save with
`PUT /api/operator/company`:

```json
{"previousRevision":"company-defaults-v1","settings":{"name":"synthetic-bifocal-1"}}
```

An omitted setting takes its US default. A save is a complete replacement, not a
patch; include other settings you intend to retain. The response returns the new
revision. A stale revision cannot overwrite another save. Currency is a current
ISO currency supported by the runtime; the current date display format is
`MM/DD/YYYY`. Civil input/output and rate dates use unambiguous ISO dates.

`GET /api/operator/viewer-timezone` returns `{revision,timezone,inherited}` for
the signed-in owner. Without a personal preference it inherits company timezone.
`PUT /api/operator/viewer-timezone` takes
`{previousRevision:null,timezone:"America/Chicago"}` for a first preference or
the returned revision for an update. It never changes the organization schedule
zone. Non-owner viewers are not admitted by this backend yet.

## Versioned calendars

`GET /api/operator/calendars` lists metadata for the latest version of each
named calendar. `GET /api/operator/calendars/:id` lists version metadata for that
calendar; `GET /api/operator/calendars/:id/:version` returns its full definition.
These lists cap at 1,000 entries and refuse overflow; an exact id/version remains
readable. IDs begin with a lowercase letter and contain at most 64 lowercase
letters, digits or hyphens. New versions use
`POST /api/operator/calendars`:

```json
{"id":"july","previousVersion":null,"definition":{"name":"July fiscal","kind":"fiscal","startMonth":7,"startDay":1}}
```

`previousVersion:null` means creation. To append, supply the latest positive
integer version. The database asserts that previous version before insertion.
Existing definitions cannot be updated; all calculations name an exact version.
Fiscal years are labeled by their **starting year**. Boundaries are half-open
`[start,end)`. Start months range from 1 through 12. Start days range through the
last valid day in that month in a leap year. A February 29 start clamps to
February 28 in a non-leap year; month-end period boundaries also clamp.

Retail calendars use `kind:"445"` or `kind:"454"`. Add `weekStartsOn` (Sunday=0
through Saturday=6), `anchor` (`on-or-before`, `nearest`, or `on-or-after`) and
`extraWeekPeriod` (1 through 12). Defaults are Sunday, on-or-before and period 12.
The annual start is that weekday relative to the supplied month/day. Consecutive
annual starts determine 52 or 53 whole weeks. In a 53-week year the named period
gets the extra week; it is never silently dropped or forced into a Gregorian year.
Fiscal `kind:"fiscal"` uses calendar months instead of week patterns.

The [National Retail Federation calendar explanation](https://cdn.nrf.com/resources/4-5-4-calendar)
describes the retail week patterns and 53-week adjustment. These APIs implement
the owner-selected anchor and extra period explicitly; they do not automatically
restate prior-year sales for NRF comparison.

* `GET /api/operator/calendars/:id/:version/year/:year` returns start/end, day and
  week counts, and all 12 periods with quarter and boundaries.
* `GET /api/operator/calendars/:id/:version/date/:YYYY-MM-DD` classifies a date
  into its fiscal year, quarter, period and retail week.
* `POST /api/operator/calendars/:id/:version/working-days` with `{start,end}`
  returns the working-day count plus a dated explanation for every day.

Supported civil dates are 1971 through 9998; fiscal start-year calculation is
1972 through 9997 so neighboring boundaries stay representable. Working-day
ranges are half-open and at most 3,660 days. Monday through Friday are working
days, excluding observed nationwide statutory US federal holidays under
`us-federal-1971-v1`. Saturday fixed holidays observe Friday; Sunday fixed
holidays observe Monday. The next year's New Year's Day observation is included
when it falls on December 31. MLK starts in 1986, Juneteenth in 2021, and the
1971–1977 October Veterans Day rule is represented. Fixed holiday rules are
projected forward; this is a versioned calendar rule, not a claim to know future
legislation.

The holiday source is the [OPM federal holiday schedule](https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/)
and [5 USC 6103](https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title5-section6103&num=0&edition=prelim).
Local inauguration holidays, exceptional executive closures and other company
closures are explicit `closed:["YYYY-MM-DD"]` additions in a calendar version.
`open:["YYYY-MM-DD"]` explicitly makes a date working, including a weekend or
holiday. A date cannot appear in both lists. This is a business working-day
measure, not federal employment pay/leave adjudication.

## Instants, cutoff and DST

`POST /api/operator/time/context` takes:

```json
{"sourceInstant":"2026-07-01T01:30:00-04:00","timezone":"America/New_York","reportCutoff":"02:00"}
```

The output retains original timestamp bytes and original offset, a normalized
UTC instant, the IANA display zone, its offset at that instant, the local date
and time, and report cutoff/date. A local time earlier than the cutoff belongs
to the previous report date. At the cutoff it belongs to the current date.
Instants require an explicit offset or `Z`, seconds, and at most millisecond
precision. Impossible dates/times are rejected. No implicit browser timezone,
wall-clock truncation or binary timestamp-to-money conversion is used.

`POST /api/operator/time/resolve` previews a one-time schedule definition:

```json
{"name":"Close","localDate":"2026-03-08","time":"02:30","timezone":"America/New_York","skipped":"shift-forward","repeated":"earlier","reportCutoff":"00:00"}
```

Both DST policies are mandatory **before saving**, including on ordinary dates.
A nonexistent local time uses `skipped:"reject"` (422), `"skip"` (zero instants),
or `"shift-forward"` (preserve the minutes while adding the actual gap size).
A repeated local time uses `repeated:"reject"` (422 with both candidates),
`"earlier"`, `"later"` or `"both"` (two distinct instants). Resolution roundtrips
possible offsets through the runtime's IANA timezone data. Each resolved instant
carries its zone, effective offset and cutoff. The preview preserves the requested
civil date/time and names any shift. Existing saved resolution instants are
retained rather than recomputed silently after a timezone database upgrade.

The zone-rule source is the runtime's [IANA Time Zone Database](https://www.iana.org/time-zones),
whose historical and future rules can change between runtime releases. The
[TC39 civil-time ambiguity documentation](https://tc39.es/proposal-temporal/docs/timezone.html)
explains gaps, repeated times and earlier/later/reject disambiguation. This
backend implements the above explicit policies using `Intl`; it does not depend
on a Temporal implementation or silently choose Temporal's default.

`POST /api/operator/schedules` uses `{id,previousVersion,definition}` with that
same definition and appends an immutable version containing the resolution.
`GET /api/operator/schedules`, `/:id`, and `/:id/:version` provide the same
metadata/version/full-definition pattern as calendars. These are **one-time
schedule definitions and calculations**. `dispatcher:"unavailable"` explicitly
means no job is queued and no execution or delivery is claimed.

## Named owner-imported exchange rates

`POST /api/operator/rates` imports a new immutable named rate-source version:

```json
{"id":"owner-rates","previousVersion":null,"definition":{"name":"Owner treasury rates","kind":"owner-imported","license":"Owner supplied; authorized internal use","baseCurrency":"USD","rates":[{"currency":"EUR","date":"2026-06-19","rate":"0.8"}]}}
```

A rate means **units of that currency per one unit of base currency**. Base
currency is implicitly 1. Rates must be positive exact decimal strings and
unique per currency/date. The owner declares their authorization in `license`;
this does not verify a third-party licence or imply a provider agreement.
There is no provider feed, guessed rate, hidden live lookup or fallback rate.
`GET /api/operator/rates`, `/:id`, and `/:id/:version` expose source metadata,
versions and full definitions. Appending version 2 never changes version 1.

`POST /api/operator/currency/convert` computes a receipt:

```json
{"sourceId":"owner-rates","sourceVersion":1,"targetCurrency":"USD","timezone":"America/New_York","reportCutoff":"00:00","policy":{"date":"transaction-date","lookup":"exact"},"rounding":{"scale":2,"mode":"half-even","stage":"per-line"},"transactions":[{"id":"synthetic-bifocal-1","amount":"100.00","currency":"EUR","date":"2026-06-19"},{"id":"synthetic-bifocal-2","amount":"100.00","currency":"USD","date":"2026-06-19"}]}
```

The total is USD 225.00: EUR 100 / 0.8 = USD 125 plus USD 100. Both original
amount strings, original currencies, transaction dates and any `sourceInstant`
are retained per row. Source instants are displayed with the requested zone,
offset and cutoff. Date-only source records remain explicitly date-only.
Original totals remain grouped by currency; no mixed original-currency total is
produced. The receipt includes the exact source id/version, source name and
licence, chosen rate rows/dates, exact rational conversion factors, each exact
converted value, rounding rules and the company-settings revision/snapshot.
The requested conversion display zone and cutoff are explicit and may differ
from the company defaults.

`policy.date` is `transaction-date` or `fixed`; `fixed` requires `fixedDate`.
`lookup:"exact"` requires the exact date. `lookup:"latest-on-or-before"` requires
an explicit `maxAgeDays` (0–3660); each currency quote is dated and checked for
age independently. Missing, stale or future-only rates refuse the calculation.
Same-currency conversion is explicitly identity and requires no fabricated rate.
Cross-rates divide target/base by original/base exactly.

All input amounts/rates are decimal **strings**, at most 80 integer digits and
24 fractional digits. BigInt reduced rational arithmetic preserves precision,
including beyond JavaScript's safe integer range. No exponent notation or numeric
JSON amounts are accepted. Rounding requires scale (0–8), mode (`half-even`,
`half-away-from-zero`, `toward-zero`) and stage (`per-line`, `total`). Per-line
sums the rounded converted lines. Total sums exact converted values first and
rounds once. Each line always shows an explicitly rounded display value and its
exact rational value; a total-stage total may differ from summed display values.
Rounding is symmetric for negatives and never emits negative zero.

`GET /api/operator/conventions` describes this bounded capability state.
`GET /api/operator/conventions/audit` pages the latest 100 audit metadata entries;
follow its `next.before` and `next.id` as query parameters for the next page.

## Browser convention tools

`/app/company` saves the named company with its native revision, creates immutable fiscal/retail calendar versions, shows period boundaries and working-day reasons, imports a named authorized rate source and displays original alongside exact converted USD amounts. The same approved app frame and accessible table controls are reused. These tools do not run schedules or supply licensed map geography. [Nielsen DMA regions](https://www.nielsen.com/dma-regions/) require appropriate licensed boundary data; no authorized redistributable DMA bundle is held in this seed.
