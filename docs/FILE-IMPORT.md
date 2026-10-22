# CSV and XLSX import HTTP backend

The owner browser file workflow is at `/app/import`. This document describes
the implemented HTTP backend; it is not a claim that
BIF-003 or BIF-057 is complete. Live ranges use a manually supplied one-read delegated grant under `docs/SPREADSHEET-RANGES.md`; live provider qualification is pending. There is no automatic refresh. Business grants remain closed, including on installations provisioned
with `RER_IMPORT_DOOR=on`; `/api/rer/import/*` returns 404.

File intake uses the pinned Base shared door, not a second importer:

1. POST `/api/operator/import/uploads` to upload a version-1 JSON envelope in
   SHA-256 checked 64 KiB chunks. Use the shared protocol in
   `src/modules/import-kit/src/door/README.md`. Chunks and their inventory persist;
   retry identical chunks or query `{ "uploadId": "..." }` to resume.
2. POST `/api/operator/import/plan` with the `uploadId`. After an applied baseline,
   also send `catchup: true`. Review the fingerprint, counts, proposed schema,
   five-row sample, source interpretation and up to 20 row/column type-error reasons.
   All typed-cell and row-width errors persist without cell values in `bf_file_reviews`, including after cancellation. GET `/api/operator/import/review/<planId>?offset=100` pages errors 100 at a time. Candidate unique non-null keys are shown; keys remain explicitly selected and validated. CSV originals support UTF-8, UTF-16LE/BE and Windows-1252 with decoded-text/byte agreement. No
   native data changes at upload or plan. A rejected table proposes no effects.
3. POST `/api/operator/import/apply` with that exact `planId` and
   `reviewedFingerprint`. Repeat bounded calls until `job.state` is `completed`.
   Never display completion for queued, applying or failed work.
4. POST `/api/operator/import/reconcile` with `planId` to compare native values,
   revisions, counts and provenance. POST `/api/operator/import/undo` with that
   `planId` to restore its full before-image. Undo newer versions first. Strict
   Undo refuses a conflicting native edit instead of overwriting it.

Every shared door request requires the native owner's cookie, JSON content type,
exact app `Origin`, and `X-Import-Dataset` header. Dataset ids start with a lowercase
letter and contain at most 64 lowercase letters, digits or hyphens. The current
owner's exact session, membership version, expiry and linked IdP policy are
rechecked inside each write transaction. Admin/member/machine access is denied;
this interim authority was ruled by ct on 21 October 2026. Future source permissions and machine grants extend this same door; Business imports require explicit owner opt-in under BIF-035, never first owner claim.
BIF-032/019/035 must carry this authority boundary into future roles and doors.

The uploaded bytes are the UTF-8 JSON envelope, including the original CSV text:

```json
{
  "version": 1,
  "datasetId": "synthetic-bifocal-sales",
  "filename": "synthetic-bifocal-1.csv",
  "encoding": "utf-8",
  "delimiter": ",",
  "nullValue": "",
  "formulaTreatment": "literal-text",
  "mode": "replace",
  "key": "id",
  "data": "id,date,region,amount\r\n1,01/15/2026,West,$1234.56\r\n"
}
```

Accepted delimiters are comma, semicolon, tab and pipe. RFC 4180 quoted fields,
escaped quotes, CRLF/LF and a UTF-8 BOM are supported. No whitespace is silently
trimmed. The explicit null marker matches whole cells, and empty strings remain
text when another marker is chosen. Dates are strict valid `MM/DD/YYYY` and
stored as ISO dates. Numbers and USD amounts remain exact decimal strings with
a declared type; no binary floating-point conversion is performed. Inference is
shown in the server plan. An optional `columns` object maps every header to
`text`, `number`, `money`, `date` or `boolean`. Existing schemas remain in force
unless an owner explicitly maps and reviews a replacement. Headers are unique
and nonempty. Key columns must be unique and non-null in the entire result.

`append` keeps existing rows, `replace` publishes the complete replacement, and
`keyed-update` replaces matching keys and appends new keys without duplicates.
A stale plan cannot overwrite a changed dataset. Cancel a rejected or unwanted
plan through Undo before planning its corrected replacement. CSV formulas are literal text;
there is no formula evaluation, network fetch, SQL execution or agent authority.
XLSM, templates, archives and other file types are refused. XLSX accepts an
explicit selected sheet, cached formula values and retained original formulas,
without execution. Import each wanted sheet through its own reviewed plan. Data never becomes a URL to fetch or an app-origin
HTML/script document. BIF-043/057/073/081 and future query/notebook/embed/export
implementations inherit the same untrusted-data boundary.

Bounds are explicit admission limits: 512 KiB CSV text, 1 MiB envelope, 2,000 data
rows, 64 columns, 4,096 characters per cell, and 768 KiB final table. The whole
result is one atomic native effect. Interrupted uploads and failed validation
leave the last committed dataset intact. These are not a large-file scale claim;
large production ingestion, real Excel-saved workbook/client and live-grant qualification remain open.

GET `/api/operator/datasets/<id>` returns the current revision, typed table,
original filename/digest, interpretation and update time. GET
`/api/operator/import/history` with the dataset header lists exact approvals and
version jobs. GET `/api/operator/import/original/<planId>` with that header
returns the retained original envelope as a protected attachment; its CSV text
round-trips without normalization. Originals withheld by credential removal or
erasure are explicitly unavailable. All responses disable caching and MIME
sniffing; original downloads additionally use an attachment and sandbox policy.

To erase a dataset, POST `/api/operator/datasets/<id>/erase` with same-origin
owner authority and `{ "confirmDataset": "<id>", "reviewedRevision": "<current>" }`.
When no table is published, explicitly send `reviewedRevision: null`. This covers
rejected or cancelled imports and an undone first import. Either consent is
refused with 409 if the reviewed state changed. Omitting the revision is refused.

Each dataset has its own stable custody destination. One transaction withdraws
every upload, snapshot and original in that namespace, including rejected,
cancelled, interrupted, undone and superseded versions, deletes the native table
and advances Base's portability erasure checkpoint. Other datasets retain their
records, original attachments and plans. The receipt reports affected custody
stores and row counts, without erased values. Plan ids, fingerprints, approving
owner, times and dataset id remain as approval history.

The dataset id is retired. Later plans answer `source_erased`; use a new id for
new data until BIF-034 defines re-ingestion policy. An archive made before the
erasure is refused only where the erasure journal is known. A fresh installation
without that journal cannot detect the erasure. The receipt states this limit;
it does not claim a universal archive fence. There is no automatic expiry or
outbound action. Retention rules remain open under BIF-034/057. Source bytes and
import custody are included in installer archives; sessions and dependency
secrets remain excluded.

Full live Google Sheets/Excel Online grant qualification and durable OAuth refresh custody, production large-file qualification, broader workbook/client qualification, isolated
SQL/Python/extensions and all
other BI workflows remain unfinished. No provider sandbox or cross-platform
qualification is claimed by the CSV journey.

## XLSX sheets and formulas

Use the same version-1 envelope with a `.xlsx` filename, canonical base64 binary
`data`, the exact `sheet` name and
`"formulaTreatment": "cached-values-preserve-formulas"`. Retain `encoding: utf-8`
and a supported delimiter in the envelope; workbook XML is UTF-8 and a delimiter
does not apply to its cells. The server preview lists available sheets, the
selected sheet and formula locations, expressions and cached values. The original
workbook binary round-trips through protected original-envelope download. Changing
the sheet and choosing append requires another exact reviewed plan. Formula
expressions remain data, including expressions containing URLs. No library
calculates or executes formulas. Missing caches and shared/array formulas require
source recalculation or an explicit values-only copy; they are named refusals.

Supported ordinary OOXML cells include inline/shared/rich text, booleans, simple
exact decimals, common USD formats and integer Excel dates in 1900/1904 calendars.
The fictitious 02/29/1900, fractional dates, errors, scientific notation and
unsupported custom/time formats are refused. Original cell types drive initial
column detection; mixed types or a type change against an existing dataset require
an explicit mapping. No implicit string-to-number conversion is performed.
The two-sheet test fixture follows ECMA-376 / ISO/IEC 29500 package and worksheet
structure, documented by [Microsoft Open XML](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document).
It establishes synthetic file-format proof, not qualification in a live Excel host.

Workbook admission is bounded to 512 KiB compressed, 128 ZIP entries, 1 MiB per
expanded part, 4 MiB expanded total, 50,000 XML markup boundaries, 64 XML nesting
levels and 32 named sheets. The ordinary row/column/cell/final-table bounds also
apply. Central/local offsets, paths, names, sizes, CRC32 and nonoverlap are checked;
ZIP64/encryption and unsafe/duplicate paths are refused before use. DTDs and
entity declarations, external relationships, VBA/macros, active controls and
embedded binaries are rejected. ZIP bytes never become extracted app files or
public content. Large or unsupported workbooks need a bounded values-only export;
that is an explicit limitation and does not close large-file acceptance.

## Browser workflow and retained copies

`/app/import` uses the same HTTP upload/plan/apply/reconcile/Undo handlers. It detects byte-order marks and unambiguous header delimiters, requires an explicit encoding when UTF-8 decoding fails, previews columns/candidate keys and interpretation, displays lineage/time/formulas, binds explicit approval to the full fingerprint and reports completion only after reconciliation. Upload chunk references in session storage contain only a digest and id; select the identical file to resume. No file bytes or provider token are stored in browser storage. Error metadata is owner-only and dataset erasure deletes it.

The browser downloads original CSV/XLSX bytes under the original filename; a live range downloads its derived JSON snapshot with formulas and lineage. Erasure clears the page preview and selected file buffer as well as withdrawing native custody.

Native exact queries retain source rows in immutable snapshots. Explicit dataset erasure also withdraws dependent query snapshots and saved tabular dashboard/report results in the same retirement transaction, including after Undo leaves no published table. Undo unpublishes data while retaining historical owner-held answers until explicit erasure. The erasure receipt includes those affected native stores and counts. Archive inventory includes convention versions, error reviews and query custody; transient guards, sessions and provider tokens are excluded.
