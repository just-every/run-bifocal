# Native exploration access

The current owner can lend a named active native member read-only exploration of one exact published semantic view. Foundation membership and Library metadata grants alone grant no analytical data. This bounded BIF-019 implementation supports BIF-009; the complete permissions clause remains partial. The conservative delegation policy remains pending ct approval.

The owner uses the native session and same-origin JSON API. Review a definition with `POST /api/operator/explore/access/review`, then send the identical fields plus its returned `reviewedDigest` to `POST /api/operator/explore/access`. A changed recipient membership version, published model or source revision changes the digest and requires a fresh review. The review includes the exact source fingerprints. Creation records attributable consent; no automatic grant occurs.

Required fields:

- `operatorId` and `operatorVersion`: a named active native member, as returned by `GET /auth/operators`.
- `modelId`, `revision`, `viewId`: one currently published model view.
- `filters`: fixed server-appended row restrictions using the view's permitted dimensions. They cannot be removed by question filters or fiscal changes.
- `dimensions`: at most four permitted summary grouping and filter dimensions. A summary-only member cannot group or filter by other dimensions to obtain record identifiers.
- `underlying`, `summaryExport`, `underlyingExport`: explicit independent booleans. An underlying download additionally requires underlying read permission. Underlying read alone never grants a download.
- `expiresAt`: an explicit ISO UTC instant after now and within seven days.

The member opens `/app/questions`, selects its granted view and saves questions through the existing builder. Requests to `POST /api/operator/explore/run` include the `grantId` returned in the member's model catalog. Each saved question binds that grant and member. Questions created by another identity confer no access. Summary-only controls omit record drill and disable underlying selection. Download controls reflect the independent scope permission; direct requests enforce the same permission on the server.

Current session, linked identity policy, owner and member versions, grant activation, expiry, published revision and every source fingerprint are checked before execution and again in the D1 transaction fencing the response. Source replacement requires a new grant even for a retained question. No counts of unpermitted input rows or join matches are disclosed. Membership changes remove activation; reactivation never revives old grants. Grants and source-derived questions are withdrawn with source erasure. None of these grants authorizes file import, direct dataset access, model authoring, Undo, erase, AI, another API or a machine identity.

`GET /api/operator/explore/access` gives the owner the latest 200 definitions and audit events. `POST /api/operator/explore/access/<grant-id>/revoke` immediately removes activation and records revocation. Issue, question execution, saved reads, paging and downloads record the actor, grant fingerprint, action and time. Audit contains no source rows. Downloaded files remain outside installation custody.

Portable archives retain grant definitions and minimal audit facts; activation is excluded and requires a fresh exact owner review in the destination. This bounded rule does not qualify the complete fresh-owner archive journey under BIF-033.

Current limits remain 2,000 source rows, 30,000 CSV export rows and 150,000 XLSX export rows. Larger-source qualification, owner-lowerable caps, full export beyond those limits and ad hoc subject joining remain BIF-009 gaps. Pivots currently summarize one displayed page. CSV preserves the documented formula-text protection; XLSX retains typed values and refuses unrepresentable text or numerical precision.
