# Changes

## 0.1.5

Bifocal can be set up by a company with no mail provider, and its agent door follows Base's current wiring. One migration is added (0074_bifocal_agent_door_relay.sql); the RER CLI pin is 0.2.144.

- Mail off: `MAIL_PROVIDER=none` (setup option "Turn off outbound email") runs with no sender and no key. The sign-in page offers no email form, `/auth/magic-link` and invitations refuse with `mail_unavailable`, and the owner signs in through `rer signin`. `MAIL_PROVIDER` and `MAIL_FROM` are public settings with empty defaults; `MAIL_API_KEY` is optional.
- Agent door: MCP discovery and initialization require a bearer credential; the body's protocol version is honoured on initialize and calls without a version header use 2025-06-18. The paired Business pulls its decisions from `POST /api/rer/agent-decisions` with a signed request. Signed policy renewal is enforced. A Business token is refused before a policy envelope binds the Business, and detaching the Business ends its token access, relay and held calls.

## 0.1.4

Bifocal's work since 0.1.3 (25 Oct), released so its demo opens current code. 38 migrations are added (0041_exploration_access.sql … 0073_tableau_migration_custody.sql, all listed in RELEASE.json); the RER CLI pin is 0.2.91.

- Sources: bounded, reviewed imports from Tableau, XLS, Smartsheet, HubSpot deals, Square order summaries, LookML, Looker Studio and Omni, each with custody proof; Tableau custody is acquired only after plan validation and never deletes unrelated or held data.
- Charts: reviewed, editable numeric chart exports alongside declarative refusals.
- Retention: protection changes are bound to the owner's exact review; every linked hold is checked before reconstruction erasure.
- Agents: protected owner agent activity history, policy parity for native machine reads, and Smartsheet reads stop when the owner's authority is revoked.
- Forms: company submissions keep actionable, keyboard-recoverable errors and recovery for oversized input.
- The owner email moved from plain Worker variables to secrets.

