Bifocal can take in a CSV file, or one sheet of an Excel workbook, as a dataset. Every import is reviewed before
anything changes, applied as one step, checked against what was sent and can be undone. Today this runs through
Bifocal's HTTP interface for the installation's owner only; the import screen in the app is not built yet.

## What it takes

- **CSV**, separated by commas, semicolons, tabs or pipes, with quoted fields and a header row. Formulas stay as
  text: nothing in a cell is run or fetched.
- **Excel (XLSX)**: one chosen sheet per import, with the values the workbook last calculated; its formulas are kept
  but never run. Macro workbooks (XLSM), templates and archives are refused.
- Columns are text, numbers, money, dates (`MM/DD/YYYY`) or true/false. Money and numbers keep their exact digits.
- Up to 2,000 rows, 64 columns and 512 KiB of CSV text per import. These are today's limits, not a promise about
  large files.

## The steps

Every step needs the owner signed in, from the app's own address, and names the dataset it works on.

1. **Upload** the file. An interrupted upload resumes where it stopped.
2. **Review the plan**: the counts, the proposed columns and types, five sample rows and up to 20 reasons a row or
   column does not fit. Nothing has changed yet.
3. **Apply** that exact plan. Choose whether it adds rows (`append`), replaces the dataset (`replace`) or updates
   rows by a key column and adds new ones (`keyed-update`). A plan made against an older copy of the dataset cannot
   overwrite a newer one.
4. **Reconcile**: compare the stored values, counts and sources with what was sent.
5. **Undo** restores the dataset as it was before that import, newest import first. It refuses rather than
   overwrite a change made since.

The owner can also read a dataset back, or erase it and the import content kept for it after confirming its id and
current revision.

## Where the details are

The requests, headers and the file envelope are in
[FILE-IMPORT.md](https://github.com/just-every/run-bifocal/blob/main/docs/FILE-IMPORT.md) in the repository. Live
Google Sheets and Excel Online ranges, larger files, and moving in from Power BI, Tableau or Looker are part of the
[contract](/contract) and are not built yet.
