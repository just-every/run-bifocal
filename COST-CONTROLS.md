# Native cost controls

BIF-037 is partial. These HTTP doors are usable without provider credentials.
They do not start jobs, supply production rate cards or establish measured bills.
The installed Settings screen does not yet expose them.

`POST /api/cost-reference` is available before sign-in and installation. It is a
stateless calculator: submitted rates are never stored, sent to a provider or
used to activate a source. The JSON body contains:

- `compute`: `provider`, `size` and `region`, all explicit owner-entered text.
- `rates`: one object for each of `product`, `control`, `compute`, `scan`,
  `storage`, `refresh`, `delivery`, `agents` and `portal`. Each object contains
  integer `microUsdPerUnit`, an ISO `rateDate` and a `reference` identifying the
  owner-entered rate, provider assumptions and any rate-card link.
- Optional `quantities`: integer overrides for the same line identifiers.
- Optional `sourceLicencesMicroUsd`: monthly source licences for a separate full
  comparison. Source licences and tax are excluded from the core total.

The response gives the complete named reference estate, quantities and units,
rate dates and references, each line and the monthly total in USD and integer
microdollars. Arithmetic uses integers, including totals too large for ordinary
floating-point precision. Every quantity is explicitly assumed, never measured.
The default uses 730 compute hours, 100 GB storage, 30 GB ingested, 6000 GB scanned,
240000 control requests, 800 recipient bursts, 100 external-model and agent
infrastructure runs and one portal month. The response explains the month and
scan assumptions. A product fee is monthly, without prompt or token metering;
external-model infrastructure charges remain a separate line. Missing rates do
not silently become zero. Enter all rates, including an explicit zero when
appropriate. No supplied quote guarantees a bill or proves capacity.

The following doors require a current native owner session and the app origin
on mutations. Foundation administrators, members and service credentials gain
no authority. Authority is checked again inside every database batch.

`PUT /api/operator/costs/budgets` accepts `scope` (`source`, `job`, `agent` or
`tenant`), `id`, `previousRevision` (null for creation), `limitMicroUsd` and
`warnMicroUsd`. Limits are cumulative for that record, with no automatic monthly
reset. Exact revisions prevent lost owner changes; lowering below committed
usage prevents further reservations without rewriting previous usage.

`POST /api/operator/costs/reservations` accepts `scope`, `budgetId`,
`reviewedBudgetRevision` and `estimatedMicroUsd`. It atomically reserves against
settled actuals plus outstanding estimates, or returns a held state and recovery
instructions. A reservation warns once committed usage reaches the warning
threshold. A stale approval or competing reservation cannot overbook the ledger.
The reservation itself starts no work and is not an execution capability.

`PUT /api/operator/costs/reservations/:id` accepts `state: "settled"` plus integer
`actualMicroUsd`, or `state: "released"` without an actual. Settlement is allowed
once. Actual overages remain visible and hold later reservations until the owner
raises the limit or releases other reservations. These actuals are owner-reported,
not provider-verified. Interrupted work keeps its reservation until explicit
resolution; no timeout silently forgets uncertain spend.

`GET /api/operator/costs/budgets` shows attribution and committed amounts.
`GET /api/operator/costs/reservations?scope=source&budgetId=example` shows up to
100 entries for one budget; larger lists refuse rather than silently truncate.
Changes leave an owner audit. Provider invoice reconciliation, actual execution
integration, automatic warnings and pause controls, complete portal capacity,
installation costs, and Settings authoring remain unfinished. Base analytical
jobs under BIF-058 are required for execution-backed completion.
