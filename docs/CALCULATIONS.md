# Governed calculations

Open **Exact answers → Calculations**. Select a published semantic view, write
an Excel-familiar, DAX, Tableau or typed native expression, and review the source,
translated expression, exact answer and evaluation semantics. Only the current
owner can approve that exact input. A changed model, source, company convention
or library head invalidates the review. Native save uses the same shared upload,
Plan, Apply, reconciliation and Undo engine as migration.

The view's source filters, row rules, joins, explicit grain and fiscal cutoff run
before calculations receive any rows. Model fields are the only available source
columns. CALCULATE can replace user filters and grouped coordinates; FIXED can
change grain and ignore ordinary user filters. Neither can replace these already
authorized rows. The interface exposes the governing model revision, hierarchies,
row restrictions and fiscal context alongside the removable run options.

Calculated fields declare their type and run per authorized row. Numeric fields,
including non-terminating division results, stay exact rational values. Measures
aggregate those fields, evaluate conditionals and civil date arithmetic, compare
periods, run explicit partitioned windows and ranking, calculate percentages and
change declared fixed grain. Window partition, order, null order and ROWS frame
are explicit. Ambiguous fixed grain is refused. Totals recompute the expression
over filtered authorized rows; ratios are never summed from displayed cells.
Window totals are null. Native nulls propagate, aggregates ignore nulls, empty
numeric aggregates are null and empty counts are zero. Division by zero returns
null with a reason. Source translations explicitly adapt DAX BLANK and Excel
empty-sum behavior; a source error distinction that cannot be preserved is a gap.

## Original migration

The migration section accepts a JSON library envelope containing `calculations`
with original source expressions, or `source: {format: "tmdl", content: "…"}` or
`source: {format: "tableau", content: "…"}` with original textual source content.
It uses the existing operator import endpoints with `X-Import-Kind: calculation`,
`X-Import-Dataset` set to the library id, and explicit `X-Calculation-Model` and
`X-Calculation-View` bindings. Installation, upload, Plan, exact fingerprint
approval, Apply, reconciliation, original custody, before-images and Undo are the
same import engine used by Files. Original files and expressions remain retained;
they never execute source code, XML entities, scripts, provider SQL or a remote
connection. Unsupported expressions stay visible and block calculation runs.

An envelope contains `version: 1`, `id`, `label`, `modelId`, `modelRevision`,
`viewId`, `calculations`, `groups`, `parameters` and `fieldParameters`. An optional
`table` binds the one source table used by DAX iterators. An optional `window`
contains `partitionBy` and `orderBy` choices from the source worksheet. Native
expressions are bounded typed AST objects, never JavaScript. A formula has an
id, language, sourceExpression and optional source format. A calculated field
additionally declares `kind: "field"` and `dataType`.

TMDL extraction retains measures, calculation items, explicit precedence and
static numeric formats. Original NAMEOF tuple tables provide field choices;
GENERATESERIES tables provide exact numeric bounds and increment, with the default
required from the original SELECTEDVALUE expression. A caller cannot replace an
imported parameter definition. Unsupported parameter or dynamic format semantics
remain explicit issues. Tableau textual workbooks retain original expressions,
source object provenance, and story and parameter dependencies. Story activation
and delivery mapping remain BIF-025 obligations, with an unresolved report here.

Higher calculation-group precedence is the outer expression; equal selected
precedences are refused. The highest-precedence explicit format wins. Supported
static numeric patterns include integer, fixed decimals, thousands separators,
percent and dollar display. Display rounds half away from zero; underlying
fractions remain unchanged. Field parameters select declared governed field
sets. What-if values must belong to the exact declared range and increment.

Fiscal QTD and YTD translations use the bound BIF-036 calendar and frozen cutoff.
They never infer calendar quarters. Source text collation, unbound context
transitions, Tableau null-excluded ranks, dynamic format strings and unsupported
functions are concrete compatibility gaps, not dropped calculations. Migration
does not certify an unsupported construct by comparing a conveniently nonnull
fixture. These limits are visible before any activation.

Libraries are bounded to 64 calculations, 16 groups, 16 numeric parameters and
eight field parameters over the existing 2,000-row source limit. Original library
envelopes fit within 1 MiB. Exact typed ASTs have depth and node limits and a
bounded evaluation budget. Original custody, saved libraries and frozen answers
are portable. Source erasure retires original libraries from every prior version,
pending plans and Undo states, removes dependent answers and permanently fences
the retired library id. Erasing an imported model project also withdraws its
dependent calculation libraries. Retained answers are owner-only and preserve
their exact definition, model, source revisions, fiscal and security context.

## Public native doors

`GET ./api/operator/calculations` lists available governed views and owned
libraries. `POST ./api/operator/calculations/review` accepts `{input}` and returns
the exact digest, compatibility report and preview. The save endpoint accepts
`{input, reviewedDigest}`. A saved library can run with its exact revision,
removable filters, grouped fields, selected group ids and typed parameters.
The response contains exact values, formatted display, governing context and
a retained answer id. Its retained answer URL returns the immutable result.

The source semantics follow Microsoft's
[calculation-group specification](https://learn.microsoft.com/en-us/analysis-services/tabular-models/calculation-groups),
[DAX COUNT](https://learn.microsoft.com/en-us/dax/count-function-dax),
[DAX DISTINCTCOUNT](https://learn.microsoft.com/en-us/dax/distinctcount-function-dax),
and Tableau's [LOD filter order](https://help.tableau.com/current/pro/desktop/en-us/calculations_calculatedfields_lod_filters.htm).
The committed source library compares fifty original DAX and Tableau formulas
with independently written SQLite queries and window expressions. Additional
journeys prove exact fields, protected fixed grain, two original interacting
groups, parameter changes, formats, source withdrawal and real browser use.
