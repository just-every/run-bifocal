# Reviewed outbound row actions

The native JSON route `/api/operator/row-actions` supports bounded actions on
the current owner's existing regional input tables. It creates a Pegboard task,
updates an Orbit opportunity's title or stage, creates a HappyToHelp ticket, or
starts one tool in a Crank execution grant. It does not post ledgers, execute
payroll, send arbitrary HTTP requests, or implement BIF-077 report buttons.

Every request requires the current native owner's session. POST requests also
require the installation's exact `Origin`. Native members and administrators,
analytical read grants and machine credentials confer no authority here. A
Bearer header on the Bifocal request is refused even alongside an owner session.
Provider credentials are separate, one-request inputs; they are never retained.

Configure `BIFOCAL_ACTION_ORIGINS` as a JSON object mapping the enabled provider
names to their independently installed public HTTPS origins. For example, the
`pegboard` entry names your Pegboard installation. No path, port, credential,
query or fragment is allowed. Unconfigured installations refuse grants and
dispatch. This deployment allowlist never creates provider authorization.

## Grant, review, send and inspect

1. POST `/grants/review` with `tableId`, `provider`, `origin`, `target`, `fields`,
   `scope`, `expiresAt` and `accessToken`; Crank additionally requires the exact
   `workflowId` bound to its execution credential. Expiry is an ISO UTC timestamp with
   milliseconds within the next day. Review the returned definition and digest.
2. POST the same object to `/grants`, adding `reviewedDigest` and `confirm:true`.
   Save the returned `id`. This authorizes a bounded write scope, not an action.
3. POST `/review` with `grantId`, the exact `rowKey`, `inputVersion`,
   `schemaRevision`, `payload`, unique `requestRef` and the same `accessToken`.
   Orbit also requires the provider's current integer `providerRevision`.
   Review the returned source revision, destination and complete provider payload.
4. POST the identical action to `/send`, adding its `reviewedDigest` and
   `confirm:true`. Every field, credential, native session, source revision,
   input version and schema revision remains bound to that approval.
5. GET `/receipts/{id}` to inspect the outcome, source link, approving owner and
   timestamps. POST `/grants/{id}/revoke` with `confirm:true` to withdraw a grant.

`requestRef` is 1–120 ASCII letters, digits, underscores, dots or hyphens. Reusing
it with different contents refuses. The receipt claim commits before dispatch;
concurrent calls and identical replay never make a second provider write. A lost
response, timeout, incomplete provider result or interrupted sender remains
explicitly unresolved. There is no automatic retry or recovery that invents a
success. Inspect the provider before deciding on any new action. Redirects are
never followed and provider error text is never returned.

| Provider | Scope | Target | Permitted payload fields |
| --- | --- | --- | --- |
| `pegboard` | `task_create` | Project ID | Required `title`; optional `description` |
| `orbit` | `records:write` | Opportunity ID | `title`, `stage_id`; at least one |
| `happytohelp` | `conversations:create` | The credential's source product, normally `bifocal` | `requester:{external_id}`, `subject`, `body` |
| `crank` | `execution` | One tool's step ID in an execution grant | Explicitly granted literal scalar business inputs |

The grant's `fields` lists only permitted top-level payload fields. The provider
still checks its own live credential, scopes, sponsor, targets and policy. An
Orbit policy decision requiring another person's approval remains unresolved;
Bifocal cannot approve it. A HappyToHelp held request is not a created ticket.
A Crank queued, waiting, failed or uncertain run is not reported complete;
the receipt links its actual run. A succeeded run does not establish its
separate business outcome. Source links for REST actions point to the provider's
record API; Orbit returns its scoped MCP record resource URI with the configured
installation identified in the review.

## Provider contracts and proof boundary

The adapters and network-edge assertions use these provider-owned schemas:

- [Pegboard public work API](https://github.com/just-every/run-pegboard/blob/0ca845ad78ecec6c8d3ba7b7bb0d7815f7014193/docs/PUBLIC-WORK-API.md),
  and `src/pegboard/public-api/schema.ts`, `operations.ts` and
  `src/pegboard/api/public-routes.ts` at that revision: POST
  `/api/v1/public/tasks`, writable project key, exact `intent`, `{id}` result.
- [Orbit agent door](https://github.com/just-every/run-orbit/blob/47762e3e3173a0804126ed7032801bbbc9e7d46d/docs/AGENT-DOOR.md),
  `src/core/features/agent-door/records.ts` and
  `src/base/modules/agent-door/{registry,wire,pipeline}.ts` at that revision:
  MCP `2025-11-25`, `orbit.records.update`, `records:write`,
  `expected_revision`, `idempotency_key`, structured result and resource link.
  The older selected handoff delegation is not a deal-write credential.
- [HappyToHelp machine requests](https://github.com/just-every/run-happytohelp/blob/f149f7c9e814f1fc25b7558c900e3432ed117cb2/docs/api.md),
  `src/modules/api-integrations/{create-input,api-create}.ts` at that revision:
  POST `/api/v1/conversations`, `conversations:create`, `Idempotency-Key`,
  bound `source_ref`, 201 ticket response or explicitly held 202 response.
- [Crank HTTP contract](https://github.com/just-every/run-crank/blob/e9f591e5cb53ddf141a59cc6eb378874c6a96d82/docs/API.md),
  `src/crank/grants/tasks.ts` and `src/crank/workflows/{api,runs}.ts` at that
  revision: POST `/api/crank/agent-tasks`, separate execution bearer,
  `Idempotency-Key`, `task_id`, selected literal `actions`, and 201 run detail.

`tests/journeys/row-actions.mjs` (`proveRowActions`, invoked by push Verify)
uses the emitted Worker and real D1, native session, reviewed import and input
routes. `row-action-edge.mjs` substitutes only these provider HTTPS edges. The
assertions prove request bytes, refusal and receipt behavior; they do not qualify
live provider installations, accounts, policy issuance or delivery to recipients.

Grants and receipts are installation-local and excluded from archives. They
retain no action payload or bearer. Source erasure withdraws grants and provider
links, preserving only inert request fences. It sends no outbound deletion and
cannot recall external copies. Complete protected audit, inactive portability,
custody and erasure remain their original contract obligations; this bounded
door does not establish them or broaden the current-native-owner policy.
