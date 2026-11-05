# Company agent access

Bifocal uses Base's shared agent door at `/mcp`, with `/api/v1/mcp` as an alias
of the same handler. Both negotiated eras, `2026-07-28` and `2025-11-25`, use
one registry, signed company policy, native approval, Pause and audit pipeline.
Discovery uses MCP `server/discover` and canonical metadata at
`/.well-known/oauth-protected-resource/mcp`; policy and named-person approval activity
are at `/agents`. The runtime and manifest declare only tools, policy, pause,
audit and idempotency. Events, public resources, prompts and subscriptions are
explicitly unavailable. This subset does not qualify queued work, multiple
sponsors, hosted lifecycle timing or the full analytical agent product.

The current CT-approved boundary remains native-owner-sponsored read access.
An owner first reviews and issues a credential through Settings, binding one
published view, current source identities and revisions, fixed row restrictions,
explicit dimensions and measures, selected read tools, an expiry within one day
and a lifetime allowance of at most 1000 reads. REST, GraphQL and MCP share that
same counter and native query engine. Data reads reserve before execution and
recheck native owner membership, source, model, credential and policy state
inside the response transaction.

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

## Owner activity history

From **Settings → Your settings → Manage machine credentials**, choose
**Browse agent activity** at `/app/settings/agent-activity`. This human-only
page uses the existing `/agents/api/audit` person API; it adds no machine tool,
scope or execution authority and leaves the shared Agents policy page unchanged.
A current native owner session is required on every request and is checked
again after the history has been read. Anonymous callers, other roles and any
Authorization header, including a machine bearer accompanied by owner cookies,
are refused. History and downloads use private no-store responses.

Choose **From (UTC)** and **Through (UTC)** for inclusive whole UTC days,
an exact **Agent ID**, and a **Class**, or leave the latter two unrestricted.
The default period is the current day and six preceding days. The selected
action total and counts by class and decision are computed from the selected
recorded actions. An action with several classes counts once in each class and
once by decision. Names and attribution are those recorded at the action,
including after agent revocation; revocation does not erase the audit.

The viewer follows the public API cursor until it stops, even when an agent
or class filter produces an empty intermediate page. Display pages contain
50 actions in recorded sequence order. **Recorded fields** opens every field
returned by the person API: agent identity, name and specialist; sponsor and
attribution; client, operation and trace; grant consent and scopes; tool and
target; classes and facts; policy revision and rules; decision, outcome and
refusal; approval and review people; idempotency and replay references.
**Export complete JSON** downloads all selected records with the selected
period, filters and reconciled counts, including empty selections. It preserves
the API's recorded fields rather than reconstructing attribution from the
current agent list. Tool outputs, source rows and bearer material are not
captured. Policy replay differences are separately disclosed for the scanned
agent and class scope, which can extend beyond the selected dates.

Each request is bounded to 50 source pages of 200 records, 1000 selected
actions and 2 MiB of complete JSON. One terminal cursor probe may follow the
50 source pages. These are request capacity bounds, not company policy or a
daily action allowance. Exceeding any bound refuses the request with HTTP 413
and no complete counts, download attachment or truncated record list. Narrow
the period, agent or class and retry. Invalid filters return HTTP 400; an
unavailable audit returns HTTP 503, retains the chosen filters and offers retry.
A failed JSON export returns `complete: false`, never a partial success.

Each traversal reads the current public audit records, including current
approval and review marks. It does not freeze concurrent activity or promise
an immutable audit snapshot across separate requests. Counts in each successful
response reconcile to exactly the records in that response.

This history slice does not establish write auditing or reversible-write Undo,
broader role and sponsor visibility, Business aggregation, future resources,
events or subscriptions, timed lifecycle, providers, queued analytical work,
complete retained-client custody and erasure, or inactive fresh-owner restore.
Those existing contract gaps and Base dependencies remain in force.
