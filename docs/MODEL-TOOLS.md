# Native model tools

Bifocal's current native tools manage owner-only model drafts. They also create
and export single-answer tabular dashboards and reports, and manage one-time civil-time schedule definitions. This is partial BIF-022 support:
full resource serialization and environment
configuration and all downstream application parity remain unfinished.

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
single-answer native dashboard. `dashboard-import --file --plan-file` reviews that definition under current
owner authority. `dashboard-import --file --approve` requires the returned exact
fingerprint and atomically creates the answer and a new pinned dashboard. It does not
update an existing dashboard or import access grants. Multi-card dashboards,
certified metric resources and schedules remain outside these commands.

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

Terraform manages model drafts, retained dashboard and report snapshots and one-time schedule definitions. Publication and rollback remain separate exact
human CLI actions. Destruction removes only the draft branch pointer; immutable
revision and approval history remain. A branch currently published to staging
or production cannot be destroyed. A changed draft version also refuses an old
destroy plan.

CI compiles this provider and runs real Terraform commands against the emitted
Worker in the existing semantic-model journey. `node scripts/prepare-model-tools.mjs`
prepares checksum-verified Terraform 1.13.4 and the provider in the ignored local
cache on Linux amd64; other hosts can use their supported Terraform binary.

## One-time schedule definitions

`schedule-export --schedule ID --output schedule.native.json` writes
`{version: 1, id, definition}`. The definition has `name`, `localDate`, `time`,
`timezone`, `reportCutoff`, `skipped` and `repeated`, matching the native
[civil-time semantics](./US-CONVENTIONS.md). Resolved instants, author identity,
installation authority and provider credentials are excluded from this file.

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
Recurring subscription definitions, environment source bindings and atomic
estate promotion remain unfinished under BIF-022; execution belongs to BIF-015
and BIF-058.

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
same `{version: 1, title, definition}` format as single-answer dashboards.
`report-import --file report.native.json --approve DIGEST` requires the exact
current native review and atomically retains a new report and its answer.
`bifocal_report_snapshot` supports the same Terraform fields and lifecycle as
`bifocal_dashboard_snapshot`, including actual UUID import and source-bound
creation. The resulting artifact opens on the native report page. Replacing a
definition creates a new retained artifact; releasing Terraform tracking keeps
its immutable history. These tools do not import report-recipient grants,
activate delivery, or implement paginated report layouts. No saved answer is
silently updated after a model or source change.
