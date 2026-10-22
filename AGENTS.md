# Agent instructions

This checkout provides the Base foundation and a bounded owner-only CSV/XLSX import HTTP backend. The browser file workflow and bounded exact-answer APIs are available; the full BI product is unfinished.
Start with the installed Lobby at `/`, sign in at `/signin`, finish first-run
setup at `/setup`, then open `/app`. The app home describes the foundation capability state and links to existing
account tools, Lobby, Run and contract pages, with native sign-out.
`/app/settings` saves the signed-in account’s display name through the native
`/auth/display-name` handler.
People and invitations are available at `/app/people` through native account
authorization. Only foundation owner/admin/member roles exist; analytics
workflows and roles are not built.
The separate public Run site provides the homepage, `/run`, `/docs` and `/contract`.

The owner file workflow is at `/app/import`: prepare, review, approve, reconcile, inspect history and originals, Undo and erase. `/app/queries` creates exact immutable answers and saves tabular dashboard/report results. Native US company/calendar/rate APIs are documented in `docs/US-CONVENTIONS.md`.
The file HTTP backend uses Base’s shared review/apply/reconcile/Undo door; see
`docs/FILE-IMPORT.md` for its bounds and explicit unfinished scope.
BIF-003 and BIF-057 are partial; BIF-025 (incumbent migration) remains missing. Installation archives use the separate `rer export` and `rer import`
commands; they do not import business records or replace the product import door.

When implementing data move-in, mount Base's shared door at `/app/import` for
supported source exports, with review, exact-plan approval, reconciliation and
Undo. Do not add a separate importer. Base's reference people-JSON reader is
not a Bifocal business-data importer, and `.rer` archives are not door uploads.
Follow Base's [door adoption guide](https://github.com/runeditrun/base/blob/main/modules/import-kit/src/door/ADOPTING.md).

## Launch for review

When asked to launch, run or review this app, run this from the checkout root
and nothing else:

```sh
rer dev
```

- It installs and sets up a fresh checkout by itself and prints progress; a
  first launch can take several minutes. Give the shell tool at least 10
  minutes. If the tool times out, run the same `rer dev` again: it resumes.
- Never run install, setup, reset or deploy for this, and never ask for an
  email, port, password or answers file.
- Give the owner the `RER_READY` address and the `RER_OPEN` link, and ask
  nothing. `RER_OPEN` is a credential: share it only with the owner, in this
  chat.
- Stop the app with `rer dev --stop`. If a start is refused, the message names
  the cause and the next command: run that command.

Without `rer` on PATH, install it once with `npx -y @runeditrun/rer cli install`
or the installer script: `curl -fsSL https://runeditrun.com/install.sh | sh`.
For the current shell, run `export PATH="$HOME/.local/bin:$PATH"` after installing.

## Run it locally

This guide ships with a composed, runnable foundation edition. To install for a
real owner instead of a review launch, run the verbs yourself from that
edition's checkout root. `rer` runs each verb with this checkout's own pinned
package (`@runeditrun/rer`).

```sh
rer install
rer setup --owner-email you@example.com
rer dev
```

Commands that run project work select the exact Node version declared by the
project. They use an exact matching installed runtime or a checksum-verified
copy cached at `~/.rer/node/node-vVERSION-PLATFORM-ARCH/`; when needed on
supported platforms, the runner retrieves the official Node release and checks
its SHA-256 against `SHASUMS256.txt`. It does not change global Node installations.
Set `RER_NODE_AUTO=0` to disable automatic selection. If selection is disabled
or acquisition fails, the command reports a repair invocation in this form:
`npm exec --yes --package=node@VERSION -- node SCRIPT VERB --cwd PROJECT`.
Help, check, describe, doctor and stop do not select or acquire Node.

After `RER_READY`, `dev` prints `RER_SIGNED_IN EMAIL` and `RER_OPEN URL`.
Open that URL on this computer: the app opens signed in as the owner and
finishes first-run setup at `/setup`. Treat the line as a credential.
`dev --as PERSONA` starts as a persona or signed out. Legacy `dev --login`
uses the same automatic sign-in. Until first-run completion is stored durably, app routes send the signed-in owner to `/setup`;
signed-out visitors sign in and return there. Once complete, `/setup` opens the
app or settings. Development and demo mail is silently suppressed.

The saved local port is used; a first setup saves the first free port from 8787. Explicit ports are decimal
integers from 1 through 65535 and must be free; a busy requested port fails
instead of silently moving. Only `127.0.0.1`, `localhost` and `::1` are allowed.
Dev applies the selected host and port to both the listener and runtime bindings;
readiness is bounded and failure stops the owned processes.

Missing non-interactive setup answers exit 3 and name the manifest fields.
Read `rer-setup.json` and pass a private, mode-0600 JSON object keyed by those
names using `rer setup --answers PATH --non-interactive`,
for example `{"OWNER_EMAIL":"owner@example.com"}`. Secret values stay in
private inputs and never go in command arguments. A setup rerun with the saved
owner and origin preserves existing owner/data and exact private settings.
Conflicting saved identity or origin reports an actionable recovery path.
Review reset's exact removal inventory before confirmation. If data must be
kept, back up this installation first; restore that archive
only into an empty destination.

Queue waits report their reason and live position while the command waits. Package mode has no queue status command.

Use the setup prompt instead of `--owner-email` when entering the real owner
mailbox. Open the `RER_OPEN` URL printed by `dev` on this computer; the app opens
signed in as the owner, including with legacy `dev --login`. No external
email is sent in development or demo mode. Stop `dev` with
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

Reset removes declared local data and settings. Archive restore requires an empty
destination and explicit confirmation. Read `RUN-LOCALLY.md` for supported
flags, private state, deployment inputs and remote limitations.

`pnpm typecheck` and `rer verify` use checkout-local, gitignored
`.cache/typecheck.tsbuildinfo`; deleting it forces a full check, while
`rer build` builds the real Worker and assets.

## Work on this foundation

Choose and verify the edition UX before adding product functionality. This
source includes minimal real owner/operator auth, D1 and silent development
mail suppression. Its current product domains are bounded file/range datasets, native company conventions and immutable exact answers; it has no general background jobs.

A change that ships or alters a contract clause updates that clause's row in
`CONTRACT.md`'s Status table in the same PR; `rer check` refuses a table that
disagrees with the contract.

When adding private HTTP routes or Start functions, reuse native sessions and
enforce authorization in every server function handler, including direct
transport calls; route guards alone are insufficient. Use server-only modules
and dynamic imports inside `createServerFn` handlers so secrets never enter the
client. Consult the pinned Base migration recipe and default-seed reference and
run equivalent direct unauthenticated transport checks.

Keep actual Queue/Cron handlers and named Worker exports in `src/server.ts`
when adding those capabilities. The dispatcher only selects HTTP ownership; it
does not authenticate or catch failures.

`setup` builds, applies declared migrations, prepares the explicit first
owner and stops its temporary Worker. `dev`
serves actual Vite HMR with the same auth and data. Managed foreground servers
remain active in their first invocation; compatible repeated invocations reuse
the server and exit. Stop before build or verification.

`deploy --dry-run` validates and builds locally, then reads target secret bindings without provider writes. Real
owner-account deploy applies declared D1 migrations and checks health. Local
validation does not establish provider acceptance or remote health.

Read `ONBOARDING.md` before changing the edition-owned answer manifest, branding
or installer adapter. Keep `rer-setup.json` as the single setup manifest and
preserve the shared RER command path. The owner may change any source, core
schema, UI, framework or infrastructure. Preserve owner requirements and
applied migration history; choose any integration method and verify the result.
Roll useful implementations and tests into shared source where that supports
their maintenance.

Pinned reference: https://github.com/runeditrun/base/blob/d1249b3d696c4011e9c72de2097f3757436074a6/TANSTACK-START-MIGRATION.md
Native-session/runtime evidence: https://github.com/runeditrun/base/tree/d1249b3d696c4011e9c72de2097f3757436074a6/default-seed

## Bifocal seed scope

Read root CONTRACT.md and ACCEPTANCE.md before product work. They are ct's target drafts; no complete product clause is proven. The file backend does not establish the complete BI product. Do not add speculative BI screens, demo data, mock providers or feature claims. The run site (src/site, docs/, public/brand, public/fonts) wears the design desk's approved look and shows the target product, every claim backed by a contract clause; the installed app keeps Base's default theme until its own design round. Keep verbatim src/base copies. Research and evidence belong in private-bifocal or the lane evidence folder, never this public tree.

Use the exact published @runeditrun/rer 0.2.78 package. Run source:lock after intentional selected-source changes and source:check before pushing. Keep tests small, through public user flows, and never weaken a foundation test. Stop only processes you started, by recorded PID; do not use rer dev/demo --stop, pkill, killall or pattern-based kills. Never read or print private settings, credentials or token-bearing URLs.

The installed `/docs` guide is static edition documentation available signed out, without visiting the separate Run site. People (`/app/people`) delegates invitation cancellation and eligible account deactivation/reactivation to the native handlers; it does not offer owner changes. Your settings (`/app/settings`) lists your active sessions and can revoke one, including the current session. Native API clients retain their JSON/204 responses; browser forms return useful pages. Role and status changes invalidate old sessions, and reactivation does not restore them.
