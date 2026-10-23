# Analytical handoffs

Use **Files** (`/app/import`) for source setup and the shared review, exact
approval, reconciliation, history, original download, Undo and erasure flow.
Reads are available only to the current installation owner. They do not grant
access to another account or create recurring sync. All imported values remain
inert. Current file limits remain 512 KiB, 2,000 rows and 64 columns; larger
analytical execution and the complete BI workflows remain separate work.

## Vane conversions

Vane owns website instrumentation and collection. Bifocal adds no tracking
script or collector. Install and configure [Vane](https://github.com/just-every/run-vane)
independently. Set the nonsecret `BIFOCAL_VANE_ORIGIN` Worker binding to that
installation's public HTTPS origin, without path, port, query or credentials.
For local use set it in `wrangler.jsonc`'s `vars`; for an owner deployment set it
in `deploy.json`'s `vars` and deploy through the normal owner path. Never put a
Stats key in either file. The configured origin is the exact credential
destination; API callers cannot supply another host, and redirects are refused.

In **Read Vane campaign conversions**, supply a site-scoped read-only Stats
key and explicit site-local `[from,to)` dates. One GET reads
`/api/v1/stats?site_id=…&dimension=utm_campaign&metrics=visitors,visits&imported=on`.
Campaign rows retain visitors, visits, conversion visits, conversion rate,
attributed revenue and currency. Conversions count visits with a goal; their
conversion rate uses visits. Attributed revenue is not ledger revenue and is
never added to it automatically. The source link opens the independent Vane
campaign report with its date window. The key is supplied for that read only,
never persisted, echoed, included in an original or forwarded to another host.

Alternatively download the **UTM campaigns** CSV from Vane's report. Its native
route is `/api/vane/csv?siteId=…&table=utmCampaigns&from=…&to=…`; it requires
your Vane session. Upload those original bytes in Files, choose **Vane conversion
export** under **Source links for this file**, and state the report link, date
window and reporting timezone. Bifocal checks the conversion-report headers.
File provenance is owner-declared, not independent certification. API date
windows are checked against Vane's response; file and product-table coverage
windows describe the source supplied by the owner and are not implicit filters.

The implemented network schema is pinned to run-vane
`8549e6e129e1725d8e85d8d25ca3814831f204da`:
[Stats v1](https://github.com/just-every/run-vane/blob/8549e6e129e1725d8e85d8d25ca3814831f204da/src/vane/stats-api.ts),
[conversion rows](https://github.com/just-every/run-vane/blob/8549e6e129e1725d8e85d8d25ca3814831f204da/src/vane/visits.ts),
[CSV](https://github.com/just-every/run-vane/blob/8549e6e129e1725d8e85d8d25ca3814831f204da/src/vane/csv.ts).
Stats has no cursor or pagination; Bifocal does not invent either.

## Product business usage

**Read a permitted product usage table** reads selected scalar fields from an
existing US BigQuery table. The buyer obtains a narrowly scoped token with
`bigquery.tables.get` and `bigquery.tables.getData` for that table. Bifocal calls
[tables.get](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/tables/get)
and [tabledata.list](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/tabledata/list)
on `bigquery.googleapis.com`, with `selectedFields` and a 2,001-row overflow
probe. It requires the full result, refusing a page token, overflow, unsupported
nested/repeated fields or an empty source instead of publishing a partial table.
Only selected scalar fields enter custody; integer and decimal strings retain
their exact values. No query job, SQL, source mutation or telemetry ingestion
service is introduced. Porthole continues to own engineering telemetry.

## Cross-system dashboard and report

Import revenue, Vane conversions and permitted product usage. Run exact queries
with the real dataset/column names and a saved native calendar in **Exact
answers**. Choose two to four retained answers under **Combine saved answers**,
then save and open the cross-system dashboard. Each card has its own chart,
complete exact table, immutable definition, source revision, observation time,
coverage window and source link. Independent sources are displayed together;
they do not become a common upstream snapshot, certified join or attribution
rule. A report can retain those same answer versions. Erasing any participating
source withdraws the complete dashboard/report and blocks unsent exports.

## Buyer warehouse export

Provision a US BigQuery table in the buyer's own account. The destination uses
these **STRING** columns, all nullable or required:

```text
artifact_id, snapshot_id, snapshot_digest, metric, dimensions_json,
value, numerator, denominator, unit, state, source_json, observed_at
```

Strings preserve exact decimals and rational components without the destination
rounding a NUMERIC column. Each row represents one metric in one result group;
source revisions, links, definitions and timestamps remain in `source_json`.
The payload is bounded to 2,000 metric rows and 1 MiB, without silent truncation.
Native reporting does not require this optional warehouse.

From the saved dashboard/report, preview the destination and every exact row.
Preview is local and makes no provider request. Review the fingerprint and
explicitly approve one attempt with a current destination write token. Bifocal
checks the existing US table's exact STRING schema and current native owner and
retained source custody, then sends one
[tabledata.insertAll](https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/tabledata/insertAll)
request (`skipInvalidRows=false`, `ignoreUnknownValues=false`, no table template
or automatic creation). The token is ephemeral. The destination table needs
`bigquery.tables.get`/`updateData` and dataset access, as documented in Google's
[streaming prerequisites](https://docs.cloud.google.com/bigquery/docs/write-api-rest).

Only a valid provider acknowledgement with no row errors is **acknowledged**.
Row errors are **partial**; network, schema or indeterminate outcomes are
**unknown**. A crashed **sending** attempt is in flight or unknown. Receipts
retain only destination identifiers, fingerprint, counts, owner and times, not
result bytes or tokens. There is no automatic retry, including after restart;
`insertId` deduplication is best effort. The same attempt cannot be sent twice.
Inspect the buyer destination before explicitly authorizing any new attempt.
Erasure withdraws Bifocal's retained data; it does not delete copies already
accepted into the buyer's independent warehouse.

These handoffs use the existing owner-only, exact-reviewed and no-automatic-
outbound floor. General analytics roles, standing delivery, expiry, arbitrary
warehouse adapters and large background execution retain their obligations in
BIF-001/004/019/034/035/052/057/058. Separate warehouse, lakehouse, ELT, CDP and
product-analytics setup links are available in the actual source and result
screens; these services are not sold as Bifocal features.

## Qualification

`tests/runtime.mjs` invokes
`tests/journeys/analytics-boundaries.mjs` — `proveAnalyticsBoundaries`, using
the real built Worker, native sessions, migrated D1 and browser assets at 1440
and 390. Only the Vane Stats v1 and BigQuery REST v2 HTTPS edges are faked in
`tests/journeys/analytics-edge.mjs`, from the cited schemas. Its selected fields
are campaign, active accounts and date; grants are synthetic and read/write
destinations are distinct. The expected/observed campaign conversions are
128/72, product accounts 184/96, and net ledger revenue USD 42,350.15/18,925.50.
The warehouse acknowledges the exact eight grouped metric rows. Revocation,
redirect, partial-table, uncertain/partial-write, consent replay and source
erasure probes retain the stated limitations. This is official-schema network
edge qualification, not a claim of live Vane/Google account qualification.
