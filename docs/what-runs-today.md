Bifocal is being built into company-wide business intelligence: every database and app connected, one certified
definition per metric, plain-English questions answered with the chart, the query, the definition and the rows,
reports and alerts under row-level security, and a customer reporting portal. Today the code is the foundation that
product is being built on, with the owner's first data tools. This page says what runs now.

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
- **Files**: the owner brings CSV files and Excel sheets in as datasets, in the app or through Bifocal's HTTP
  interface, each one reviewed, applied, reconciled and undoable. See [Import CSV and Excel files](/docs/import-files).
- **Company conventions**: the owner manages the company's US calendars and currency rates.
- **Exact answers**: the owner runs an exact query over imported datasets and keeps the answer, with the data and
  settings it used, as a saved dashboard or report table that reruns to the same numbers.
- **Back up and restore** of the whole installation from the command line. See [Back up and restore](/docs/backup).

## What is not built yet

Connections to databases and apps, the metrics catalog, plain-English questions, charts, scheduled reports, alerts and
the customer portal are not built yet, and moving in from Power BI, Tableau or Looker is not available. The data tools
above are for the installation's owner only.

## How the contract tracks the rest

The [contract](/contract) lists every clause Bifocal is being built to meet, from database connections to the
customer portal, and marks each one done, partial or missing, judged from the code and its tests. Today one clause is
done, numerical correctness and reproducible answers (BIF-045), and four are partial: files and spreadsheets (BIF-003),
US dates, money and calendars (BIF-036), safe analytical execution (BIF-057) and durable operation (BIF-058). The rest
are missing. The homepage shows the product the contract describes; this page and the contract say
what runs now.
