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
later rollback or reactivation cannot revive them. Each successful data or
definition operation atomically consumes one operation; failed requests release
no result and do not consume budget. Concurrent requests cannot overspend.
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

`POST /api/v1/mcp` implements stateless JSON responses over Streamable HTTP for
protocol `2025-06-18`: `initialize`, the `initialized` notification in the `notifications` namespace, `ping`,
the `list` and `call` methods in the `tools` namespace. The `query` tool accepts the same query input and
returns both text content and `structuredContent` with identical results and
citations. Tool discovery requires `definitions`; execution requires `query`.
Claude, ChatGPT and Cursor protocol-edge clients are exercised by the journey;
no hosted client installation or account qualification is claimed.

The request limit is 65536 bytes; GraphQL source is limited to 8192 characters.
Errors contain a stable code without stack, bearer, source-cell contents or
hidden-object metadata. Invalid authority returns 401, disallowed tools or fields
403, invalid input 400 and current-state or budget conflicts 409. No response
starts a background job or sends a webhook.

## Remaining contract work

The conservative policy is current-owner sponsorship only, exact explicit human
review, one-day maximum expiry, bounded read operations, no delegation, no file
or Business import grants and no consequential approval or outbound action.
This new credential policy awaits ct approval; both clauses remain PARTIAL.
BIF-019, BIF-032, BIF-053, BIF-057 and BIF-069 retain their full receiving-door
authority and custody obligations. This does not approve a pending delegated
member policy.

Delegated principals and the explicit Business import settings opt-in, general
budgets, queued owner suspension and rotation, certified-metric APIs, model and
content management and report jobs, cancellation, concurrency and version
conflicts, signed lifecycle webhooks, replay and forgery rejection and durable
delivery history remain unbuilt or unproved. Queued analytical execution needs
Base BIF-058; this synchronous API does not substitute for it.
