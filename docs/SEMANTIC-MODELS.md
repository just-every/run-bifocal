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
