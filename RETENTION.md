# Native source retention and receipts

BIF-034 is partial. Subject and tenant erasure, all future analytical stores,
complete historical audit anonymization and restore with a current journal are
not implemented by these source controls.

A current native owner can read and update `/api/operator/retention/:dataset`.
GET returns the policy and its exact semantics. PUT requires `confirmDataset`,
`reviewedDatasetRevision` (null when no table is published), `previousRevision`
(null for a new policy), `legalHold` and `minimumRetainUntil` (null or an exact
UTC ISO timestamp with milliseconds). The current source image and policy revision
are checked atomically with the write. Replacing an existing protection also
requires `releaseHold: true`. No group or foundation role grants this authority.

These are minimum-retention and legal-hold controls, never automatic expiry.
An explicit source erasure refuses with `retention_hold` while either protection
applies. Release the protection only with the appropriate authority and after
reviewing the legal obligation. The existing exact source revision confirmation
still applies. Each erase batch, including guarded derivative retirement, checks
that no protection applies. Nothing is automatically destroyed when a date passes.
This conservative owner-only retention and explicit release policy awaits ct
approval; it does not establish broader legal-hold management.

A successful existing dataset erasure returns `auditId` as well as its import-kit
receipt and separate model-project and calculation-library results. The current
owner can GET `/api/operator/erasure-receipts/:auditId`. The durable receipt lists
completed file import custody stores and enumerated native derivative stores,
with row counts (including zero native counts). Import-kit completed counts are
copied by its final journal insertion in the same erasure batch, using a routing
row that is removed before commit. A failed batch produces no completed receipt.
A separate anonymized `retention_changed` audit is created on policy changes.

The permanent new audit holds only random, independently generated actor and
subject references, an opaque event id, an event kind and time. It holds no
mapping back to a source, operator, email, source fingerprint or source revision.
Receipt store rows contain store names and counts, never erased values. Update,
delete and replacement of these new audit rows are refused by database triggers.
The active source policy is removed in the successful erasure batch.

Existing import approval metadata remains governed by the BIF-057 ruled floor;
this new anonymized audit does not claim to anonymize that history. External
downloads and sent messages cannot be recalled. No completed provider deletion,
provider hold investigation, subject discovery or application-wide completion is
asserted. Dataset ids remain retired after erase; automatic re-ingestion is
refused and new source data requires a new id. A current journal only fences old
archives at destinations that know it. BIF-086 still owns fresh-destination
acknowledgment and journal export and import. Browser Settings authoring and
subject-aware re-ingestion remain unfinished.
