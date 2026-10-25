# Retail demo

Run `rer dev --demo` (or `rer demo`) from this checkout. Once signed in, open
**Library**, choose **Cedar & Finch Demo · January–June 2026**, and follow its
saved-dashboard link. The dashboard shows exact monthly revenue, order count,
refunds and margin. Files and Exact answers expose the underlying retained data.

Cedar & Finch Demo is an invented homeware retailer. Its 32 customer names,
12 products, 300 orders and 23 returns are entirely fictional, authored in
`src/demo/data.ts`, with no real person, company or scraped data. Orders span
January through June 2026 with changing volumes, weighted product demand,
repeat customers, store and online sales, discounts and partial returns.
Amounts use integer cents; revenue subtracts discounts and refunds, and profit
subtracts the cost of retained goods. Returned goods are assumed restocked.

The demo hook uploads each CSV envelope through the same authenticated shared
file door as an owner, reviews the exact plan, applies it and reconciles the
result. Native calendar, exact-query, dashboard and library APIs create the saved
answer and its discoverable link. The existing demo wrapper calls this hook only
with demo mode enabled, stores state in its throwaway database, and removes that
state when the session ends. Ordinary development and production installs never
load these records. No external provider is required or represented as connected.

The committed 1440-pixel capture in `.github/assets/release/` is the real
`rer dev --demo` dashboard with this shipped dataset, in the existing app theme.
