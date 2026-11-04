# Stripe balance movements

The current native owner can request one bounded read in **Files**, at
`/app/import`, and then separately review and approve the exact file-door plan.
A narrowly scoped Stripe bearer is supplied for that operation only. It is not
saved, refreshed or forwarded on redirects. There is no standing connection,
provider write, account discovery or automatic publication.

The supported protocol is Stripe-Version **2026-10-28.endive**, pinned to the
[balance transaction list](https://docs.stripe.com/api/balance_transactions/list?api-version=2026-10-28.endive)
and [balance transaction object](https://docs.stripe.com/api/balance_transactions/object?api-version=2026-10-28.endive).
Requests use only GET `https://api.stripe.com/v1/balance_transactions`, with
`created[gte]`, `created[lt]`, `limit` and subsequent `starting_after`. No connected
account header is sent. The supplied token determines the accessible account;
the account context label is owner-declared and never verified account identity.

Creation dates define an exclusive-end UTC window. Original UTC instants and
typed UTC days are both retained. The supported projection preserves IDs,
currency, type, pending or available status, nullable source references and
signed amount, fee and net in exact USD cents. It independently verifies
`net = amount - fee`. It does not flatten expanded source objects or retain
provider metadata. The retained original is a normalized CSV and lineage
envelope, not the original provider response. Null source references remain
null; monetary zero remains zero.

Bounds are 20 pages of at most 100 transactions, 2,000 transactions, 1 MiB per
response, 2 MiB overall, a 15-second overall deadline, and the existing 512 KiB
source-to-import bridge bound. Overflow, duplicates, inconsistent continuation,
incomplete responses, unsupported currency, unsafe precision and failed later
pages stage no plan. An empty interval creates no import. There are no automatic
retries. Observed times, page and row counts, response bytes and limits remain
visible during review and on the published dataset.

Pagination does not establish a transactional source snapshot. Late changes or
changes while paging can require another explicitly consented read. Balance
movements are neither recognized revenue nor MRR, and supply no invoice,
customer, tax, entity, reconciliation or cash-versus-accrual qualification.
Authorized live grants, provider consent and independently verified account
identity remain unproved. The shared door supplies current-owner review,
reconciliation, Undo and eligible erasure, including existing retention holds.
Erasure withdraws controlled native copies, not provider-retained records.
