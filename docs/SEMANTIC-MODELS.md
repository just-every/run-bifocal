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
source dependencies remain in the inventory. Bounded MBQL sum and distinct
aggregates resolve physical field ids against the uploaded table catalog and
can publish through explicit native source bindings. Other MBQL, native SQL,
source permissions and visualization semantics remain unresolved and block
publication. Connection details and unrecognized query clauses never disappear
into a wider native aggregate. Collection and dashboard serialization metadata is also retained.

Choose Tableau for textual TWB or TDS files, or a TWBX archive. The browser
encodes the archive for the same project envelope; API clients supply its
`content` as base64. Data sources, column calculations, worksheets, dashboards,
stories and their source references are retained. DTD and entity declarations,
unsafe archive paths, more than 64 archive entries, any expanded file above
256 KiB or total expanded content above 1 MiB are refused. The encoded archive
must still fit the ordinary project file limit (the browser accepts 192 KiB
before encoding). Extracts, binary contents and scripts are named unsupported
items. Nothing is extracted to disk, evaluated or fetched. Source and content
execution remain explicit gaps; inventory is not a translated workbook. A
bounded source definition with one textscan table, physical typed columns and
SUM and COUNTD measures can compile against explicitly reviewed native records.
Source filters, connection settings and unrecognized elements block publication.
Rebuilt native exports in Files retain reviewed source revisions and mappings
without original file bytes or connection credentials.

Every explicitly bound source dataset retains erasure custody even when a
project has no executable definition or has an invalid source object. The exact
reviewed import can retain that diagnostic project for inspection, but cannot
promote it. The Files report lists source objects and dependencies before the
full technical report. These bounded readers do not provide file-service
connections, background refresh, network-share access or full incumbent parity.
