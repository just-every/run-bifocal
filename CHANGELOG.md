# Changes

## 0.1.4

Bifocal's work since 0.1.3 (25 Oct), released so its demo opens current code. 38 migrations are added (0041_exploration_access.sql … 0073_tableau_migration_custody.sql, all listed in RELEASE.json); the RER CLI pin is 0.2.91.

- Sources: bounded, reviewed imports from Tableau, XLS, Smartsheet, HubSpot deals, Square order summaries, LookML, Looker Studio and Omni, each with custody proof; Tableau custody is acquired only after plan validation and never deletes unrelated or held data.
- Charts: reviewed, editable numeric chart exports alongside declarative refusals.
- Retention: protection changes are bound to the owner's exact review; every linked hold is checked before reconstruction erasure.
- Agents: protected owner agent activity history, policy parity for native machine reads, and Smartsheet reads stop when the owner's authority is revoked.
- Forms: company submissions keep actionable, keyboard-recoverable errors and recovery for oversized input.
- The owner email moved from plain Worker variables to secrets.

