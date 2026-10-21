# CSV import HTTP backend

The browser import screen at `/app/import` is unfinished. This document describes
the implemented HTTP backend for installation owners; it is not a claim that
BIF-003 or BIF-057 is complete. No live spreadsheet grant or analytical execution
is provided. Business grants remain closed, including on installations provisioned
with `RER_IMPORT_DOOR=on`; `/api/rer/import/*` returns 404.

CSV intake uses the pinned Base shared door, not a second importer:

1. POST `/api/operator/import/uploads` to upload a version-1 JSON envelope in
   SHA-256 checked 64 KiB chunks. Use the shared protocol in
   `src/modules/import-kit/src/door/README.md`. Chunks and their inventory persist;
   retry identical chunks or query `{ "uploadId": "..." }` to resume.
2. POST `/api/operator/import/plan` with the `uploadId`. After an applied baseline,
   also send `catchup: true`. Review the fingerprint, counts, proposed schema,
   five-row sample, source interpretation and row/column rejection reasons. No
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
this conservative default remains provisional until ct approves the import roles.
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
A stale plan cannot overwrite a changed dataset. CSV formulas are literal text;
there is no formula evaluation, network fetch, SQL execution or agent authority.
XLSX, XLSM, templates, archives and all other file types are currently refused,
not converted or executed. Data never becomes a URL to fetch or an app-origin
HTML/script document. BIF-043/057/073/081 and future query/notebook/embed/export
implementations inherit the same untrusted-data boundary.

Bounds are explicit admission limits: 512 KiB CSV text, 1 MiB envelope, 2,000 data
rows, 64 columns, 4,096 characters per cell, and 768 KiB final table. The whole
result is one atomic native effect. Interrupted uploads and failed validation
leave the last committed dataset intact. These are not a large-file scale claim;
large production ingestion and XLSX/live-range acceptance remain open.

GET `/api/operator/datasets/<id>` returns the current revision, typed table,
original filename/digest, interpretation and update time. GET
`/api/operator/import/history` with the dataset header lists exact approvals and
version jobs. GET `/api/operator/import/original/<planId>` with that header
returns the retained original envelope as a protected attachment; its CSV text
round-trips without normalization. Originals withheld by credential removal or
erasure are explicitly unavailable. All responses disable caching and MIME
sniffing; original downloads additionally use an attachment and sandbox policy.

To erase a dataset, POST `/api/operator/datasets/<id>/erase` with exact same-origin
owner authority and `{ "confirmDataset": "<id>", "reviewedRevision": "<current>" }`.
Each dataset has its own stable custody destination. Erasure withdraws its retained upload/snapshot custody, severs this
dataset's import lineage and originals, deletes its native data and advances
Base's portability erasure checkpoint in one transaction. Unrelated native
datasets remain. The completed receipt reports affected stores. Other datasets retain their native records, original attachments and import plans. Minimal approval metadata survives, and older installation
archives require the current erasure journal. There is no automatic retention or
outbound action. Source bytes and shared import custody are included in the
installer's archive inventory; sessions and dependency secrets remain excluded.

Full browser intake, accessible review states, multi-sheet XLSX and formula
calculated-value treatment, Google Sheets/Excel Online range authorization and
revocation, large-file qualification, isolated SQL/Python/extensions and all
other BI workflows remain unfinished. No provider sandbox or cross-platform
qualification is claimed by the CSV journey.
