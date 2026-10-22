<img src="public/brand/mark.svg" width="150" height="72" alt="Bifocal">

# Bifocal

Business intelligence and reporting. 100% free, open source alternative to Microsoft Power BI, Tableau (Salesforce), Looker (Google Cloud).

Homepage and docs: [run-bifocal.com](https://run-bifocal.com).

Bifocal is a new seed built on the Base foundation. This checkout provides the shared Lobby, owner sign-in, people and invitations, the owner's CSV and XLSX import in the app and over HTTP ([docs/FILE-IMPORT.md](docs/FILE-IMPORT.md)), US company conventions ([docs/US-CONVENTIONS.md](docs/US-CONVENTIONS.md)), exact saved answers ([docs/EXACT-QUERIES.md](docs/EXACT-QUERIES.md)), local D1, the Run site and the target contract. The full business intelligence product is not built yet: in [CONTRACT.md](CONTRACT.md) one target clause is done (numerical correctness and reproducible answers), four are partial (files and spreadsheets, US conventions, safe analytical execution, durable operation) and the rest are missing. [ACCEPTANCE.md](ACCEPTANCE.md) describes the destination, not completed features.

## Run locally

Install the shared command and run Bifocal:

```sh
curl -fsSL https://runeditrun.com/install.sh | sh
rer dev just-every/run-bifocal
```

The installer supplies its own Node runtime. If it ends with a line to run, run it before the second line: it puts
`rer` on your PATH. To start again later: `cd run-bifocal && rer dev`.

With Node 22 or later already installed, you can instead run:

```sh
npx -y @runeditrun/rer dev just-every/run-bifocal
```

The installed `/` is Base's Lobby. The public [Run site](https://run-bifocal.com) has the homepage, `/run`, `/docs` and `/contract`, rendered from the root `CONTRACT.md`; `rer build --site` builds those static pages from `src/site/` and `docs/`.

Read [RUN-LOCALLY.md](RUN-LOCALLY.md), [AGENTS.md](AGENTS.md), [OPERATIONS.md](OPERATIONS.md) and [SEED-COMMAND-CONTRACT.md](SEED-COMMAND-CONTRACT.md). The package pins Node 22.20.0, pnpm 10.12.4 and `@runeditrun/rer` 0.2.78. Base source origin is recorded in `edition.json` and `composition.lock.json`.

MIT licensed. Research and private evidence live separately from this repository.
