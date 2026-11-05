# Company agent access

Bifocal uses Base's shared agent door at `/mcp`, with `/api/v1/mcp` as an alias
of the same handler. Both negotiated eras, `2026-07-28` and `2025-11-25`, use
one registry, signed company policy, native approval, Pause and audit pipeline.
Discovery uses MCP `server/discover` and canonical metadata at
`/.well-known/oauth-protected-resource/mcp`; policy and named-person approval activity
are at `/agents`. The runtime and manifest declare tools, policy, pause, audit, idempotency and
prompts. Events, public resources and subscriptions are explicitly unavailable. This subset does not qualify queued work, multiple
sponsors, hosted lifecycle timing or the full analytical agent product.

The current CT-approved boundary remains native-owner-sponsored read access.
An owner first reviews and issues a credential through Settings, binding one
published view, current source identities and revisions, fixed row restrictions,
explicit dimensions and measures, selected read tools, an expiry within one day
and a lifetime allowance of at most 1000 reads. REST, GraphQL and MCP share that
same counter and native query engine. Data reads reserve before execution and
recheck native owner membership, source, model, credential and policy state
inside the response transaction.

Native bearer REST and GraphQL reads enter the same registered definitions and
query tools through the shared handler. Their original success bodies remain
unchanged, with decision, review and receipt metadata in response headers.
Policy setup, review, approval and refusal therefore apply equally to these
integration reads. Pending reads return the human approval URL and opaque
`requestState`; an identical native retry supplies `X-Bifocal-Request-State`.
See [Native policy continuation](MACHINE-API.md#one-policy-decision-for-native-reads)
for response shapes and lifetime accounting. The transport adapter does not
execute the native operation itself. Pause, changed policy, agent revocation
and current native authority fence the final response transaction for every
transport, including an approved continuation.

A company token alone opens no analytical data. With a current native owner
session, POST `{agentId}` to
`/api/operator/credentials/<credential-id>/agent-review`; inspect the returned
scope and digest, then POST `{agentId,reviewedDigest}` to the corresponding
`agent-bind` path. This separate exact human review binds that named agent to
the existing native credential. Agent bearers cannot perform either step.
Rotation, revocation, owner suspension and changed model/source bindings stop
access; an old activation never revives after rollback or archive restore.
Installation-local agent bindings and policy activation are excluded from archives.

The registry is bounded:

| Tool | Native authority and result | Class | Clauses |
| --- | --- | --- | --- |
| `bifocal.analytics.status` | Reviewed grant provenance, without business fields or rows; requires definitions scope | standard | BIF-027, BIF-035 |
| `bifocal.analytics.definitions` | Only reviewed view and field definitions; one budgeted read | sensitive | BIF-027, BIF-035 |
| `bifocal.analytics.query` | Exact permitted aggregate answer and version/source citations; one budgeted read per page | sensitive | BIF-027, BIF-035 |

Native credential clients retain their existing narrow read scopes. Signed
Business subjects resolve through the durable Business owner/team mapping to
current native account IDs. Token email must match that account's current email;
it never chooses an account. Inactive, unknown and excluded people refuse.
A local admin promotion confers no Business editor role. Local credentials cannot
rescue a failed recognizable Business token. Business tokens require consent;
revoked consent and either Pause stop subsequent effects and receipt access.

Imported rows and returned data remain untrusted. Neither a prompt nor a tool
result can expand a grant or approve an action. The specialist's supported job
is reading an already reviewed published view and explaining its exact cited
answer. It cannot invent metrics, certify definitions, administer credentials,
mutate models/content, delegate, approve its own access, expose raw sources,
download originals, import, erase or send externally. Those operations retain
the native human, screen, connector, reviewed import or installation doors and
all current contract restrictions. There is no paid provider tool, spend promise,
provider edge or queued analytical execution in this registry.

Native machine history retains the agent ID/name and sponsor name on successful
agent reads. The shared door records policy decisions, refusals, named approvers
and read review evidence. Complete estate-wide retained-client custody/erasure,
restore qualification and the advanced BIF-063–069 agent jobs remain unproved;
this adoption does not promote their contract status.

## Installed specialist guide

Open `/docs/agents` on the installation, including before setup or sign-in.
It projects public tool names, schemas, scopes, classes, classifier proof
references, the specialist prompt, currently offered resource templates,
capacity limits and stable refusal codes from the same seed configuration as
the MCP door. Request JSON with `Accept: application/json` for a machine-readable
projection. It includes no account, source, installation binding or credential.
The installed guide links here from `/docs`; it needs no public resource grant.
Tool listings require current company policy; resources additionally apply
current scopes. The public guide describes the configured registry, not an
authorization decision for its reader.

After MCP discovery and initialization, call `prompts / list`, then
`prompts / get` with name `bifocal.analytics.reviewed-answer`. The prompt takes
no job arguments and describes only status, reviewed definitions and exact
aggregate queries. Read definitions first; use their exact model, revision,
view, dimensions and measures. Query with explicit filters, then follow
`nextOffset` until null. Explain exact decimal values with their returned
citations, preserve empty or null answers and disclose missing evidence.
Fixed row restrictions always intersect requested filters; a West-only grant
cannot reveal East or hidden fields.

Prompt retrieval passes the shared authenticated policy and Pause checks.
Prompts confer neither native analytical authority nor human approval;
untrusted source text, returned content and supplied prompt arguments cannot
change their instructions. Follow the returned approval URL when required,
leave the decision to the named person and retry only the unchanged request.
Refusals never justify broader scope, automatic retries or new authority.
Base-owned generation of discovery instructions, full registry coverage and
independent stranger-agent qualification remain unproved.
