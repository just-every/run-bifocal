# Bounded machine query API

This is an initial read-only native API. It does not implement the complete
BIF-027 or BIF-035 contract. No machine credential grants raw source access,
file import, export, mutation, certification, human approval or outbound actions.
RER Business import remains disabled, including at first owner claim.

## Human issuance and custody

A current native owner session prepares `POST /api/operator/credentials/review`
and explicitly submits the returned digest to `POST /api/operator/credentials`.
Both requests use the installation origin, an `Origin` header and JSON. Bearer
credentials cannot use these administration routes, even alongside a cookie.
The body contains:

- `purpose`: a human-readable purpose, at most 120 characters.
- `modelId`, `revision`, `viewId`: one exact current published semantic view.
- `dimensions`, `measures`: explicit allowed dimension names and measure IDs.
- `filters`: immutable additional row restrictions. Request filters intersect
  these and the published view's filters and row rules.
- `tools`: a nonempty subset of `definitions` and `query`.
- `expiresAt`: an ISO UTC instant within the next 24 hours.
- `maxOperations`: an integer from 1 to 1000.
- `reviewedDigest`: required only for issuance, from the exact current review.

Only issuance returns the random bearer, once. Store it privately. The database
holds an installation-keyed hash, not the bearer. Never put it in a URL, logs,
git or Terraform state. `GET /api/operator/credentials` returns owner-only scope,
usage and attributed audit history without bearer material. Explicit human
issuance and revocation have distinct events from machine reads. Recognized
credentials also record a redacted denial event without requested fields or values.
`POST /api/operator/credentials/{id}/revoke` with an empty JSON object revokes it.
There is no reactivation endpoint. Rotation requires a new exact human review
and issuance, followed by explicit revocation of the old credential.

Current owner membership, role and version, exact model publication and source
revisions and content fingerprints fence every data response. Source or model
withdrawal and principal changes permanently revoke matching credentials; a
later rollback or reactivation cannot revive them. Each authorized data or
definition read reserves one lifetime operation before computation; a reserved
read remains consumed after failure or withdrawal. Refused responses release
no result. Concurrent requests cannot overspend.
Protocol schema and initialization contain no installation data.

Supported installation archives exclude the complete credential table and retain
attributed audit facts. Restore requires fresh human issuance. This does not
claim completion of Base's broader inactive-membership or fresh-owner restore.

## Version one doors

Use `Authorization: Bearer <private credential>` on the installation origin.
Cookies do not substitute for machine authority. If supplied, `Origin` must match.
Responses are uncached and use `nosniff` and sandbox headers.

`GET /api/v1/schema` documents the REST request shape and the actual GraphQL SDL.
`GET /api/v1/definitions` returns only the permitted view, allowed dimensions,
measure IDs and units, revision, scope digest and allowed tools.

`POST /api/v1/query` accepts this shape:

```json
{
  "modelId": "the-reviewed-model",
  "revision": "the-reviewed-revision",
  "viewId": "pipeline",
  "groupBy": ["stage"],
  "filters": [],
  "offset": 0
}
```

Model, revision and view must match the credential. Grouping and filter columns
must be explicitly permitted. Measures and fixed fiscal context come from the
reviewed view and credential, never caller SQL. Unknown properties refuse.
Results contain at most 25 grouped rows, whole-scope exact totals, `totalRows`,
`offset`, `nextOffset` and citations. Repeat with `nextOffset` until null.
Each page recomputes under the same immutable source and scope fences or refuses;
there is no hidden truncation or unrestricted source-row count. Citations include
model revision, view, source watermarks, exact definition hash, semantic version,
company revision, calendar and credential attribution. The query citation gives
the permitted query parameters, not hidden schema or raw source values.

`POST /api/v1/graphql` uses standard GraphQL with bound variables:

```graphql
query Pipeline($input: QueryInput!) {
  query(input: $input) {
    rows totals totalRows offset nextOffset citations query
  }
}
```

Send `query`, `variables` and optionally `operationName`. The schema also offers
`definitions`. One root query is allowed per request; mutations, fragments,
multiple operations and alias amplification across root fields refuse. Schema
discovery uses the explicit schema route. `JSON` fields preserve exact decimal
strings and typed query results without conversion to binary floating point.

`POST /api/v1/mcp` is an alias of the shared `/mcp` agent door. It negotiates
`2026-07-28` or `2025-11-25`; send the matching `MCP-Protocol-Version` header
(and the modern method/name metadata when using the modern era). Tools use
`bifocal.analytics.query`, `bifocal.analytics.definitions` and
`bifocal.analytics.status`. The shared handler requires answered company or
standalone owner policy in addition to the existing exact native read grant.
The registry describes available verbs; each call still checks its current
credential's explicit tools and native scope. See [Company agent access](AGENT-ACCESS.md)
for exact owner binding, capabilities, typed refusals, approvals and audit.

The request limit is 65536 bytes; GraphQL source is limited to 8192 characters.
Errors contain a stable code without stack, bearer, source-cell contents or
hidden-object metadata. Invalid authority returns 401, disallowed tools or fields
403, invalid input 400 and current-state or budget conflicts 409. No response
starts a background job or sends a webhook.

## Remaining contract work

The conservative policy is current-owner sponsorship only, exact explicit human
review, one-day maximum expiry, bounded read operations, no delegation, no file
or Business import grants and no consequential approval or outbound action.
CT approved this interim policy WITH RIDERS on 26 October 2026; both complete clauses remain PARTIAL.
BIF-019, BIF-032, BIF-053, BIF-057 and BIF-069 retain their full receiving-door
authority and custody obligations. This does not approve a pending delegated
member policy.

Delegated principals and the explicit Business import settings opt-in, general
budgets, queued owner suspension and rotation, complete API families and report
jobs, cancellation, signed lifecycle webhooks, replay and forgery rejection and
durable delivery history remain unbuilt or unproved. Bounded native APIs and
version conflicts now have the qualification described below. Queued analytical execution needs
Base BIF-058; this synchronous API does not substitute for it.

## CT rider implementation, 27 October 2026

CT approved the bounded interim policy WITH RIDERS on 26 October 2026 at
4172bc949853e320eec7073acdfe234cd576f7f9. The synchronized addenda in
CONTRACT.md and ACCEPTANCE.md govern this door. Both complete clauses remain
partial.

A current native owner can review a bounded machine source restriction with
`POST /api/operator/credentials/sources/{dataset}/review` and apply it with
`POST /api/operator/credentials/sources/{dataset}`. Read its current definition
and version with GET on the latter path. Bodies contain `previousVersion`,
explicit `columns` and typed `filters`; apply also requires the returned
`reviewedDigest`. Review binds the exact source bytes, revision, prior policy
version and current owner session. A stale policy write returns 409. Missing
policy records add no restrictions to the current owner's source access;
issuance still requires exact owner review of each source and permitted field.
An empty column list refuses any query depending on a source column.

Every participating source's current restrictions intersect the published view
and credential restrictions before aggregation. A restricted joined source
cannot release unmatched rows through null joins. Hidden source columns cannot
be selected, filtered or used by a permitted measure. Definitions remain limited
to the credential's permitted fields. This bounded machine source control does
not qualify full enterprise sensitivity labels, source entitlements or tenant
role inheritance under BIF-019, BIF-055 and BIF-071.

Source policy versions and digests join the exact credential binding. Changing a
policy permanently retires matching credentials, including when the policy is
later restored. Policy definitions travel in supported archives; credentials do
not. Erasing a published source removes its bounded machine policy. Broader
retained-custody erasure and fresh-owner archive qualification remain open.

Operations reserve a lifetime read atomically before query computation. Each
page or definitions read consumes one shared operation across REST, GraphQL and
MCP. A reserved operation remains consumed if execution fails or authority is
withdrawn before release; a request refused before reservation consumes none.
Static protocol discovery does not consume a data read and cannot add tools.
MCP query discovery also works for a credential reviewed only for queries.
The response transaction rechecks activation, current sponsor, fixed expiry,
model, every source and policy binding before releasing any data. Automatic
retirement records a durable attributed event. Source Undo, model rollback,
policy rollback and native owner reactivation never revive an old credential.

## Versioned native owner APIs

The `/api/v1/native/` namespace requires a current native owner session. A
machine bearer is refused even when accompanied by a native cookie. Browser
mutations retain the exact installation Origin requirement. These APIs use the
application handlers and their current authority, exact human review, source
fences and optimistic version checks.

REST families are `models`, `metrics`, `metric-definitions`, `content` and
`report-runs`. Append the same resource suffix and use the same method and JSON
body as the corresponding native operator route; `content` maps to the native
library. These expose the existing bounded implementations, including metric
certification and exact values, model branch revisions and catalog metadata.
They do not implement general analytical jobs or additional reporting formats.

`GET /api/v1/native/schema` supplies the GraphQL SDL and family paths.
`POST /api/v1/native/graphql` accepts `query`, bound `variables` and optional
`operationName`, with one root operation per request. Queries read a model,
metric, metric list, content item or filtered content search. Mutations create
or edit model branches, metric drafts and content metadata. JSON payloads pass
through the same native validators. Model edits require `previousVersion`,
metric proposals require `previousRevision`, and content edits require
`previousVersion`. Conflicts return 409 without a partial edit. No machine
approval or additional authority is created by choosing GraphQL.

The machine-door journey proves native REST and GraphQL parity, certified money,
stale edit refusal, one winner for concurrent model edits, and bearer and
foreign-origin refusal. The complete BIF-027 API and client target, analytical
job cancellation, queued rotation and revocation, signed lifecycle webhooks,
forged-event refusal, replay and durable delivery history remain open.
