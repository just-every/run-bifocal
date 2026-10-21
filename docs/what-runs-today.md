Bifocal is being built into company-wide business intelligence: every database and app connected, one certified
definition per metric, plain-English questions answered with the chart, the query, the definition and the rows,
reports and alerts under row-level security, and a customer reporting portal. Today the code is the foundation that
product is being built on. This page says what runs now.

## What you can use now

- **The Lobby** at the front page, with **Finish setup** or **Sign in**.
- **Sign-in** by email link, and on your own computer by the private link `rer dev` prints. See
  [Sign in and sign out](/docs/sign-in).
- **First-run setup**, where the owner confirms the account.
- **The app home**, with the signed-in person's name and links to the Run page and the contract.
- **People**: owners and admins invite people as members or admins and see each person's role and status. See
  [People and your settings](/docs/people).
- **Your settings**: change the name your account shows.
- **Identity settings** for the owner, where provider sign-in is turned on or off when you connect an identity
  provider.
- **File imports**: the owner brings CSV files and Excel sheets in as datasets through Bifocal's HTTP interface,
  each one reviewed, applied, reconciled and undoable. See [Import CSV and Excel files](/docs/import-files).
- **Back up and restore** of the whole installation from the command line. See [Back up and restore](/docs/backup).

## What is not built yet

Connections to databases and apps, the metrics catalog, questions and answers, dashboards, reports, alerts and the
customer portal are not built yet. The app has no import screen yet, and moving in from Power BI, Tableau or Looker
is not available. The app home says so too.

## How the contract tracks the rest

The [contract](/contract) lists every clause Bifocal is being built to meet, from database connections to the
customer portal, and marks each one done, partial or missing, judged from the code and its tests. Today two clauses
are partial, files and spreadsheets (BIF-003) and safe analytical execution (BIF-057), each proven so far for these
file imports; the rest are missing. The homepage shows the product the contract describes; this page and the contract say
what runs now.
