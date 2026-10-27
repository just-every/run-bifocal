# Semantic models and source projects

Open **Files**, expand **Import a semantic project**, and choose the original
source files. Choose the source language, fiscal calendar and accounting basis.
Map each logical table to an already reviewed file dataset and its physical
grain. Supply each measure's unit, precision and currency explicitly.

The source readers recognize LookML project files, dbt Semantic Layer and
MetricFlow semantic model YAML, Power BI TMDL, and Cube YAML. They read values;
they never execute source SQL, JavaScript, M, macros or DAX code. The current
translated measures are physical-column sum, row count where the source supports
it, and distinct count where its null semantics match. Unsupported expressions,
properties, relationships and dependencies remain named compatibility gaps.
TMDL physical source partitions require an explicit dataset binding. DAX count
semantics that include BLANK remain unresolved. Cube JavaScript is refused.

Review the source expressions, translation report, proposed definitions and exact
plan fingerprint. Approving this import stores the project and its original
files through the same reviewed import pipeline as business data. It does not
publish a model. A project with unresolved semantics stays available for
inspection and cannot proceed to model publication.

Choose **Review imported model**. Review its actual source-query results, save
the exact revision, and separately approve publication to staging and production.
Multiplying joins, invalid grain, overlapping dimension history and stale source
reviews fail closed. Native YAML can also be edited in a git working tree,
loaded in Models, reviewed and saved. This does not synchronize a remote git
repository.

Source names are retained in the report. Native identifiers use lowercase words
and hyphens; a normalization collision is an explicit conflict, never a merge.
LookML sum measures retain their zero empty-set behavior; ordinary native and
TMDL sums retain null empty-set behavior. Formats and accounting context remain
part of the versioned query definition. Fiscal windows use the selected Company
calendar.

Published model results, saved questions, tabular dashboards and reports, and
summary exports use the same exact engine and retain the imported project
revision and original content digest. Historical answers retain their original
source and definition context. Import erasure withdraws the project, original
custody, derived model branches and saved answers. Erasing a bound file source
also withdraws its dependent imported projects, including approved and cancelled
project versions known to that source. These doors remain owner-only.

The public native project envelope has `version`, `projectId`, `format`, `files`,
`bindings`, `formats` and `context`. Each file has a relative `path` and `content`.
A binding names its `dataset`, `grain` and optional physical `columns` mapping.
Formats use the source table name and measure name joined with a dot, with
`unit`, `scale` and optional `sourceCurrency`. Upload, plan, apply, reconcile and
Undo use the shared operator import routes with `X-Import-Kind: model` and
`X-Import-Dataset` set to the project ID. The current imported project is read at
`/api/operator/model-imports/PROJECT_ID`; explicit reviewed erasure uses its
`/erase` action. These are native owner-session transports, not machine grants.

Source language references: [LookML measure types](https://docs.cloud.google.com/looker/docs/reference/param-measure-types),
[dbt measures](https://docs.getdbt.com/docs/build/measures),
[Cube YAML](https://docs.cube.dev/reference/data-modeling/cube),
[TMDL](https://learn.microsoft.com/en-us/analysis-services/tmdl/tmdl-overview),
and [DAX DISTINCTCOUNT](https://learn.microsoft.com/en-us/dax/distinctcount-function-dax).

## dbt project inventory

Choose the dbt format to review a Core project with `dbt_project.yml`, SQL model
files and schema YAML, or a Core or Cloud `manifest.json` artifact (manifest
schema versions 9 through 12). The same public project envelope and reviewed
import routes apply. Do not upload connection profiles or credentials.

The compatibility report retains model SQL, schema declarations, column tests,
source references and dependency identities in `report.project.resources`.
Manifest node identities are preserved exactly. Source-only projects inventory
literal `ref` and `source` calls; they do not compile Jinja. Missing dependencies,
cycles, unsupported files and execution obligations stay explicit. Project
configuration, hooks, packages, macros and SQL are never run or fetched.

This is an inert project inventory, not executable dbt preparation. Importing a
test does not run it. Such a project cannot publish a native model. Bind model
names to reviewed file datasets to track source custody; source erasure reaches
the project and its retained originals. Reimport uses an exact reviewed revision,
and shared Undo restores the earlier project. The bounded inventory accepts at
most 512 resources within the existing file and byte limits. SQL transformation,
validation execution, dependency schedules and automatic flow translation remain
unfinished under BIF-005 and BIF-070.

## Other native project inventories

Choose PBIP and upload the project descriptor, report `definition.pbir`, semantic
model `definition.pbism` and textual TMDL files with their original relative
paths. Descriptor references resolve only inside the uploaded project. The
existing TMDL reader translates supported table definitions; report layout and
interaction translation remain explicit gaps and prevent project publication.
Missing descriptors, remote connection references and paths outside the uploaded
project are diagnosed, never fetched.

Choose Metabase for serialization YAML or individual Card, Table, Field and
Database API response objects. Original identities, queries, field metadata and
source dependencies remain in the inventory. MBQL, native SQL, source permission
and visualization execution remain unproved; these objects cannot publish a
native model. Collection and dashboard serialization metadata is also retained.

Choose Tableau for textual TWB or TDS files, or a TWBX archive. The browser
encodes the archive for the same project envelope; API clients supply its
`content` as base64. Data sources, column calculations, worksheets, dashboards,
stories and their source references are retained. DTD and entity declarations,
unsafe archive paths, more than 64 archive entries, any expanded file above
256 KiB or total expanded content above 1 MiB are refused. The encoded archive
must still fit the ordinary project file limit (the browser accepts 192 KiB
before encoding). Extracts, binary contents and scripts are named unsupported
items. Nothing is extracted to disk, evaluated or fetched. Source and content
execution remain explicit gaps; inventory is not a translated workbook.

Every explicitly bound source dataset retains erasure custody even when a
project has no executable definition or has an invalid source object. The exact
reviewed import can retain that diagnostic project for inspection, but cannot
promote it. The Files report lists source objects and dependencies before the
full technical report. These bounded readers do not provide file-service
connections, background refresh, network-share access or full incumbent parity.

## Native preparation drafts

The owner API prepares reviewed file datasets synchronously. It does not publish
prepared data or alter certified metrics. The browser transform editor and
original Power Query and Tableau Prep flow translation remain unfinished.

`POST /api/operator/preparations/{id}/review` accepts `previousVersion` (`null`
for a new draft) and a `document` with `version: 1`, `dataset` and ordered `steps`.
Supported steps are:

- `dedupe`: remove identical complete rows; no arbitrary winner among conflicts.
- `cast`: an existing `column` and a target `type` of text, number, money, date or
  boolean. Failed conversions identify the step and return no partial output.
- `calculate`: a new `name`, numeric `left` and `right` columns and `operator`
  add, subtract or multiply. Decimal arithmetic is exact; nulls propagate.
- `union`: an imported `dataset` with the identical ordered typed schema.
- `join` or `lookup`: an imported `dataset`, `left` and `right` keys, output
  `prefix` and `kind` inner or left. Duplicate right keys refuse; null never
  matches null. This bounded door does not allow implicit multiplying joins.
- `unpivot`: same-type `columns`, a new field `name` and new `value` column.
  Null cells remain rows.
- `pivot`: explicit `groupBy`, field `column`, `value` column and complete
  `values` domain. Duplicate cells and unknown domain values refuse; missing
  cells remain null. There is no implicit aggregate or silent dropped value.

The response contains exact output rows, typed columns, per-step row counts,
source revisions, output-column lineage and an executable `sql` form. Instead
of `document`, review and save accept `dataset` and `sql`. This is a closed
native preparation dialect: each statement consumes the previous `INPUT`;
`REPLACE`, `UNPIVOT INCLUDE NULLS` and `PIVOT SINGLE` have the explicit semantics
above. A join alias is the output column prefix. `SINGLE` refuses multiple rows
for a pivot cell. Quoted identifiers and literals are inert. Arbitrary SQL,
comments, provider functions, external reads and database writes are refused;
this is not a general SQL notebook or a dbt runtime.

`POST /api/operator/preparations/{id}/save` takes the same input and the exact
`reviewedDigest`. Saving checks the current source bytes, source revisions,
native session and previous draft version atomically. Only successful reviews
can save. `GET /api/operator/preparations/{id}` lists immutable definitions,
source pins, retained typed column lineage and revision history. `POST /api/operator/preparations/{id}/restore`
takes `restoreVersion`, `previousVersion` and the digest obtained by reviewing
that earlier document against the current head. Restoration appends a revision;
it never replaces history, and changed original source pins refuse restoration.

There are at most 32 steps, 64 output columns, 10,000 working rows, 1.5 MB of
working values and lineage, and 100 revisions per draft. These bounds refuse
rather than truncate. Prepared rows are not persisted. Erasing any source used
by any revision removes the dependent draft and all revision definitions.
Current native owner-only custody applies to review, save, history and restore;
there is no new source grant or delegated preparation permission.

Native draft execution does not prove automatic original-flow translation,
dbt execution and tests, a visual editor, chart error propagation, analytical
store publication or dependency scheduling. Scheduling requires Base BIF-058;
the original-flow corpus and automatic translation remain BIF-070 obligations.


The owner can open **Preparation drafts** on `/app/import`, choose a dataset,
add and reorder transformation steps, and inspect their exact rows and column
lineage. Switch to native SQL to edit equivalent executable statements. Saving
requires confirming the exact reviewed digest. Load an earlier revision and
review it before restoring it as a new draft; source changes refuse restoration.
These drafts do not publish a model or change certified data.

For directory-based semantic projects, choose **Original project folder**. Paths
are retained relative to the selected folder, so local PBIP descriptor references
and dbt dependencies can be inspected. Choose individual files for a flat project.

Preparation reviews compare the staged output with current certified metrics
and retained charts that use the source. The review shows published and staged
totals separately. It never changes a certified definition or retained answer.
A failed draft leaves a source-revision-bound warning on its affected charts;
a successful review clears that warning. Source changes hide obsolete warnings,
and source erasure removes their retained diagnostics.

An owner can explicitly execute supported imported dbt definitions with
`POST /api/operator/preparations/<id>/dbt-review`, supplying `projectId` and
`bindings` from literal source resource identities to already imported dataset
IDs. The result includes ordered dependencies, exact output rows, column
lineage, generic column `not_null` and `unique` test outcomes, and the project
and source revisions. A dependency or test failure makes the review incompatible.
This native dialect supports one literal relation per model, projections,
casts and exact arithmetic. It never evaluates Jinja or runs hooks, adapters,
provider SQL or background jobs. Unsupported constructs stay diagnostic.
Execution is ephemeral and does not publish a table or certify a metric.
