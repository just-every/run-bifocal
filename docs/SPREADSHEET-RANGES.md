# Bounded live spreadsheet range preview

`POST /api/operator/spreadsheets/preview` reads one explicitly selected Google
Sheets or Excel Online range and stages its cached text and original formulas
through the existing Base file upload/plan door. The caller is the current native
installation owner, with the same app origin, native session cookie and JSON
content type. The role, active membership, version, expiry and linked IdP pin
are fenced before egress and rechecked by each shared-door upload and plan.
Admins, members, machine credentials and Business grants cannot open this route.

The route handler is `spreadsheetRangeResponse(request, bindings)` in
`src/bifocal/sources/spreadsheets/server.ts`; mount it before the file handler.
The existing file reader must accept the `spreadsheet` metadata described below
and retain it in the source preview. This is an adapter to the same importer,
not a second publication or refresh path.

Request fields:

| Field | Required meaning |
| --- | --- |
| `provider` | Exactly `google` or `microsoft` |
| `workbook` | Google spreadsheet ID or Microsoft drive item ID; no URL/path |
| `sheet` | Exact worksheet name |
| `range` | Uppercase bounded A1 rectangle, such as `A1:D3`; first row is headers |
| `datasetId` | Existing file-door dataset id, or a new stable id |
| `mode` | `replace`, `append`, or `keyed-update` |
| `key` | Optional header name or null; explicit name required for keyed update |
| `columns` | Optional mapping of every header to a file-door column type |
| `nullValue` | Explicit complete-cell null marker, including empty string |
| `formulaTreatment` | Exactly `cached-values-preserve-formulas` |
| `confirmRead` | Exactly `true`: authorize this one provider read |
| `accessToken` | Fresh authorized bearer token, supplied only in this request body |
| `catchup` | Optional boolean; use true after an applied baseline, as with file plans |

Do not put credentials into a URL, source field, saved configuration, log or
example fixture. Each read requires a fresh owner-authorized token. The server
holds it only while handling this request, sends it only as the selected provider's
Authorization header and omits it from the retained upload, plan, errors and
responses. It never persists a grant or refresh token, obtains broader authority,
refreshes automatically or creates a provider workbook session. Protect the
request body from deployment-level request logging as for native sign-in inputs.

The returned response is the ordinary shared-door plan, including rejected
mapping reasons and a preview. No current dataset changes. Review its exact
fingerprint, then use the existing file-door apply, reconcile, original-download,
history and Undo endpoints with `X-Import-Dataset`. A later range read requires
another explicit POST and fresh token. Revoked/expired grants return
`spreadsheet_grant_revoked`; redirects, provider failures, malformed payloads,
rate limits, timeouts and bounds have credential-free named errors. These
failures create no upload or plan and preserve the current dataset. A mapping
failure follows the file door's review and cancellation flow. An interrupted
shared upload can retain unapplied chunks but never changes the current table.

## Exact provider protocol and custody

Google uses one HTTPS GET to
`sheets.googleapis.com/v4/spreadsheets/{id}`, with one quoted sheet/range and a
field mask for grid text, effective values and user-entered formulas. Formula
caches and expressions come from the same response. Use a delegated token
authorized for `spreadsheets.readonly` (or another provider-supported scope).
[Google get protocol](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get)
and [cell schema](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/cells)
define this request and the cached/formula fields.

Microsoft uses one HTTPS GET to
`graph.microsoft.com/v1.0/me/drive/items/{id}/workbook/worksheets/{name}/range(address='A1:D3')`,
selecting address, offsets, dimensions, text, formulas and value types. The
[Graph get protocol](https://learn.microsoft.com/en-us/graph/api/range-get?view=graph-rest-1.0)
requires delegated `Files.ReadWrite` even for this GET; application permissions
are unsupported. This adapter performs no provider writes. The
[workbookRange schema](https://learn.microsoft.com/en-us/graph/api/resources/workbookrange?view=graph-rest-1.0)
defines the text and formula matrices. Only the global Graph hostname and a
drive item in the delegated user's drive are supported; other drives, national
clouds and sharing-URL resolution remain unsupported.

All destinations are constructed from strict coordinates. Arbitrary URLs,
named/unbounded ranges, redirects, pagination, refresh and provider writes are
refused or absent. Source cells and formulas never become network requests,
code, grants or approvals. Provider-displayed text is imported verbatim; local
formatting, uppercase boolean text or unsupported dates require an explicit
text mapping or source formatting change through the ordinary preview. No
formula is executed or recalculated by Bifocal. Error cells and missing Google
formula caches are refused. Graph expressions beginning `=` are preserved as
formulas according to its A1 formula field; literal formula-looking text remains
inert regardless of the provider representation.

Limits are 32 KiB request JSON, 15 seconds per provider GET/body, 1 MiB provider
JSON, 2,001 selected rows including headers, 64 selected columns, 4,096 characters
per cell/formula, 512 KiB converted CSV and 1 MiB retained envelope. The existing
file door additionally bounds final table size and validates headers, types,
keys, schema drift and exact-plan approvals. These are admission bounds, not a
large-file performance claim.

The version-1 CSV envelope carries `formulaTreatment` as above and an optional
`spreadsheet` object containing `provider`, `workbook`, `sheet`, `range`,
`fetchedAt` (server read-completion time), and `formulas` (original source A1
`cell`, `formula`, and cached text). The original-download envelope retains
these fields; the native table's `source.spreadsheet` retains lineage, while
`source.formulas` exposes retained expressions for review. Upload bytes are
derived from the range snapshot, not an original XLSX workbook. Existing file
versions, archive inclusion and dataset erasure cover the same `files:` namespace.
The fetched timestamp does not assert the provider's underlying source freshness.

## Live qualification and grant custody

No live provider acceptance is claimed. The implemented adapter uses the official provider protocol described above; live delegated-grant and revocation qualification is pending.

ct decision pending: long-lived delegated-grant custody, OAuth enrollment,
reconnection and refresh authority under BIF-035. Conservative interim behavior
is one explicit owner read with a freshly supplied ephemeral token and another
exact human plan approval before publication. BIF-003 remains partial pending
the full browser journeys, real provider grant/revocation proof and the other
file/large-intake acceptance points; this document supplies no live acceptance.

## One-read consent history

Before contacting a provider, the same current-owner transaction appends an explicit consent event bound to the exact normalized request fingerprint, excluding its grant. A staged plan or provider failure appends its observed outcome. `GET /api/operator/spreadsheets/reads` returns the latest 100 owner-protected events and a `more` flag. Events retain only request ID, provider, dataset ID, approving owner, fingerprint and time; they contain no token, workbook coordinates, URL or cell. An unfinished consent event alone never claims a completed read or publication. This approval metadata is archived and retained after source erasure; source custody and original bytes remain erasable. Automatic refresh and token custody remain closed pending BIF-035.
