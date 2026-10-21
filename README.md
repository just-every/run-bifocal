# Bifocal

Business intelligence and reporting. 100% free, open source alternative to Microsoft Power BI, Tableau (Salesforce), Looker (Google Cloud).

Bifocal is a new seed built on the Base foundation. This checkout provides the shared Lobby, owner sign-in, local D1, the Run site and the target contract. The business intelligence product is not built yet: all target clauses are missing in [CONTRACT.md](CONTRACT.md). [ACCEPTANCE.md](ACCEPTANCE.md) describes the destination, not completed features.

Install the shared command and run Bifocal:

```sh
curl -fsSL https://runeditrun.com/install.sh | sh
rer dev just-every/run-bifocal
```

The installer supplies its own Node runtime. If `rer` is not on PATH, follow
the shell command printed by the installer.

With Node 22 or later already installed, you can instead run:

```sh
npx -y @runeditrun/rer dev just-every/run-bifocal
```

The installed `/` is Base's Lobby. The public [Run site](https://run-bifocal.com) has `/run` and `/contract`, rendered from the root `CONTRACT.md`. `rer build --site` builds those static pages. The default Base theme stays until the design round.

Read [RUN-LOCALLY.md](RUN-LOCALLY.md), [AGENTS.md](AGENTS.md), [OPERATIONS.md](OPERATIONS.md) and [SEED-COMMAND-CONTRACT.md](SEED-COMMAND-CONTRACT.md). The package pins Node 22.20.0, pnpm 10.12.4 and `@runeditrun/rer` 0.2.74. Base source origin is recorded in `edition.json` and `composition.lock.json`.

MIT licensed. Research and private evidence live separately from this repository.
