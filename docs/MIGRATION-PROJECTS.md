# Inactive migration inventories

Migration projects retain bounded reconstruction inventories through the existing
shared Files import HTTP door. They do not translate an incumbent export, publish
content, grant access, establish parity or send a report. The browser migration
wizard and live cutover remain unfinished.

Use the same upload, plan, exact fingerprint approval, apply, status, reconcile,
Undo operations described in [FILE-IMPORT.md](./FILE-IMPORT.md). Set
`X-Import-Kind: migration-project` and `X-Import-Dataset` to the stable project ID.
The envelope is JSON with `version: 1`, matching `projectId`, `source`, UTC `cutoff`,
nonempty `rollbackPlan` and `items`. Each item has a stable `id`, `kind`,
`sourceRevision`, inert `original`, descriptive `mapping` and explicit `gap`.

Supported inventory labels are `spreadsheet`, `databox`, `zoho`, `klipfolio`,
`qlik`, `power-bi`, `tableau`, `looker`, `metabase`, `omni`, `sigma` and `hex`.
These labels select no parser. Supply a lawfully obtained source description;
raw provider exports still require their own documented format adapters.
Kinds include data, metric, dashboard, parameter, schedule, folder, permission,
identity, schema, load-script, association, set-analysis, sheet, bookmark and
calculation. Scripts, formulas and permissions remain inert text. A mapping is
reconstruction intent and never a translated or reconciled item. The managed
file data door continues to accept bounded CSV and XLSX without a warehouse.

The limit is 100 retained items in a project, 8,192 characters per original and
one MiB per uploaded envelope. A later import includes changed and new items;
omitted items remain inventoried. Deletion is not inferred. Source kind and
source system cannot change in place. A changed item needs a new source revision;
reusing the current source revision with different content refuses the plan. The cutoff
cannot move backward. Use the shared door's explicit catch-up plan after an
applied baseline, and review its fingerprint again.

`GET /api/operator/migration-projects/<id>` returns current retained inventory,
revision and the latest 100 history summaries. Earlier revisions remain readable
through the project's `versions/<revision>` path. `historyTruncated` discloses a
longer history. The current native owner alone may read or mutate a project.
Every write requires the same-origin native session and rechecks authority and
its exact project revision in the committing transaction. Imported identities
and permissions grant nobody access. Restricted-viewer review is unfinished.

`POST /api/operator/migration-projects/<id>/edit` accepts `reviewedRevision`,
`itemId` and inert `native` text. Later source edits retain that native text and
record the incoming item as a conflict. `POST` to the project's `resolve` path
accepts `reviewedRevision`, `itemId` and `choice`, either `keep-native` or
`use-source`. Both choices preserve earlier originals and edit history. Another
source change after keeping a native edit opens a fresh conflict. An unchanged
source retry preserves the reviewed resolution. Stale plans cannot overwrite
subsequent native edits. Shared Undo supports the untouched inactive baseline and refuses after native
edits or subsequent merged deltas. It is not a substitute for a reviewed
cutover rollback.

The shared history and original routes retain imported envelopes. To retire a
project and its import custody, post `confirmImport` and `reviewedRevision` to
its `erase` path. Its retired ID cannot be imported again. This bounded erasure
does not establish complete subject erasure or provider deletion.

Every project stays `inactive`, with `dispatch: unavailable` and `grants: none`.
Dual-run queries, complete item accounting against real exports, reviewed parity,
restricted-user review, buyer sign-off, source schedule shutdown, a single active
schedule set, first received delivery and safe cross-system rollback still need
implementation and real estate qualification. Analytical delivery depends on
BIF-058 and BIF-015. No source API calls or outbound actions occur here.
