# Bounded native entitlements

BIF-071 is partial. This native prerequisite narrows an existing current,
owner-reviewed exploration grant. It creates no membership, delegation, machine
credential, tenant authority or source grant. CT approved this additional
restriction with riders on 27 October 2026. Only the current native human
installation owner reviews and publishes it; only an active verified native
session consumes it. BIF-071 and BIF-019 remain partial; the exact policy ruling,
additional acceptance and remaining Gap are synchronized in CONTRACT.md and
ACCEPTANCE.md.

Import the two governed CSV tables through the existing `/app/import` review,
approval and apply workflow. Mapping columns are `principal`, `role`, `value`,
`valid_from` and `valid_until`. Hierarchy columns are `principal`, `manager`,
`valid_from` and `valid_until`. The date columns use the file door's explicit
US date interpretation; stored values are ISO civil dates. Intervals include
the start and exclude the end; a null end is open. Every active row must be
well formed. A cycle anywhere in the active hierarchy or two active managers
for one principal refuses the snapshot. Managers inherit descendants' mapping
rows. All active roles union their values in one text dimension. Existing
model filters, grant filters, permitted fields and export permissions still
intersect with that union. A missing effective mapping denies access.

The authenticated owner uses these JSON endpoints with the native same-origin
session and Origin header:

- POST `/api/operator/explore/entitlements/review`
- POST `/api/operator/explore/entitlements/publish`
- GET `/api/operator/explore/entitlements/<modelId>/<viewId>`

Review receives `definition` and `previousRevision` (null initially). The
exact definition fields are `modelId`, `viewId`, `column`, `mapping`, `hierarchy`
(null without a hierarchy), `normalization` and `maxAgeSeconds`. Choose `exact`
or `ascii-lowercase` normalization explicitly. Neither mode trims whitespace,
infers provider aliases or trusts a browser-supplied identity. An ambiguous
normalized active membership is refused, including at execution time.

Publish repeats the input with the returned `reviewedDigest`. The digest binds
the current model, exact source revisions and expected previous policy version.
One transaction checks those references and current normalized identity
uniqueness, advances the current version and keeps its immutable definition
history and attributed audit. Concurrent or stale
reviews refuse. The GET endpoint exposes this version history to the owner;
it returns source references, never source records.

Every delegated exploration run, saved-result read, page, export plan and CSV
or XLSX download rechecks the current policy, native authority, source revisions
and security freshness. Freshness is measured from the source publication time,
not from the review time. Effective dates use the server's UTC civil day; saved
results must be reopened with a fresh run after that day changes. The response
transaction checks source custody, policy version, the principal bound to the
current native operator, identity uniqueness, current day and freshness again. A newly introduced policy also withdraws earlier broad
saved results. Discovery excludes old-policy results and counts.

Reimporting a changed mapping immediately denies reads until the owner reviews
and publishes the replacement snapshot. Publication never silently reuses an
older source revision. Reassignment withdraws old retained results and export
plans. Downloaded files already on a person's device cannot be recalled.
Erasing a feed leaves the policy fail closed; it does not remove the restriction.

Named refusals include `entitlement_feed_missing`, `entitlement_feed_stale`,
`entitlement_snapshot_changed`, `entitlement_mapping_missing`,
`cyclic_entitlement_hierarchy` and `ambiguous_entitlement_principal`.

This does not translate Power BI, Tableau or Looker security, qualify a real
source estate, implement all role expressions or masked-column policies, or
provide queued subscriptions. Dashboard, AI, add-in and embed entitlement parity
and complete source-to-target cutover comparison remain unproved. No new door
inherits authority from this bounded implementation. Full BIF-071 acceptance,
including at least thirty source-verified identities per estate, remains due.
