# Agent access

Bifocal currently exposes bounded owner-sponsored machine reads through
`/api/v1/definitions`, `/api/v1/query`, `/api/v1/graphql` and `/api/v1/mcp`.
A current native owner must review and issue each credential through the
native credential administration API. A protocol listing conveys no authority.

Each grant binds one published model revision and view, exact source revisions,
fixed row restrictions, permitted dimensions and measures, read tools, expiry
and a shared lifetime operation limit. Request filters can only narrow this
scope. REST, GraphQL and MCP consume the same counter. A revoked, expired,
exhausted or changed grant refuses further reads; rollback does not revive it.
Raw sources, originals, underlying downloads, mutations, credential management,
consequential approval and outbound actions are outside these credentials.
See BIF-027 and BIF-035 in [the contract](../CONTRACT.md).

The shared Base agent door runtime and Business settings schemas are available
as recorded source for adoption. They are not yet mounted in the production
Worker. This source preparation does not enable Business tokens, policy adoption,
`/agents`, new resources or a second MCP dispatcher. Existing native sessions,
Origin checks, human review and credential restrictions remain authoritative.
First owner claim and archive restore do not opt into Business import.

Completing adoption requires a verifier binding lifecycle that can drive native
human review and credential issuance for the harness's actual agent and consent.
The pinned verifier's owner initializer runs before those identities are created;
it returns only the owner's bootstrap response. Native grant review cannot be
replaced by a fixture account, direct SQL or an unrestricted owner adapter.
Until that lifecycle is available and the full shared-door journey passes,
shared company-agent access is unproved and the contract remains partial.
