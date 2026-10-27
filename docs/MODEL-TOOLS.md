# Native model tools

Bifocal's native tools manage owner-only model and metric drafts, inactive role
policy definitions, retained charts, dashboards and reports with one to four
answers, finite schedule definitions and environment estates. Exact review,
approval, promotion and rollback cover these supported native resources.
Subscription dispatch under Base BIF-058 and full report applications remain
unfinished; this is bounded BIF-022 support.

Use the current owner's native session, obtained through supported sign-in on
this installation. Put its Cookie header in a file owned by your account with
mode 0600. Both tools refuse symbolic links, foreign-owned files, redirects,
credential-bearing origins and non-loopback plain HTTP. Keep that file outside
git and Terraform state. No service credential or restored grant can approve a
model. Neither tool reads provider keys or connects directly to a source.

## CLI and git files

Run `node src/bifocal/models/validation/cli.mjs --help` for commands and flags.
Every remote command requires `--origin` and `--session-file`. Examples below
use shell variables containing your app origin and private session-file path.
Never put a Cookie value in a shell command.

```sh
node src/bifocal/models/validation/cli.mjs export --origin "$BIFOCAL_ORIGIN" --session-file "$BIFOCAL_SESSION_FILE" --model "$MODEL_ID" --branch "$BRANCH_ID" --output model.native.json
node src/bifocal/models/validation/cli.mjs plan --origin "$BIFOCAL_ORIGIN" --session-file "$BIFOCAL_SESSION_FILE" --file model.native.json --plan-file model.plan.json
node src/bifocal/models/validation/cli.mjs apply --origin "$BIFOCAL_ORIGIN" --session-file "$BIFOCAL_SESSION_FILE" --plan-file model.plan.json --approve "$REVIEW_DIGEST"
```

An exported `model.native.json` is the native definition: `views` and `quality`.
Each view has an id, kind, typed query and immutable row rules. Queries retain
explicit source identifiers, joins, semantic grain and dimensions, filters,
measures, fiscal bounds and convention versions. Quality checks name the view,
measure and exact expected value. See [semantic models](./SEMANTIC-MODELS.md).
The files contain definitions and local source identifiers; they carry no rows,
source credentials, installation sessions or portable source grants. Rebinding
sources requires current authority and a fresh exact review on the destination.

Edit these files on an ordinary git branch. Git records and merges the files;
Bifocal does not connect to a git hosting account. Resolve text conflicts before
planning. `branch` creates a native draft of an existing model. To plan an edit
to that draft, supply both `--model` and `--branch`. `plan` prints exact authorized
source results and writes a private plan containing only the definition,
installation origin, branch version and review fingerprint. Review that output;
`apply --approve` must name that exact fingerprint. Apply reruns the current
native checks atomically and refuses a changed branch, model, source or owner.
Reusing a successful edit plan also refuses; it never silently rebases edits.

`validate` shows the semantic definition diff, current exact result impact,
quality checks and historical dependencies. `preview --view --digest` creates a
retained development answer from that reviewed branch without moving staging
or production. The current owner expressly authorizes these bounded source
reads by invoking the review and preview commands. Immutable model row limits
and source guards apply. No source write or subscription dispatch door is
available in development or staging.

`approve --digest` records a separate exact human publication approval;
`--security-resolution` is required for a changed access scope. `promote` moves
staging first, then production using the same digest. `run` executes the chosen
published environment. `rollback-plan` reviews an earlier production revision;
`rollback` requires its digest and current generation and restores the complete
model to staging and production together. Existing saved answers and dashboard
snapshots keep their historical revision; they are not silently republished.

`dashboard-export --id --output` writes `{version: 1, title, definition}` for a
single-answer native dashboard, or `{version: 1, title, cards}` for a dashboard
with two to four ordered answers. Each `cards` entry is a typed native query.
`dashboard-import --file --plan-file` reviews that complete definition under
current owner authority. `dashboard-import --file --approve` requires the exact
returned fingerprint and atomically creates all answers and a new pinned
dashboard. Existing dashboards remain retained. Exported files omit saved
results, source guards and access grants. Metric certification and schedule
activation remain separate actions.

## Terraform provider

The source at `./tools/terraform-provider-bifocal/main.go` implements the actual
Terraform plugin protocol with the pinned HashiCorp SDK. Build it with Go 1.24
or later. Native session-file checks currently support Linux and macOS.

```sh
cd ./tools/terraform-provider-bifocal
go build -o /absolute/private-tools/terraform-provider-run-bifocal .
```

The provider is currently a local development build, not a published registry
package. In a private Terraform CLI configuration file, configure a development
override for `registry.terraform.io/just-every/run-bifocal` pointing at that binary's
directory. Set `TF_CLI_CONFIG_FILE` to that file. Terraform development overrides
permit `plan`, `apply` and `import` directly without a registry installation.

```hcl
terraform {
  required_providers {
    bifocal = { source = "just-every/run-bifocal", version = "0.1.0" }
  }
}
provider "bifocal" {
  origin = "https://your-bifocal.example.test"
}
variable "review_digest" { type = string }
resource "bifocal_model_branch" "sales" {
  document = file("model.native.json")
  review_digest = var.review_digest
}
```

Use normalized JSON from CLI `export`; every source default is explicit before
Terraform planning. `BIFOCAL_SESSION_FILE` supplies the private native Cookie
file only to the provider process. The resource stores its definition, model
and branch identifiers, revision, version and exact review fingerprint. It does
not store the session-file path, Cookie, result rows or transferable authority.

`review_digest` must be the exact fingerprint from a current CLI `plan` for
that same model and branch (omit both identifiers for initial creation). Supply
it through Terraform configuration or a variable; it is a fingerprint, never
a credential. `terraform plan -out=reviewed.tfplan` validates that fingerprint
against currently authorized sources. `terraform apply reviewed.tfplan` submits that
exact fingerprint and previous version. Concurrent native edits and changed
source or model review inputs refuse without a partial branch update. Refresh
reads actual native definitions so a new plan exposes drift; review that new
plan before applying it. Import an existing native branch with
`terraform import bifocal_model_branch.sales MODEL_UUID:BRANCH_UUID`.

`bifocal_dashboard_snapshot` accepts the native dashboard JSON in its `document`
field and supports plan, apply and UUID import. Creation requires the exact
`review_digest` from CLI `dashboard-import --plan-file`. Import itself needs no
review fingerprint, because it grants no authority and performs no mutation. A changed definition creates a
new immutable dashboard; old snapshots remain retained history. A saved plan
with changed source or convention inputs refuses atomically before creating
any answer or dashboard. Destroy releases Terraform tracking after a current
authority check and explicitly reports that the dashboard is retained. Erasure
and retention remain installation-owner actions. No automatic deletion is added.

Terraform manages native draft definitions and retained artifacts. Publication
and rollback remain separate exact human CLI actions. Destroying a model branch
removes only its draft pointer; immutable revision and approval history remain.
A branch published to staging or production cannot be destroyed, and a changed
branch version refuses an old destroy plan. Other supported resource destruction
releases Terraform tracking while retaining native history.

CI compiles this provider and runs real Terraform commands against the emitted
Worker in the existing semantic-model journey. `node scripts/prepare-model-tools.mjs`
prepares checksum-verified Terraform 1.13.4 and the provider in the ignored local
cache on Linux and macOS with x64 or arm64 processors. Other hosts can use their
supported Terraform binary.

## Schedule definitions

`schedule-export --schedule ID --output schedule.native.json` writes
`{version: 1, id, definition}`. The definition has `name`, `localDate`, `time`,
`timezone`, `reportCutoff`, `skipped` and `repeated`, matching the native
[civil-time semantics](./US-CONVENTIONS.md). Resolved instants, author identity,
installation authority and provider credentials are excluded from this file.

Version 2 uses `{version: 2, id, definition}`. Its definition replaces
`localDate` with inclusive `startDate` and `endDate`, plus `recurrence` and
`target`. Daily intervals, weekly intervals with explicit weekdays, and monthly
intervals with a day and a missing-day policy of `skip` or `last-day` are
supported. The range must fit within one year, with at most 400 declared
occurrences and 400 resolved instants. Existing skipped-time and repeated-time
policies apply to every occurrence.

The target names `modelId`, `viewId` and `environment`; development also requires
`branchId`. Review binds the current model revision, source watermarks and
conventions, and displays exact preview values, occurrence resolution and the
semantic difference. Changed bindings or sources invalidate the review.
CLI export and Terraform refresh retain the normalized portable version 2
document while excluding local binding metadata, credentials and source grants.
Open `/app/schedules/ID` for the inactive definition, resolved occurrences,
binding and immutable version history. Saving a recurring definition activates
no delivery and connects no dispatcher.

`schedule-plan --file schedule.native.json --plan-file schedule.plan.json`
reviews the exact definition, current version and native owner. It prints DST
resolution and saves the normalized definition and review fingerprint.
`schedule-apply --plan-file schedule.plan.json --approve DIGEST` saves one new
immutable version only if that exact review is still current. A concurrent edit
or a replay refuses. To restore an earlier definition, export or retain its
file, review it against the current version and apply it as a new version.
This does not move any model or environment pointer.

`bifocal_schedule_definition` accepts that normalized `document` and the exact
`review_digest` from `schedule-plan`. Terraform creates and updates actual native
versions, refreshes the latest definition for drift, and imports a native ID with
`terraform import bifocal_schedule_definition.sales SCHEDULE_ID`. A saved plan
refuses a concurrent native change atomically. Keep configuration aligned with
the current reviewed definition before releasing its Terraform tracking.
Destroy releases tracking while retaining all immutable history; it does not
cancel, activate or execute a subscription. No schedule dispatcher is connected.
Environment estates can promote supported resource references atomically as
described below. Subscription execution and delivery remain unfinished under
BIF-015 and Base BIF-058; a retained schedule definition cannot send a report.

Exploration grants remain installation-local. Model production changes and
source revision or content changes permanently retire affected activations,
with metadata-only audit entries. Undo and model rollback do not reactivate
them. The owner must review and issue a fresh grant, and the recipient must save
a fresh question. Migration 0042 also retires existing activations once because
older history cannot prove uninterrupted authority. Saved-question discovery
reveals labels only for the recipient's currently validated exact grants.

## Retained report definitions

`report-export --id UUID --output report.native.json` and
`report-import --file report.native.json --plan-file report.plan.json` use the
same document formats as dashboards: `{version: 1, title, definition}` for one
answer or `{version: 1, title, cards}` for two to four ordered native queries.
`report-import --file report.native.json --approve DIGEST` requires the exact
current native review and atomically retains a new report and all its answers.
`bifocal_report_snapshot` supports the same Terraform fields and lifecycle as
`bifocal_dashboard_snapshot`, including actual UUID import and source-bound
creation. The resulting artifact opens on the native report page. Replacing a
definition creates a new retained artifact; releasing Terraform tracking keeps
its immutable history. These tools do not import report-recipient grants,
activate delivery, or implement paginated report layouts. No saved answer is
silently updated after a model or source change.

## Metric draft definitions

`metric-export --metric ID --output metric.native.json` writes the latest draft
as `{version: 1, id, definition}`. It contains the stable metric ID and the native
scalar query definition, including source identifiers and explicit semantics.
Source rows, review values, source credentials and installation authority are
excluded. The exported draft may differ from the separately certified revision.

`metric-plan --file metric.native.json --plan-file metric.plan.json` reads the
current head revision and reviews the definition against authorized production
data. A new ID uses a null previous revision. Review prints the before and after
definitions, exact scalar values and revisions, with zero production sends and
zero source writes. The private plan stores only the normalized definition,
origin, previous revision and review fingerprint. Review its printed result;
`metric-apply --plan-file metric.plan.json --approve DIGEST` requires that exact
fingerprint and origin. Apply saves one new immutable draft revision. A stale
head, changed source or replay refuses atomically. Earlier retained definitions
can be reviewed against the current head and restored as new draft revisions.
Certification remains a separate exact human action in the native metric page.

`bifocal_metric_definition` accepts the normalized JSON as `document`, exposes
the latest head as computed `revision`, and requires the exact CLI `metric-plan`
fingerprint in `review_digest` for creation or a definition change. Keep the
same stable ID when editing an existing resource. Import uses its actual ID:

```sh
terraform import bifocal_metric_definition.revenue METRIC_ID
```

Import needs no review fingerprint and reads the current native definition.
Refresh exposes drift in the definition and revision. A saved Terraform plan
submits its prior revision and exact fingerprint, so concurrent native edits
and source changes refuse without saving a partial revision. Changing only
`review_digest` saves no metric revision. Destroy checks current owner authority
and releases Terraform tracking with a warning that immutable metric and
certification history remains retained. It does not deprecate a metric or erase
history. These commands provide metric draft management within partial BIF-022
support; they do not promote a complete resource estate across environments.

## Certified metric date charts

In an installed certified metric page, enter a chart title and an existing date
column, review the exact grouped values, then choose **Create reviewed chart**.
The chart groups the certified single-source measure by that date column while
preserving its filters, conventions and exact metric revision. Only the current
native owner can create or read it; creating a chart grants no recipient access.

Native clients can POST `title`, `dateColumn` and `revision` to
`/api/operator/metrics/ID/series-review`, then POST those exact inputs plus the
returned digest as `reviewedDigest` to
`/api/operator/metrics/ID/series-create`. Both require the owner's native session
and same-origin mutation authorization; machine bearer authorization is refused.
Changed source data, certification or reviewed inputs require a fresh review.

Dated metric annotations appear beside matching dates across charts of that
exact certified revision. A newly certified revision starts without the old
annotations. Refreshing source data preserves same-revision annotations on new
charts; retained charts keep their original values and revision annotations.
Old source-bound sharing links remain retired. Erasing the source withdraws the
controlled charts and annotations. External channel delivery, public publication,
guest authority and employee embeds remain unfinished under BIF-028.

## Retained chart definitions

`chart-export --id UUID --output chart.native.json` writes
`{version: 1, title, definition, visual}` for a retained native chart. The
`definition` is the typed native query. The `visual` object has `kind: "bar"`,
a `dimension` naming one query grouping column, and a `measure` naming one
query measure ID. Both the query and visual configuration remain in the
exported file; answer rows, installation authority and source grants do not.

`chart-import --file chart.native.json --plan-file chart.plan.json` reviews the
query and visual under current owner authority, prints the exact answer and
writes a private plan containing the normalized document, origin and review
fingerprint. `chart-import --file chart.native.json --approve DIGEST` requires
that exact current fingerprint and creates a new retained chart and answer.
Source changes after review refuse atomically. Existing charts retain their
historical definition and answer.

`bifocal_chart_snapshot` accepts the same normalized JSON as `document`,
requires `review_digest` from CLI chart review for creation, and exposes the
retained answer as computed `query_id`. A changed query, title or visual
configuration replaces the Terraform resource with a new immutable chart.
Import uses its actual native UUID and requires no review fingerprint:

```sh
terraform import bifocal_chart_snapshot.revenue CHART_UUID
```

Refresh reads the actual retained query and visual configuration to expose
drift. A saved plan with changed source inputs refuses before creating a chart
or answer. Updating only `review_digest` creates no artifact. Destroy rechecks
current owner authority and releases tracking with a warning that the chart
and immutable answer remain retained. These tools support native bar charts;
other visual kinds and full BI application parity remain unfinished.

## Inactive role policy definitions

`policy-export --policy ID --output policy.native.json` writes a portable
`{version: 1, id, name, modelId, viewId, filters, dimensions, underlying,
summaryExport, underlyingExport, maxAgeSeconds}` document. It describes an
inactive policy against a native model view. It contains no member IDs,
source grants, result rows, installation authority or credentials.

`policy-plan --file policy.native.json --plan-file policy.plan.json` reads the
current head revision and reviews the exact document against the current
model and source scope. New IDs use a null previous revision. Review shows
before and after definitions with `active: false`, zero production sends and
zero source writes. The private plan stores only the normalized document,
origin, previous revision and exact review fingerprint.
`policy-apply --plan-file policy.plan.json --approve DIGEST` saves one new
immutable inactive revision only while that fingerprint and previous revision
remain current. Concurrent edits and changed review inputs refuse atomically.
No grant is activated and no recipient gains access by applying a definition.

`bifocal_role_policy_definition` accepts the normalized `document`, exposes a
computed head `revision` and requires CLI `policy-plan`'s exact `review_digest`
for a definition mutation. The stable policy ID is immutable. Import uses its
actual native ID and requires no review fingerprint:

```sh
terraform import bifocal_role_policy_definition.regional POLICY_ID
```

Refresh exposes drift in the actual document and head revision. Saved plans
submit the prior revision and fingerprint; stale plans refuse atomically.
Changing only `review_digest` creates no revision. Destroy rechecks current
owner authority and releases tracking with a retained-history warning. All
policy revisions remain retained and inactive. Complete role configuration,
member binding and source-grant transfer remain unfinished. An environment
estate can reference an exact inactive policy revision; promotion grants no
access and these tools confer no grant activation authority.

## Dashboard and report answer collections

Dashboard and report exports preserve the ordered query definitions for each
card. Single-answer documents retain their `definition` field. Multi-answer
documents use `cards`, an ordered array of two to four native queries, without
saved snapshots, source guards, result rows or installation authority. Review
prints the exact answer for each card and binds the complete ordered document
to current authorized source inputs. Apply creates all answers and the retained
board atomically; a changed source refuses the whole operation.

`bifocal_dashboard_snapshot` and `bifocal_report_snapshot` accept both document
forms, support actual UUID import, and refresh the complete retained definition.
Computed `query_ids` lists answer IDs in card order, including a one-element list
for single-answer artifacts. Computed `query_id` retains the existing single
answer ID and is empty for multi-answer artifacts. Replacing either document
form creates a new retained artifact; releasing tracking retains the board and
all its answer history. Chart resources retain their separate single-answer
shape and computed `query_id`.

## Environment estates

`environment-export --estate ID --output environment.native.json` writes a
local reference manifest: `{version: 1, id, name, resources}`. Each resource
has a stable `key`, its `kind` and native `id`. Supported kinds are `model`,
`metric`, `chart`, `dashboard`, `report`, `policy` and `schedule`. Models also
name `branchId` and exact `revisionId`; metrics and policies name a numeric
`revision`, and schedules name a numeric `version`. Chart, dashboard and report
IDs identify retained immutable artifacts. Manifest references contain no
credentials, grants or embedded resource definitions. Export each full resource
independently with its own command. A manifest alone cannot reconstruct a
resource on another installation or confer access to its sources.

`environment-plan --file environment.native.json --plan-file environment.plan.json`
reviews the manifest against current local definitions and saves a private
plan with origin, normalized document, previous head revision and fingerprint.
`environment-apply --plan-file environment.plan.json --approve DIGEST` creates
one immutable draft only while that exact review remains current. New estates
use a null previous revision; concurrent head changes and changed review inputs
refuse atomically. `bifocal_environment_definition` accepts the same `document`,
exposes computed `revision`, and requires the CLI fingerprint as `review_digest`
for mutations. It supports actual stable ID import and drift refresh:

```sh
terraform import bifocal_environment_definition.finance ESTATE_ID
```

Saved Terraform plans submit the previous revision and exact fingerprint.
Changing only the fingerprint creates no revision. Destroy rechecks current
owner authority and releases tracking while retaining immutable estate history.
Terraform applies draft definitions; publication remains a separate exact human
action through the following CLI commands:

```sh
node src/bifocal/models/validation/cli.mjs environment-status --origin "$BIFOCAL_ORIGIN" --session-file "$BIFOCAL_SESSION_FILE" --estate "$ESTATE_ID"
node src/bifocal/models/validation/cli.mjs environment-review --origin "$BIFOCAL_ORIGIN" --session-file "$BIFOCAL_SESSION_FILE" --estate "$ESTATE_ID" --version "$ESTATE_VERSION"
node src/bifocal/models/validation/cli.mjs environment-approve --origin "$BIFOCAL_ORIGIN" --session-file "$BIFOCAL_SESSION_FILE" --estate "$ESTATE_ID" --version "$ESTATE_VERSION" --digest "$REVIEW_DIGEST"
node src/bifocal/models/validation/cli.mjs environment-promote --origin "$BIFOCAL_ORIGIN" --session-file "$BIFOCAL_SESSION_FILE" --estate "$ESTATE_ID" --version "$ESTATE_VERSION" --digest "$REVIEW_DIGEST" --environment staging
node src/bifocal/models/validation/cli.mjs environment-promote --origin "$BIFOCAL_ORIGIN" --session-file "$BIFOCAL_SESSION_FILE" --estate "$ESTATE_ID" --version "$ESTATE_VERSION" --digest "$REVIEW_DIGEST" --environment production
```

Estate versions are positive integers. Native review returns compatibility,
resource definitions, differences, metric and model impacts, current generation
and whether access review is required. Inspect those results before approving.
Use `--security-resolution TEXT` on approval when required. Promotion checks
current owner authority and exact BIF-046 approval, moving the supported estate
and its model and metric pointers atomically. Role policy definitions remain
inactive; no source grant or member binding is activated.

`environment-rollback-plan --estate ID --version INTEGER` reviews a retained
estate version. `environment-rollback --estate ID --version INTEGER --generation INTEGER --digest DIGEST`
requires that exact current review and generation, with `--security-resolution`
when required, and restores the supported estate coherently. Historical saved
answers and reports remain retained at their original versions.
`environment-run --estate ID --environment development|staging|production --key KEY`
runs the selected resource under current authority; supply `--view ID` when
selecting a model view. Every command also requires the common origin and
private session file. Native semantic revision references require the matching model revision in the
same estate, including every metric and retained visual. Mixed revisions refuse
before any pointer changes. These tools implement a bounded native estate workflow;
full BI resource parity, portable source authority and subscription dispatch
remain outside this support.


## Source and exploration bounds

Native resource definitions refer to admitted sources; they do not raise file
or query limits. CSV intake permits up to 1 MiB of original and decoded text,
200,000 data rows and 1,900,000 bytes of normalized table JSON, with all bounds
applying together. XLSX originals retain their separate 512 KiB compressed and
ZIP expansion bounds. See [file import](./FILE-IMPORT.md).

The owner configures interactive CSV and XLSX row caps at
`/app/settings/export`, up to 30,000 and 150,000 rows respectively. Saved
questions support stable pivots and explicit complete exports in named parts
above those caps, with current authority and caps checked on every part.
Owner-only subject compositions preserve separate row rules and provenance;
their downloads offer the same explicit named parts above the interactive cap. Definition exports
from the CLI contain no result rows and do not grant either download scope.
These exploration capabilities do not activate schedule dispatch or complete
the full report application.


Version 2 authored dashboards retain stable card keys and independently editable desktop and phone placements. Each card carries an exact native query definition. Both layouts contain every key exactly once and reject overlaps; desktop uses twelve columns and phone uses one. The owner editor at `/app/dashboard-authoring` reviews the exact document before saving an immutable draft. Publication and rollback require separate exact review; draft edits do not change the published reader. These are owner-only native dashboards, with two to four retained cards and the existing current-source custody floor.

Use `dashboard-definition-export --id UUID --output dashboard.native.json`, `dashboard-definition-plan --file dashboard.native.json --plan-file dashboard.plan.json --id UUID` and `dashboard-definition-apply --plan-file dashboard.plan.json --approve DIGEST` through the CLI entry above. Omit `--id` to review creation. The publish and rollback command pairs are `dashboard-definition-publish-plan` with `dashboard-definition-publish`, and `dashboard-definition-rollback-plan` with `dashboard-definition-rollback`; each plan takes `--id`, integer `--revision` and `--plan-file`, and each action takes `--plan-file` and `--approve`. Plans bind the current head, generation, exact sources and origin.

Terraform `bifocal_dashboard_definition` manages the normalized `document` and exact `review_digest`, exposes `revision`, `published_revision` and `generation`, and imports by the native definition UUID. A missing native publication appears as zero in Terraform state. Apply checks the exact current review digest; read-only planning can preview a draft before approval. Publishing remains an explicit reviewed CLI action or estate promotion. Releasing Terraform tracking retains native history. An estate dashboard reference with an integer `revision` selects that exact authored definition; existing retained dashboard references keep their existing format. Reviewed production promotion and estate rollback update the dashboard publication pointer in the same atomic change as native model and metric publication.
