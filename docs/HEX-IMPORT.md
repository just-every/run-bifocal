# Import an inactive Hex project

The installed `/app/import` page accepts an original `.hex.yaml` or `.hex.yml` file through **Import a Hex project**. This is a bounded reconstruction inventory, available to the current native owner. Imported cells, connections, environment references, secret names, permissions and schedules acquire no execution or access authority.

## Supported format

The reader targets schema version 3 of the [published Hex project-file schema](https://static.hex.site/hex-file-schema.json), retrieved on 4 November 2026. The supported snapshot has SHA-256 `39e195b7848461f52260c2e3d0e8f599faa92f6f89737cf85913cdd772da2026`. There is no network fetch at import time. The reader recognizes the published envelope, metadata, ordered cell identities, cell configurations, asset sections and app cell references; it is an inert subset reader, not full Hex compatibility validation.

The original file is limited to 256 KiB and 90 cells. Each cell must have its stable UUID. SQL, Python CODE, MARKDOWN, rich TEXT, CHART, CHARTV2 and INPUT definitions remain data. Unsupported cell types and properties remain in the safe original and produce unresolved reconstruction tasks. The inventory records the exact original-byte digest, schema identifier and digest, source project and version identifiers, ordered stable cell IDs, app layout references and declared connection and environment references. The source version may be absent in an original; that is reported as missing evidence. A migration project cannot silently change its source project identity.

The specimens in `tests/journeys/migration-projects.mjs` are self-authored from that published format. They are not customer exports, a real Hex estate, provider receipts or evidence of source-result parity. Deliberately unsupported specimens are labeled in the journey.

## Review and apply

1. Enter a stable migration project ID, an explicit UTC cutoff and the rollback plan. Choose the original file and preview it.
2. Review the original cell order and definitions, app references, schema and source version, source locations and concrete reconstruction tasks. Missing referenced cells, unapproved packages, dynamic dependencies and unresolved connections stay visible.
3. Approve the exact fingerprint and Apply. The shared door reconciles the retained inventory; this never certifies numerical, rendering or environment equivalence.
4. Load the project to inspect retained definitions, native reconstruction edits and version history. Source deltas use stable cell IDs. A concurrent native edit invalidates the pending plan. A changed cell with a later native edit becomes an explicit conflict, with both definitions preserved. Resolve it by keeping the native reconstruction or accepting the source definition.
5. Download the safe original from import history. A plain source delta can Undo to the exact prior retained inventory. Undo refuses if it would discard later native reconstruction work; review those conflicts instead.

Python imports and package directives get source-line tasks, but static inspection never establishes the full dependency graph. No packages are installed, no code is evaluated, no connection is opened and no schedule is activated. The inventory always labels dependencies incomplete, execution disabled and stored outputs unverified. Original run lineage and old outputs cannot establish a current reproducible run.

## Credentials and erasure

Credential-valued fields, credential environment entries and recognized literal-secret assignments are refused. The assembled file is screened before a plan can retain it. Refused upload chunks and their upload header are removed from the controlled live store; diagnostics omit the value and source expression. Malformed or uninspectable Hex input is also refused and purged. References containing only secret names confer no credential or authority. Remove secrets in the source and export again; the literal screen is conservative and does not promise to detect every arbitrary secret or encoding.

After reviewing the current project, type its exact ID to erase it. Erasure withdraws controlled originals, import snapshots, native definitions and reconstruction history, and permanently retires the ID. Earlier installation archives remain subject to the existing known-journal restore boundary; this feature makes no new complete restoration, backup deletion or provider-retention claim.

The real authorized Hex project, same-snapshot results and app reconciliation, executable locked environments, original run qualification, complete version restoration, ownership, reviews and comments, connection reauthorization, scheduled run and notification qualification remain unfinished. Execution and isolation retain BIF-058 and BIF-057 dependencies; delivery retains BIF-015 and BIF-052. The current-native-owner-only inactive inventory default remains pending ct approval.
