# sx-bifocal-f54fix-1: BLOCKED, main fails the same leaf

Repository: just-every/run-bifocal  
Local branch: cloud/sx-bifocal-f54fix-1  
Unchanged resolver input / local HEAD: 689433b700f7377ade76ddb036c0e2d61e7f949c  
Current main reproduced: 0833c79f906b73e0d6cdf966b57e962bd3a0827e  
No new product commit, product push, PR, workflow change, CI dispatch or rerun.

## Outcome and required stop

The brief explicitly says: “If main fails the same assertion, report that with the numbers and end BLOCKED main fails the same leaf (fv owns main).”

Current main reproduces the same assertion and expected/actual values. A bounded sequence repeatedly sends the existing journey's PUT /api/operator/retention/<dataset>/history with {}, expects 405, then sends its protection PUT with native owner cookies and Authorization: Bearer synthetic-bifocal-1, expecting 401. Main returned 23 correct 401 responses, then returned 500 for synthetic-bifocal-legacy. The response body and Worker log identify Miniflare ProxyWorker “Network connection lost,” with the public runtime stack at miniflare/dist/src/workers/core/entry.worker.js:5204:22. main-reproduction.json and main-sequence-leaf.log contain the actual result.

This is a main defect, so fv owns the next product decision. No replacement product candidate was published and this run does not supersede resolver landing sx-bifocal-c-f54-land-e5d044df73. The existing resolver input is retained. Evidence publication is report transport only.

## Original failure and investigation

Fetched the named resolver rebase branch and verified its exact head 689433b700f7377ade76ddb036c0e2d61e7f949c. Main is its ancestor. Read the failed job once using gh run view --job 128205236614 --repo just-every/run-bifocal --log-failed: original Verify 42303238688, attempt 2, same actual 500 versus expected 401. No corresponding server exception is printed in that downloaded historical log.

The failed assertion is tests/journeys/erasure-receipts.mjs:43, called from proveLegacyFiles in tests/journeys/file-import.mjs:416. Its immediately preceding request is PUT to the retention history route with a small JSON body, which expects 405.

Initial isolated bearer requests on candidate and main both returned 401. Both ordinary file-import groups passed locally, and the original candidate's tests/runtime.mjs main Worker group also passed through HTTP-001, including both retention sequences and XLS. Thus the failure is intermittent rather than deterministic across these local runs.

An initial prototype rejecting Authorization before fileOwner reproduced the original 500 in the affected browser group. This time the captured log identified ProxyWorker “Network connection lost” immediately after the preceding history PUT returned 405. That demonstrates that moving the bearer check alone does not repair this failure.

The retention route's early history/method/path refusals returned JSON directly without consuming refused request bodies. The shared rejectedResponse helper and file-import door already document why a Worker service can abort its upstream connection while an unread body is in flight. This is the transport mechanism implicated by the reproduction. The repeated main sequence then reproduced the identical 500/401 leaf on main, activating the brief's stop condition.

## Preserved diagnostic prototype

diagnostic-uncommitted.patch contains only the retention product route and its generated source-lock entry. It remains uncommitted in the product checkout and is not a ready or landed candidate.

The prototype:
- Rejects requests carrying Authorization before cookie-session lookup, preserving owner_required/401.
- Uses the existing bounded rejectedResponse body drain on the three early path/method refusals, including the history PUT's 405.
- Retains native human owner/session checks, every existing assertion, the Base pin and the original XLS implementation.
- Adds no error catch or error relabeling. No native-session storage failure is hidden for human requests.

Its affected file-import/browser group, including the existing XLS protection assertion, passed after the drain change. The code-level probes also passed: bearer and empty-Authorization requests return 401 with zero session reads; human-only session faults still propagate; native-session-authenticated early 404/405 paths consume their refused body. These support fv's investigation; one successful prototype run is not a claim of full intermittent-failure qualification.

## Checks and limitations

Used Node 22.20.0, pnpm 10.12.4 and exact published @runeditrun/rer 0.2.91. Playwright used /usr/bin/chromium with --no-sandbox. Runtime probes use disposable migrated emitted Workers and synthetic native owner bootstrap, not real accounts or provider grants.

Actual results:
- Original candidate standard leaf: passed, two 401 responses.
- Current main standard leaf: passed, two 401 responses.
- Candidate ordinary file-import group: passed.
- Current main ordinary file-import group: passed.
- Original candidate tests/runtime.mjs main production-Worker/browser group: passed through HTTP-001. The command then failed in unrelated follow-on proveContentGovernance because setup had already created .dev.vars (EEXIST); this is not a full-suite pass.
- Header-only prototype file-import group: failed identical 500/401 assertion; captured ProxyWorker connection loss.
- Current main bounded 405-then-bearer sequence: failed same assertion after 23 correct refusals.
- Prototype with refused-body drain: affected file-import/browser group passed, including XLS review/apply/append/keyed-update/Undo/download/refusal/erasure and 1440/390 proof.
- Prototype typecheck, rer build, direct boundary probes and source-lock freshness: passed.
- Contract write/check BIF-003: passed; generated ACCEPTANCE.md restored from origin/main. docs/CLAIMS.md does not exist here. No contract or generated-view change is committed.
- No workflow or assertion changed, no CI dispatch/rerun, no product push and no new exact-SHA CI run. One GitHub CLI/API read was used for the historical failed log.
- All local browsers and test-owned servers exited.

BIF-003 stays PARTIAL to PARTIAL. Counts are unchanged: all clauses 8 done / 54 partial / 37 missing / 99 total; target and push-further 4 / 54 / 37 / 95. No Status, Gap or Evidence edit was made.

## Reproduction and preservation

PLAN.md records the original execution plan and the stopping point. RECEIPT.json is the actual terminal receipt.

sequence-leaf-probe.mjs reproduces the public sequence without XLS parsing. Run from a built checkout of main using Node 22.20.0:
1. Ensure the checkout's pinned dependencies and emitted Worker exist.
2. Run timeout 180 node <packet>/sequence-leaf-probe.mjs through cloud_run.
3. It makes at most 40 protection requests, keeps owner cookies, asserts the same 405 then 401 sequence, prints actual statuses/body and cleans up its disposable Worker/database. It does not retry a failed assertion.

The ordinary browser groups invoke the unchanged proveConventions and proveFileImports functions. Their standalone reproduction harness is file-group-probe.mjs. boundary-probe.mjs bundles the real retention route; its unavailable-store and synthetic session-row test doubles are declared fault-injection evidence, not claims about the unprinted historical exception.

Verified recovery bundle outside the product clone:
/home/agent/rer-consolidation/work/sx-bifocal-f54fix-1/resolver-input.bundle
SHA-256: c73664d27bba9a6b07cc565c7f9a733d2f3b12b33aae76378b500fed8aa8d05e

The bundle preserves the input Git history; the separate uncommitted patch preserves the diagnostic work:
diagnostic-uncommitted.patch
SHA-256: 32e68fea1f10b3880e7d7db22d2f3509941271646cf4167e4b141281ac2aeb66

No READY, acceptance, publication scan or landing is claimed. Evidence will be published only to refs/heads/evidence/sx-bifocal-f54fix-1.
