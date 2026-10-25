# Exact queries on imported files

This is a bounded native owner-only HTTP capability, backed by the real reviewed
CSV/XLSX datasets in `bf_file_tables`. It has no semantic model editor,
certification, report delivery, or unrestricted visual query authoring. Caller-supplied model/metric version
labels are recorded alongside a content hash of the complete definition; they
are not evidence of a certified metric catalog. No connector or sample dataset
is fabricated. The native company conventions and a saved calendar must exist.

All routes require a current native owner session and the app's exact origin.
POST requires a JSON request body and the matching Origin header. Sessions are checked
in each D1 transaction, including revocation, membership version and IdP policy.
Snapshots bind to the immutable operator ID, not just role or email. Another
owner identity cannot retrieve or replay them. URL query parameters and unknown
JSON fields are refused. Requests are limited to 32 KiB.

## Public doors

- `POST /api/operator/queries/run`: run the definition below, persist the exact
  definition, conventions, input data, output and digest atomically; returns 201.
- `GET /api/operator/queries`: latest 50 snapshot IDs/digests/timestamps for the
  current owner identity.
- `GET /api/operator/queries/:queryId`: retrieve the immutable answer/context.
- `POST /api/operator/queries/:queryId/rerun` with `{}`: recalculate from retained
  input bytes and require an exact match with the persisted answer. All scope,
  filter, context or definition overrides return `snapshot_scope_immutable`.
- `POST /api/operator/dashboards` or `/api/operator/reports` with
  `{"queryId":"<returned UUID>","title":"October margin"}`: save a native
  dashboard result/report artifact pointing at that same immutable answer.
- `GET /api/operator/dashboards/:id` or `/api/operator/reports/:id`: retrieve the
  saved artifact plus its identical answer, definition, context and digest.
- `POST /api/operator/reconciliations` with
  `{"leftQueryId":"<UUID>","rightQueryId":"<UUID>"}`: compare definition,
  conventions, source cutoffs, complete answers and per-measure exact totals.
  A changed cutoff or unexplained discrepancy remains unresolved. This is a
  comparison response, not a persisted reconciliation approval or certification.

Every run returns `queryId`, `snapshotId` (the same UUID), `definition`, `context`,
`answer`, `digest`, and `createdAt`. Artifacts also return `id`, `kind`, `title`
and `artifactCreatedAt`. They do not rerun a live query when opened.

## Definition

All decimals, including filter operands, are JSON strings. Dates use the
importer's typed ISO date values. Column references are `base.Column`, a plain
base column name, or `alias.Column` for a joined dimension. The example assumes
an actually imported dataset and existing calendar; these IDs are illustrative,
not seeded records.

```json
{
  "version": 1,
  "dataset": "sales",
  "joins": [],
  "filters": [
    {"column":"Date","op":"gte","value":"2026-10-01"},
    {"column":"Date","op":"lte","value":"2026-10-31"}
  ],
  "groupBy": ["Region"],
  "measures": [
    {"id":"revenue","op":"sum","column":"Revenue","unit":"money","scale":2,"sourceCurrency":"USD"},
    {"id":"customers","op":"count-distinct","column":"Customer","unit":"count","scale":0},
    {"id":"margin","op":"ratio","numerator":"Profit","denominator":"Revenue","unit":"percent","scale":4,"sourceCurrency":"USD"}
  ],
  "context": {
    "modelVersion":"sales-v1",
    "metricVersion":"finance-v1",
    "accountingBasis":"accrual",
    "calendar":{"id":"fiscal","version":1},
    "rounding":"half-even"
  }
}
```

A run captures company settings **revision and full settings JSON**, calendar
**ID/version and full definition**, rate source **ID/version and full definition**
when requested, timezone, currency, basis, rounding, filters, security scope,
query semantics version, model/metric labels and exact definition hash. Every
source includes its actual revision, updated timestamp, bytes hash and retained
full table. The transaction asserts all before-images and current owner
session; a concurrent import/convention change refuses the entire write.
Historical replay uses those original conventions and input bytes after live
imports or settings change, not the changed definitions.

### Numerical semantics

All arithmetic uses reduced BigInt rational numbers. Values return both the
rounded decimal string and its exact numerator/denominator. Supported rounding
is half-even or half-away-from-zero, applied only at final display, at 0–12
places. Negative refunds and partial refunds remain negative, exact amounts.
No amounts pass through binary floating point. Input decimal bounds are 80
integer digits and 24 fraction digits. This is not an arbitrary SQL engine.

`sum` sums non-null values; all-null and empty sums return state `null`, not
zero. `count` without a column counts rows; with a column it excludes nulls.
`count-distinct` excludes nulls and compares numeric decimals by exact numeric
value, so `1.0` and `1` are one numeric value. Counts of empty sets are zero.
`weighted-average` requires a numeric, nonnegative, unitless `weight` and a
`column`; it computes sum(value × weight)/sum(weight). `ratio` computes
sum(numerator)/sum(denominator), and `unit:percent` multiplies that ratio by
100. Numerator and denominator must have matching numeric types. Null pairs
are excluded together. A zero denominator is `unknown`, never zero or infinity.
All subtotal/totals are computed again from the rows **after every filter**;
distinct counts and ratios are never summed from displayed groups.

Every value includes `state`, `value`, `exact`, `unit`, `nulls` and `excluded`.
An optional imported `stateColumn` contains `value`, `unknown`, `suppressed`,
`incomplete` or null (no quality flag). Unknown quality flags are refused.
Flagged rows propagate their state to the containing group and total, with
precedence suppressed > unknown > incomplete; their amounts and even partial
aggregate values are withheld. A null amount is SQL-style missing, distinct
from an explicit quality flag and from exact zero. Quality is never inferred
from source prose. Results expose no underlying row data.

Money requires explicit `sourceCurrency` or an imported `currencyColumn`.
Without conversion each input must match the snapshotted company currency.
Mixed currencies require a real native `context.rateSource:{id,version}` and
`rateDateColumn`. Rates must match each row's date exactly, with no previous-day
or provider fallback. Native rates are target units per one base unit:
`targetAmount = sourceAmount / sourceRate × targetRate`. The base rate is one.
Rates must be positive and unique for the currency/date. Money ratios convert
both numerator and denominator before summing. This prevents mixed-currency
margin weighting errors. Money fields cannot silently become unitless sums.

Filters support `eq`, `ne`, `in`, `gte`, `lte`, `is-null`. Numeric columns compare
exact numbers; other types compare their typed values, with dates in ISO order.
Equality to null is explicit null equality; ordered comparisons exclude nulls.
Group dimensions are typed imported values. There is no implicit fiscal period
bucketing or timezone conversion: use typed date filters. The selected native
calendar/timezone is retained, while richer time-intelligence authoring remains
BIF-006 scope.

### Join grain and source cutoffs

Up to two left dimension joins are supported. Each has `dataset`, unique `as`,
a base-table `left` column, a dimension `right` column name, and
`duplicates:"reject"` or `"identical"`. Keys must have the same declared type;
null keys do not match. Numeric keys compare by exact value. Reject refuses
any duplicate dimension key. Identical removes only full-row identical
repetitions; conflicting dimension rows return `join_fanout_refused`.
Unmatched rows retain base facts with null dimensions. Diagnostics show removed
duplicate and unmatched counts. Many-to-many and chained fact joins are refused;
measure arithmetic may only reference base-grain columns. Joined dimensions can
filter, group, or supply a distinct-count dimension without multiplying facts.

One imported dataset is a single source snapshot. More than one dataset always
reports `commonSnapshot:"unavailable"`, even though the retained local bytes are
transactionally consistent: separate imports do not prove a common upstream
cutoff. Every answer has `certification:"unavailable"`. Reconciliation never
silently blesses differences or enables official certification.

### Retention and withdrawal

`0020_queries.sql` adds `bf_query_snapshots`, `bf_query_sources`, and
`bf_query_artifacts`. Saved definitions, context, answers, sources and artifacts
are immutable (updates are refused). Explicit dataset erasure deletes all dependent snapshots and artifacts in the same retirement transaction using foreign-key cascades, including when no table remains published. Undo changes publication, not retention: historical answers remain owner-held until explicit erasure. Replay uses their retained source bytes and rechecks current native owner identity and session authority. A live replacement or Undo never mutates retained answers. A new owner identity receives 404 for another
owner's historical IDs. Broader replay fields receive 403. No public shares,
security grants, delivery or certification are implemented by these APIs.

## Browser doors

`/app/queries` runs a definition against real imported datasets and saved native calendars/rates. It renders exact grouped values and recomputed totals, exposes source/security/convention context and permits explicit saved tabular dashboard/report results. `/app/queries/<snapshotId>`, `/app/dashboards/<id>` and `/app/reports/<id>` show that same immutable answer; they never silently rerun live data. Reproduce explicitly recalculates retained input bytes. Source erasure withdraws these reads. The browser shares the approved desk app layout with the file workflow; no homepage or global theme is replaced.

The model and metric labels are paired with server-derived content revisions of the exact typed model/grain/join definition and measure definitions. These revisions, the full query and actual native convention versions are frozen together, not caller-supplied version labels alone. Later BIF-006/007/019/032/035 extend authoring, certification and grants on these same query/snapshot doors; current authority inherits BIF-003/057's ruled owner-only floor and never exposes a saved result to a new owner identity.


## Dashboard reader filters and personal bookmarks

Open a retained dashboard's **Open dashboard TV** link. **Filter dimension**
contains only grouped dimensions shared by every tile. Enter an exact equality
value and choose **Apply filter**, or expand **Cross-filter from this tile** and
choose a displayed dimension value. Choices intersect each tile's retained
filters; contradictory choices produce an empty tile, never broader source
access. Up to eight distinct reader dimensions are supported. **Clear filters**
restores the retained definitions. Automatic refresh keeps the active choices.
Changing choices clears last-good values from the previous selection.

**Prepare current exports** retains the exact displayed filtered answer, checked
against its definition fingerprint and source watermarks. Changing sources or
filter context refuses a mismatched export before saving. Summary and underlying
CSV and typed XLSX use that same retained answer.

Expand **Personal bookmarks** to name and save the current filter choices.
Saving an existing name creates a new immutable revision and refuses a stale
concurrent edit. Select a saved bookmark and an exact revision, then choose
**Open bookmark revision**. Historical choices remain available. Each dashboard
supports twenty names and one hundred revisions per name. Reload the page to
inspect a concurrent revision before saving again.

These controls require the current installation owner. Bookmarks never grant
source access, alter publication pointers or silently change a shared default;
a newly opened dashboard starts from its retained definitions. Withdrawing its
source custody withdraws bookmark reads and removes bookmark copies with the
dashboard. Authored published-reader and delegated-viewer interactions remain
unfinished, as do shared bookmarks and the other open BIF-012 interactions.
