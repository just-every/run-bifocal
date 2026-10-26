# Published dashboard interactions

Owners configure interactions in the version 2 dashboard document at `/app/dashboard-authoring`. The existing draft review, publication, version history, rollback, CLI, Terraform and environment tools retain that document. Saving a personal choice never changes a published definition.

A configured published reader at `/app/dashboard-authoring/{id}/view` runs the current authorized sources while retaining its exact published layout and query definitions. An older document without interaction configuration retains its existing snapshot reader. The separate TV reader remains available.

## Configuration

The optional `interactions` object contains:

- `tabs`: named groups of query cards and decorative tiles.
- `tiles` and `tileLayout`: text and bounded inert PNG, JPEG or WebP data, with separate desktop and phone placement. Images never fetch a remote address, and text never executes markup.
- `dimensions`: authored dimensions available to equality filtering. Cross-filtering and reader filters intersect the card's fixed model rules and any audience rules.
- `fieldParameters`: named choices among authored grouping fields and measures. Totals are recomputed by the exact query engine.
- `fiscalParameters`: named `period-to-date`, `quarter-to-date`, `year-to-date`, `previous-period`, `previous-quarter` and `previous-year` selections relative to an explicit `asOf` date and the retained fiscal calendar. To-date selections include the cutoff. Previous selections include the complete preceding fiscal interval and exclude the current interval. Retail periods follow the retained 4-4-5 or 4-5-4 calendar, including its extra week; a fiscal period is not necessarily a calendar month. The reader displays the selected window and date. No selection follows the wall clock automatically.
- `whatIfParameters`: one declared bounded numeric parameter of an exact native calculation-library revision. Scenarios operate on protected rows; actual values and source records remain unchanged.
- `states`: named, versioned shared selections. A changed selection requires a new named-state revision.
- `stories`: an ordered list of exact shared-state revisions, with manual steps, play and pause.
- `actions`: named drillthrough or tooltip destinations. Region filters and fiscal periods travel as an additional protected intersection; a destination cannot clear that inherited context. Tooltip destinations are published authored dashboard pages.
- `recordActions`: owner-authorized source columns and exact semantic grain keys for a paged source-record view. Exact record navigation keeps the active row and fiscal context.
- `duplicateAllowed`: permits the owner reader to review a copied definition. It starts as an unpublished draft and carries no grants or personal state.

Personal bookmarks retain immutable revisions for the signed-in reader and exact publication. A stale write refuses. Shared defaults remain unchanged on reopening. Current displayed exports are prepared only after the displayed query and watermarks match a fresh authorized execution; existing summary and underlying CSV and XLSX controls then use that exact snapshot. The published reader also offers explicit review and download of native whole-dashboard PDF and editable PowerPoint snapshots under BIF-074: selected tabs, current or default filters, desktop or phone layout, exact source and model metadata and an authenticated link. The accessible preview shows the exact layout before download. Unsupported image encodings, PDF characters and layouts refuse explicitly. Subscription attachments and general report export remain unproved.

## Current access and freshness

Every execution checks the current native session, owner custody, published model, conventions and source revisions at the response boundary. Individual loading, fresh, stale, empty and failed tiles remain distinct. Source or authority loss withdraws controlled values; transient execution failures may retain explicitly dated last-good values in the open browser. TV refresh is an explicit interval while the browser is open, with pause and full-screen controls.

Reporting apps freeze the exact authored revision independently of later author publication. The receiving app door applies its own live audience grants to refreshes, bookmarks, drillthrough and tooltips. It exposes summary values only and excludes source definitions, source-record actions, downloads and duplication. Audience context and personal state cannot be borrowed by another member. That bounded audience policy remains pending ct approval in BIF-079; the complete role model remains BIF-019.
