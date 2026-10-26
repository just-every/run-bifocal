# Reporting apps and Power BI app import

An owner packages reviewed dashboards, reports, questions and scorecards into a reporting app, publishes it as an immutable version and places it on the home of each person who currently belongs to one of its audiences. Everything is native and owner-authored at `/app/apps`; the JSON API lives under `/api/operator/apps`.

## Content and versions

- A page references one retained item: a published authored dashboard, a retained dashboard or report, a retained exact answer used as a question, or a goal used as a scorecard.
- Saving a draft never changes what readers see. **Review publication** freezes the exact queries of every page, runs each audience page under its own rules and returns a fingerprint; **Publish** requires that exact fingerprint. A later edit to the source dashboard, report or goal never reaches a published version.
- A rollback is a reviewed restoration: it appends a new version that carries an earlier version's document, so history reads version 3, a restoration of version 1, then 2 and 1.

## Audiences

- An audience names its pages, a landing page, row rules and an optional visible-column allow list. Row rules are equality or membership filters added to every query the audience reads; a rule that does not fit the data refuses the page.
- A visible-column allow list refuses any page whose grouping or measure columns fall outside it. Scorecard targets are company-wide, so an audience with row rules cannot receive a scorecard.
- Audiences may overlap. A member sees the union of their audiences' navigation, and each page opens under one audience's rules at `/app/apps/{app}/{audience}/{page}`; rows from different audiences are never merged.
- Readers get summary answers only. Underlying rows, downloads and source data are not part of an app.
- Navigation, search results and errors name only the audiences and pages of the signed-in member. An uninvited member and a missing app receive the same refusal.

## Membership, home and subscriptions

- Membership is live and immediate, bound to the member's current account version. Removing a member, deactivating them or removing an audience from a published version ends their home entry, saved links and subscriptions at once; reactivation and rollback never revive it.
- A subscription is a retained definition of one page for one audience. Delivery stays inactive until an analytical-job dispatcher exists (BIF-015 and BIF-058); a preview computes what the next delivery would contain under current access and sends nothing.

## Power BI app import

The importer reads one JSON envelope per app through Base's shared import door (`X-Import-Kind: power-bi-app`): plan, exact fingerprint, apply, reconcile, Undo and erase.

```json
{ "format": "power-bi-app", "version": 1,
  "app": { "id": "...", "name": "Regional performance", "description": "..." },
  "content": [ { "id": "r1", "type": "report", "name": "Sales detail" } ],
  "rowRoles": [ { "name": "West sales", "rules": [ { "table": "Sales", "column": "region", "operator": "=", "value": "West" } ] } ],
  "audiences": [ { "name": "Sales", "content": ["r1"], "landing": "r1", "rowRole": "West sales",
    "members": [ { "identifier": "person@example.test", "principalType": "User" } ] } ] }
```

- The envelope is assembled from the app, report and dashboard listings, the app audience members and the dataset row-level security role definitions.
- Only user principals that match a currently active member are proposed. Groups, applications and unmatched people stay unresolved. Only equality table filters translate; any other expression stays an unresolved issue and refuses draft creation.
- Review maps each Power BI item to a Bifocal content ID and each proposed person to an active member. Creating the draft stores mapped members inactive: nobody sees the app until a reviewed publication. No tokens, sessions or credentials are read or retained, and the original upload is erasable through the door.
- An audience without a row role is created with no row rules and is listed as unrestricted in the review.

## Held and inherited

The conservative defaults above (summary answers only, no additive row merging, no revival, inactive delivery) await ct approval. BIF-019 keeps full roles, group and attribute mapping and View as; BIF-025 keeps Tableau, Looker and Metabase importers, calculation and visual rebuilding and live cutover; BIF-015 and BIF-058 keep subscription execution.
