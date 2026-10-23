# Foundation operations

This checkout currently provides the Base foundation, not the BI product.
Start with the installed Lobby at `/`, sign in at `/signin`, finish first-run
setup at `/setup`, then open `/app`. App home links to native data and account tools, including People for invitations and eligible account deactivation, and Your settings for display names and session revocation. Analytics roles and groups remain unfinished.
The separate public Run site provides `/run` and `/contract`.

Owners can import bounded CSV and XLSX files at `/app/import`, review an exact plan, publish atomically, inspect originals and versions, Undo and erase. See `docs/FILE-IMPORT.md` for limits. BIF-003 remains partial for live provider and broader file/large-intake qualification; BIF-025 incumbent migration remains missing. Installation archives use the separate `rer export` and `rer import`
commands; they do not import business records or replace the product import door.

Data move-in uses Base's shared door at `/app/import` for
supported source exports, with review, exact-plan approval, reconciliation and
Undo. Do not add a separate importer. Base's reference people-JSON reader is
not a Bifocal business-data importer, and `.rer` archives are not door uploads.
Follow Base's [door adoption guide](https://github.com/runeditrun/base/blob/main/modules/import-kit/src/door/ADOPTING.md).

With Node 22 or later, start a fresh copy with one line: `npx -y @runeditrun/rer dev just-every/run-bifocal`
(set up only: `npx -y @runeditrun/rer setup just-every/run-bifocal`; without
Node, `curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-bifocal`).
It clones, installs, sets up a local owner and starts the app; to start it again
later, run `cd run-bifocal && rer dev`. Run all other first-party operations
from the composed, runnable edition checkout with `rer`. The detailed flags and
effects are in `RUN-LOCALLY.md` and `SEED-COMMAND-CONTRACT.md`.

To install for a real owner instead, run the verbs yourself inside the checkout:

```sh
rer install
rer setup --owner-email you@example.com
rer dev
```

Use the setup prompt instead of the owner-email flag when entering the real
mailbox. Open the printed `RER_OPEN` link to sign in as the owner. Development
and demo mail is silently suppressed. Stop `dev` with
`rer dev --stop` or Ctrl-C, and stop `preview` with
`rer preview --stop` before build or verification.

In dev and demo, invite a person and choose **Sign in as <name>** in operator
access or at `/signin`. The same one-click entry opens `/app` with their assigned
role. Each local browser profile first opens `RER_OPEN` for the checkout key
cookie. Mail is silently suppressed; there is no email-reading step.

```sh
rer verify
rer reset --yes
rer deploy
rer describe
```

To back up and restore this installation, use:

```sh
rer export --output exports/installation.rer
rer import --input exports/installation.rer --yes
```

These commands save and restore a supported installation archive. They do not
use the reviewed import door or provide its plan, reconciliation and Undo.
Archive restore requires an empty destination and explicit confirmation.
Business-record move-in uses the separate bounded file door at `/app/import`; installation archives never replace its review, reconciliation or Undo.

Use `rer describe` to inspect the checkout's actual
capabilities. `rer check --profile first-party` validates the
declared command contract; it does not run application journeys or contact a
provider.

## Local data and recovery

Setup and development use explicit owner identity and real local migrations.
Dev and preview use the same owner and canonical `.wrangler/state`. Local dev
sign-in uses the checkout’s private key; keep `RER_OPEN` private. Private
settings are kept in `.dev.vars` with mode 0600 and are not copied into build output.

Local export creates a private archive with an integrity receipt and explicit
exclusions. Bifocal's adapter explicitly includes its bounded file-import tables and original
bytes, operator definitions (including the original owner and membership state),
external identity mappings, bootstrap and owner-claim records, auth audit and
settings, and import grant/approval records. See the exact table inventory in
`scripts/installer/local.mjs`; this is not a complete BI archive under BIF-033.

Native sessions, provider session/link credentials, private settings and platform
bookkeeping do not travel. The pinned exporter disables provider sign-in and
first-run enablement and suspends local development personas. It does not turn
ordinary retained members or import grants/approvals into inactive definitions.
Fresh-owner reauthorization and inactive-grant restore remain unfinished under
BIF-033; do not use this archive to transfer an installation to a different owner.
Treat archives as private identity and business data.

Archive restore validates and restores atomically into an empty destination;
confirmed reset preserves export archives. Setup recreates private configuration,
not a new owner: use the archived owner's email, then recover access through
native sign-in. Conflicting owner email must be resolved through the supported
owner path, not by changing setup answers. Both CLI setup and the supported browser installer check the canonical retained owner and refuse a different email before recreating private settings. The browser installer delegates to the same bounded CLI setup command. The bounded CLI owner/company round trip, private-setting/session exclusions, nonempty refusal and changed-owner browser refusal are exercised by the explicit restore journey in tests/demo-owner-claim.test.mjs. Complete domain equivalence and remote transfer remain unproved for Bifocal.

Preserve ambiguous state and applied migration history. Never place a remote
credential, owner secret or local resource ID in source. A schema change needs
a forward migration and verified transition/recovery.

## Deployment

`rer deploy --dry-run` validates the owner-account deployment declaration and
builds locally, then reads the target's secret-binding names using privately
supplied `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Missing credentials
or a refused target read fail the dry run. It performs no provider writes,
uploads, secret changes or resource creation. It does make provider requests.

Real deployment also requires the declared owner/session/setup secrets and a
sender authorized and verified with the selected mail provider. The checked-in
`MAIL_FROM: auth@example.invalid` in `deploy.json` is a placeholder, not a usable
sender. Replace it before hosted deployment and supply that provider's key as
`MAIL_API_KEY` privately. Setup and dry-run syntax validation currently accept
this placeholder; neither validates sender ownership or provider verification.
Shared placeholder rejection remains an upstream dependency, and hosted
sign-in/mail proof is pending. Follow the owner-account deploy-kit
instructions under `node_modules/@runeditrun/rer/modules/deploy-kit`; account scope,
resource ownership, migrations, receipt and health checks are defined there.
Local validation does not prove hosted acceptance, provider delivery or remote
health.

The installed `/docs` guide is static edition documentation available signed out, without visiting the separate Run site. People (`/app/people`) delegates invitation cancellation and eligible account deactivation/reactivation to the native handlers; it does not offer owner changes. People also links to each eligible account’s active sessions at `/app/people/sessions`: owners can manage any account, admins can manage themselves and members, and every read and revocation uses the native session handler. Ending a session does not deactivate the account; a fresh sign-in remains possible. Your settings (`/app/settings`) lists your active sessions and can revoke one, including the current session. Native API clients retain their JSON/204 responses; browser forms return useful pages. Role and status changes invalidate old sessions, and reactivation does not restore them.

### Dependency signing-key custody

Selected Base source is pinned at `4280971d7c0295b8a88c3e1179048efcbbe14f30`; the command package remains exactly `@runeditrun/rer` 0.2.79. Setup manages `INSTALLATION_KEY` in private settings, including when upgrading an older setup. Dependency signing keys use Base’s authenticated encrypted envelopes. The forward-only `0023_dependency_key_custody.sql` migration adds custody metadata without changing applied SQL. Deploy declares the current installation key and an optional previous key for explicit rotation; rer manages these in its private deployment secrets file. Neither installation key nor dependency private signing keys travels in an installation archive. Preserve private deployment custody for older D1 backups; follow the adopted dependency module’s rotation/reopen instructions before retiring a key. This adoption does not change retained-owner or inactive-grant restore limitations.

The forward-only company-default normalization (0024) gives untouched built-in defaults no owner-authored update time (`updatedAt: null` at the company API). Owner-saved revisions and timestamps are preserved. This makes a fresh destination’s migration row reproducible for Base’s exact empty-state restore check; populated destinations remain refused. Backward restore of archives preceding this migration remains unqualified; Base migration-data refusals remain enforced.
