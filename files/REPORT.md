# sx-bifocal-f37fix1

Repository: just-every/run-bifocal. Product branch: cloud/sx-bifocal-f37fix1.

## Plan

1. Start a full-history clone at 0f85482725bbb33340fe9fea3c3a53904a725c3e and merge origin/main without rewriting published history. Preserve main's CONTRACT.md, generated views and ID map whole; preserve applied migrations. Confirm the candidate migration number is above main's highest.
2. Extend the existing Tableau public-route journey with exactly three independent regression assertions: full project identity, refused replacement custody, and a legal hold on a later linked project. Run them against the original candidate and record all three observable outcomes before assertions stop the journey.
3. Derive native metric identities from the complete project/metric pair. Validate every named source before writing custody in one guarded batch. Preflight all Tableau-linked retention before establishing an erasure fence or deleting any project.
4. Run only the touched Tableau journey and typecheck locally; regenerate/check selected contract views if needed, restore the views from main, and regenerate/check sources.lock.json last. Keep all original assertions and BIF-084 judgments unchanged.
5. Push through the fleet guard, audit all candidate identities/trailers, and poll exact-SHA Verify using the constrained REST budget. Keep all non-secret reports and actual receipts in this packet and publish only to the separate evidence ref. The Mac fleet owns publication scans, the independent gate and landing.

## Scope

Only the three reported introduced data-loss defects. No UI changes, campaign continuation or clause promotion. No publication scan will run in cloud. BIF-084 stays missing; its Status, Gap and Evidence cells remain main's whole row. Authorized real Tableau estates, provider proof and cutover remain unproved.

## Results

The three reproduced regressions changed from 0/3 preserving data on the original candidate to 3/3 preserving data on the fixed candidate. The existing Tableau journey also passed. Exactly three independent regression assertions were added inside `tests/journeys/migration-projects.mjs#proveTableauMigration`; no registrations were added, and no existing test or assertion was removed, skipped or weakened.

- Full identity: native metric IDs now hash the complete JSON-encoded project/metric pair, then encode every SHA-256 bit in base 36 within the native ID length limit. Two projects sharing their first 43 characters retain separate metrics; erasing A leaves B's metric document and revision unchanged.
- Refused replacement: every source binding is checked before custody is written; custody registration runs only after the shared door accepts the full plan. All source-existence/revision/erasure assertions and custody inserts run in one D1 batch. If a source erasure wins before registration, that batch writes no links and the retained plan/upload bytes are withdrawn. A replacement listing available A followed by an unavailable source returns 409 and attaches no custody to B's unchanged project. Erasing A then leaves B's project and metric unchanged.
- Whole withdrawal: the file erasure route checks retention across every linked Tableau project before installing its durable erasure fence. It rechecks that predicate in the fence batch and in project withdrawal. A legal hold on B in the later project refuses source A erasure (423) while both datasets, both complete projects and both native metrics remain byte-for-byte unchanged through their public GET routes. The original candidate returned a refusal after already deleting the earlier project.

Local validation: original-route reproduction exited 1 as expected and logged all three broken outcomes; fixed Tableau route journey exited 0; typecheck exited 0; both baseline and fixed `rer build` exited 0; touched BIF-084 contract write/check exited 0; selected source lock freshness check exited 0; `git diff --check` passed. No full local Verify was run.

Integration: origin/main at 11492a647a6e51b029f7a6269ef9826317c70db3 was already an ancestor of the required starting candidate; merge reported already up to date on both checks. Main's highest migration is 0072; the candidate's existing 0073 is already above it, so no applied migration was renumbered or edited. CONTRACT.md and ACCEPTANCE.md match main whole. This repository has no tracked docs/CLAIMS.md or docs/contract/ID-MAP.json; no such files were introduced. The generated view was restored from main after the successful generator check. Source lock was regenerated last.

Product pushed on the first attempt. Every one of the seven candidate commits, including side parents, passed the name/email/trailer audit; author and committer identities are fleet or the configured owner, with no coauthor trailers. The clone is full history. No main/default branch push or force push occurred. No PR is required by this seed's landing instructions, and none was created.

CLAIM BIF-084 PARTIAL points=none tests=tests/journeys/migration-projects.mjs#proveTableauMigration
DEFAULT BIF-084: Keep current-native-owner-only inactive intake; no imported authority, publication or dispatch.
GAP BIF-084: Real authorized Cloud/Server estates, live REST and Hyper migration, source parity, recipient reauthorization, refresh and digest receipts, revocation and cutover remain unproved. Contract status stays missing with main's row intact.

## Final product provenance

Final head: 3b8593b37405cefefa2ed5be8bed9b55d4fd1469. Product commits: a16cd0a5ee32c428e5f0078baed8ad326389c9a2 (three fixes and regressions), then 3b8593b37405cefefa2ed5be8bed9b55d4fd1469 (defer custody acquisition until shared-door validation succeeds). Both were pushed through the fleet guard on their first attempt, without rewriting published history. Main merge was repeated before the final commit and remained already up to date. No other writer or agent was used.

The final refinement passed typecheck, the build, and the complete touched Tableau journey with all three regressions again. The final source lock was regenerated and checked after the source change. The product checkout is clean. The initial head's Verify run 42569179313 is superseded; it is never used as the final candidate's green evidence.

Contract source status counts, unchanged before/after: {"done": 8, "missing": 37, "partial": 54}. Regression preservation outcomes: 0/3 before, 3/3 after.

## CI and terminal custody

Verify 42569562320 completed successfully on the exact final SHA 3b8593b37405cefefa2ed5be8bed9b55d4fd1469: https://github.com/just-every/run-bifocal/actions/runs/42569562320 . This is ordinary successful Verify, with no generator-failure exception needed. Four of the ten allowed GitHub calls were used; one watcher polled no faster than once per 300 seconds, and no workflow was dispatched or rerun. No failing completed run was observed. Earlier run 42569179313 belongs to the superseded initial commit and is not final-head evidence.

Blockers: none. No PR created or required by the supplied seed instructions. All three scoped regressions are fixed. BIF-084 remains missing in CONTRACT.md; the partial claim and original provider gaps remain. The Mac fleet owns the publication scan, independent gate, generated landing views and landing. This run neither scanned publication nor pushed main.

The complete actual report and explicitly selected non-secret receipts are returned only through refs/heads/evidence/sx-bifocal-f37fix1. Product READY and evidence transfer remain separate facts.

READY branch=cloud/sx-bifocal-f37fix1 head=3b8593b37405cefefa2ed5be8bed9b55d4fd1469
