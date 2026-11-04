# Bounded Jira work outcomes

The current native owner can open `/app/import`, choose **Read Jira work outcomes**, explicitly authorize site discovery, select one permitted site and enter its exact project ID and key. Supply a fresh OAuth bearer again and explicitly authorize the bounded project read. Each bearer is cleared after use. No bearer, refresh grant or provider error body is retained.

Discovery reads only cloud IDs, site URLs and scope strings from Atlassian's documented accessible-resources endpoint. Only sites with the classic `read:jira-work` scope are offered. Granular-scope qualification is unfinished. A read independently checks the selected cloud ID and site URL against the supplied bearer's current resources. A site name, avatar, imported identity or native machine credential grants no authority.

The adapter constructs one project-only JQL expression and GET requests to the documented OAuth gateway. It requests project, issue type, current status and created, updated and resolution timestamps, together with issue IDs and keys. It retains their safe scalar identities and names and an exact count of one per issue. Issue descriptions, comments, attachments, people, custom fields and decorative nested provider metadata are excluded from custody. Timestamps remain exact strings or null; this adapter does not create historical work periods.

At most 20 pages, 100 issues per page and 2,000 issues can be read. Each provider response is bounded to 1 MiB and 15 seconds; the staged CSV is bounded to 512 KiB. Pagination must terminate explicitly with `isLast`. Warnings, unknown fields, foreign projects or sites, duplicate identities, missing fields, repeated cursors and overflow refuse the entire read. Redirects, retries and arbitrary URLs or JQL are unavailable. Rate limiting and expired or revoked authorization produce redacted errors and preserve the last published dataset.

A successful read stages the existing shared import plan. It never publishes automatically. Review the exact fingerprint, approve, Apply and reconcile. A changed fingerprint requires fresh review. Current authority is rechecked at staging and Apply. Undo restores the prior snapshot. A complete zero-issue search is an explicitly mapped empty snapshot, never a deletion claim. Eligible source erasure removes controlled originals and derived native answers; existing legal holds and minimum retention remain effective. An erased dataset ID stays retired. External downloads and provider-retained copies remain outside this bounded erasure proof.

Jira search-index updates may be delayed. Browse-project and issue-security permissions filter the result. Missing issues establish neither deletion nor whole-project coverage. Current status and issue-type counts establish no staffing, capacity, headcount, labor cost or transition history.

## Official protocol

- [Jira REST v3 OpenAPI](https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json), version `1001.0.0-SNAPSHOT-f6ec623db665dba9a1a91d84931962d66514d7f3`, SHA-256 `5dc3ab3fb5735724ff4d815f2c8d776910dab5d7d6f97e11c224ddb0bf35aa72`.
- [Atlassian OAuth routing and accessible resources](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/): use `api.atlassian.com` with the selected cloud ID under `/ex/jira/`, never send the bearer to a supplied site URL.
- [Enhanced search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/) documents search-index delay, permission-filtered results and finite `nextPageToken` pagination.

The journey uses self-authored schema-derived HTTPS responses with synthetic credentials. It proves the bounded native import, query and custody flow. Live Jira authorization, app registration, marketplace or partner eligibility, provider consent, OAuth refresh, scheduled execution, complete histories and every remaining BIF-042 adapter remain unproved. BIF-002, BIF-038, BIF-019, BIF-035 and Base BIF-058 duties are unchanged. No payroll operation, additional read grant or queued execution is supplied.
