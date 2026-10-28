# Retained-query charts

The native chart HTTP door renders an existing exact answer. Sign in as the
current installation owner, import data through `/app/import` and run a query
through `/app/queries`. The answer's `queryId` identifies the retained source
revision, filters, exact values, calendar, metric definition and owner scope.

Read `/api/operator/charts` for the supported types, formats and bounds. Render
`/api/operator/charts/{queryId}/vertical-bar.svg`, or replace `vertical-bar`
with `horizontal-bar`, `line`, `stepped-line`, `area`, `sparkline`, `table`,
`kpi`, `pie` or `donut`. Replace `.svg` with `.json` for the exact data and
provenance used by that rendering. Both formats require a current owner session.
GET and HEAD are supported; this door changes no source or saved answer.

Optional query parameters:

- `measure`: an existing measure id from the retained query; defaults to its first measure.
- `width`: an integer from 320 to 1440, default 720. Use the intended display width to keep labels readable.
- `scale`: `linear`, or `log` for line, stepped line and sparkline with strictly positive values.

All rendering is bounded to 40 groups. Indexed plots additionally require
24 pixels per group; request a wider rendering or run an explicitly grouped
query when the door reports `chart_groups_require_wider_view`. Nothing is
silently truncated. Pie and donut require sum or count measures, complete
nonnegative values and a positive total; a missing or suppressed denominator
is refused instead of displaying a misleading whole. Their sectors use the
visible grouped values; exact grand totals remain separate in the data response.

Exact decimal strings determine labels and the alternative table. Floating point
is used only for coordinates. Zero remains distinct from missing, unknown,
suppressed and incomplete values. Lines break at unavailable values. Numbered
marks, patterned sectors, named keyboard focus targets and semantic table rows
provide alternatives to color. Tiny sectors retain their patterned outline and
accessible name; their full value is in the table. Actual screen-reader and full
WCAG qualification remain pending.

The response includes no scripts, external images or network dependencies.
Labels are XML-escaped and invalid XML characters are refused. Responses are
uncached, sandboxed and checked against current owner authority and source
custody immediately before return. Charts are derived on demand with no extra
persistent copy: source erasure withdraws subsequent chart reads, while ordinary
source replacement leaves retained answers reproducible. A file already saved
by its owner remains in that owner's local custody.

This is a bounded rendering API. A visual builder, the other named chart
families, licensed and dated US maps, theme editing, reference lines, conditional
formatting, PNG and PDF output, full accessibility qualification and imported
custom-visual parity remain unfinished under BIF-011 and BIF-081. The
`sparkline` type currently shares the native line rendering with its exact-value
alternative; compact embedding is not yet qualified.
