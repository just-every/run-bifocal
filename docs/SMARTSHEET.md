# Smartsheet snapshot reads

Open **Files** at `/app/import`, enter the target dataset ID, then open
**Read a Smartsheet snapshot**. This bounded read is available to the current
native installation owner. It does not create a connection, refresh schedule,
provider write, foreign-account grant or analytical job.

Use an authorized Smartsheet Business or Enterprise account and a token with
read access to the selected sheet. Provider access, account entitlement and
consent qualification must be established separately. Supply the exact numeric
sheet ID and explicitly select columns by their stable numeric IDs. Map each to
a unique native name and one type. For example:

```json
[
  {"id":"1001","name":"label","type":"text"},
  {"id":"1002","name":"amount","type":"money"},
  {"id":"1003","name":"units","type":"number"},
  {"id":"1004","name":"day","type":"date"},
  {"id":"1005","name":"active","type":"boolean"}
]
```

These illustrative IDs must be replaced with your selected sheet's real column
IDs. `TEXT_NUMBER` supports explicitly mapped text, exact decimal numbers and
USD money; `PICKLIST` supports text, `DATE` supports a calendar date and
`CHECKBOX` supports boolean values. Money accepts at most two fractional digits
without rounding. Other column types and system columns are refused with their
column ID and type. Complex cell objects, images, hyperlinks and linked cells
are refused rather than flattened. Ordinary DATE objects must agree with their
scalar date. Text and numeric values are not implicitly interchanged. Provider
JSON numbers that would lose decimal precision or exceed safe integer precision
are refused before parsing. Exact decimal strings retain their original digits.

The request goes only to `https://api.smartsheet.com`, with redirects refused,
without native cookies or automatic retries. The token is cleared from the
form and supplied only for this operation, never retained in originals,
normalized data, history, consent records or browser storage. Approve each read
explicitly; changing the selected sheet, mapping or dataset clears consent.
A failed read leaves the complete last committed dataset intact.

The adapter uses GET `/2.0/sheets/{sheetId}` with `columnIds`, `level=2`,
`include=objectValue`, `pageSize=100` and sequential `page` values. It requires
complete row counts, unique stable row IDs, contiguous provider row positions,
the exact selected columns and one unchanged version and schema across pages.
GET `/2.0/sheets/{sheetId}/version` must still match after the last page.
The snapshot is bounded to 2,000 rows, 32 selected columns, twenty pages and
512 KiB of collected values and formula metadata, within the shared original,
envelope, cell and normalized-table limits. Empty sheets are explicitly refused;
no empty replacement or partial snapshot is published.

The stable `smartsheet_row_id` column is the native key. Source provenance
retains the sheet ID and version, selected column IDs and titles, native typed
mappings, observation time, accounted row IDs and inert supplied formulas with
cached values. A missing provider value becomes null, while a literal empty
string remains empty text. Formulas never execute and cannot authorize a fetch
or change a grant. Only selected fields and bounded provenance enter custody;
unrequested provider metadata and raw provider error bodies are excluded.

Choose **Preview Smartsheet snapshot**, review the complete mapping, sample,
source version and fingerprint, then approve that exact plan and **Apply import**.
Completion requires the shared reconciliation. This publishes the captured
snapshot, not a live view or a claim that the provider has not changed since
capture. A new read requires new consent and a separate exact approval.

The protected **Download original** retains a JSON snapshot with the selected
values, stable identities, mappings, provenance and inert formulas.
Current data, protected originals, history, Undo and eligible erasure use the
same file workflow. Undo restores the prior native table without deleting
owner-held historical answers. Explicit eligible source erasure removes retained
snapshot originals, current and historical data and dependent native answers and
dashboards. Legal holds and minimum retention dates still prevent erasure.
The dataset ID stays retired and old approvals cannot replay. Independent
provider copies and downloaded files remain outside native erasure.

The protocol is pinned to the official Smartsheet
[OpenAPI specification](https://developers.smartsheet.com/_spec/api/smartsheet/openapi.yaml),
OpenAPI 3.0.3, API 2.0.0, SHA-256
`d74652828457f46a76f153c2434a8cea670805cca0bf6f1a3bc4e6b927a8cb36`.
The implemented schemas are Sheet, Row, Column, Cell and SheetVersion.
Documented self-authored HTTPS specimens establish this bounded native flow;
they do not establish live provider entitlement, OAuth lifecycle or grant
qualification. Managed incremental and deletion recovery, recurring execution,
other Microsoft business adapters, folder-combine and outbound-agent access
remain unfinished under BIF-072 and its existing dependencies.
