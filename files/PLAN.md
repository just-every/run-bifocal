# sx-bifocal-f54fix-1 plan

1. Install fleet identity, decrypted-bundle Git helper, push guard, commit hooks and pinned project toolchain; read launcher and product instructions.
2. Shallow filtered clone of just-every/run-bifocal; fetch and verify resolver head 689433b700f7377ade76ddb036c0e2d61e7f949c and record current main.
3. Read failed job 128205236614 once (original Verify 42303238688, attempt 2). Identify request and original assertion without changing tests.
4. Reproduce the authority leaf on candidate and current main using a disposable migrated emitted Worker. If main fails the same leaf, report exact numbers and stop product work as instructed.
5. If only candidate fails, trace the server error and fix product authority handling before work; retain the assertion and every guard.
6. Rebase unpublished work onto current main with fleet identity/hooks active. Preserve main CONTRACT judgments; change no Status, Gap or Evidence. Regenerate touched views and check, restore generated views from main. Regenerate sources.lock.json last and check freshness.
7. Run only touched tests, typecheck and failing browser group once; use system Chromium with --no-sandbox. No workflow changes, dispatch or rerun.
8. Inspect all candidate commit identities, messages and trailers; publish named product branch through cloud push guard. Never push main or rewrite published history.
9. Within ten GitHub calls, discover exact-SHA Verify through REST and poll at most once per 300 seconds per run. Require completed/success, except documented generated-view-only failure. Report actual CI provenance.
10. Preserve complete actual non-secret reports/receipts outside product; explicitly publish packet to evidence/sx-bifocal-f54fix-1. Return evidence head and lane POST plus terminal product status.

Scope: just-every/run-bifocal only. No PR unless repository landing rules require it. BIF-003 PARTIAL to PARTIAL; counts unchanged. A successful fix supersedes resolver landing sx-bifocal-c-f54-land-e5d044df73.

## Terminal outcome

Step 4 found the same main failure in the bounded 405-then-bearer sequence: 23 correct 401 responses, then actual 500 instead of 401 on current main 0833c79f906b73e0d6cdf966b57e962bd3a0827e. The brief's explicit stop condition applies; fv owns main. No product commit, push, PR or new CI was made. A prototype already in progress completed its affected file/browser group successfully after early refusals used the shared body drain. Preserve it as diagnostic evidence only. Steps 6-9 were not completed as a product publication pipeline. Complete actual results are in REPORT.md and RECEIPT.json.
