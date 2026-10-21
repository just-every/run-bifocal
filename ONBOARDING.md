# Foundation setup adapter

This checkout currently provides the Base foundation, not the BI product.
Start with the installed Lobby at `/`, sign in at `/signin`, finish first-run
setup at `/setup`, then open `/app`. The current app home only confirms the
signed-in person's display name; People and analytics workflows are not built.
The separate public Run site provides `/run` and `/contract`.

Bifocal has no product import screen yet: `/app/import` is not usable.
BIF-003 (files and spreadsheets) and BIF-025 (incumbent migration) remain
missing. Installation archives use the separate `rer export` and `rer import`
commands; they do not import business records or replace the product import door.

When implementing data move-in, mount Base's shared door at `/app/import` for
supported source exports, with review, exact-plan approval, reconciliation and
Undo. Do not add a separate importer. Base's reference people-JSON reader is
not a Bifocal business-data importer, and `.rer` archives are not door uploads.
Follow Base's [door adoption guide](https://github.com/runeditrun/base/blob/main/modules/import-kit/src/door/ADOPTING.md).

First-party setup runs through `rer setup`. To set up a fresh clone in one line,
run `npx -y @runeditrun/rer setup just-every/run-bifocal` with Node 22 or later.
Use `dev` in place of `setup` to also start the app. Without Node, use
`curl -fsSL https://runeditrun.com/install.sh | sh -s -- setup just-every/run-bifocal`.
Inside the checkout, the bare `rer setup` does the same. The public
command's flags, effects, state handling and exits are defined in
`SEED-COMMAND-CONTRACT.md`; use `RUN-LOCALLY.md` for the owner workflow. The
onboarding package supplies the shared lifecycle used by the command adapter.
It is not a separate first-party setup command.

## Edition-owned inputs

The foundation edition owns:

- `rer-setup.json`, the single source of setup fields, groups, defaults,
  managed secrets and ordered setup steps;
- `scripts/installer/local.mjs`, the declarative adapter for actual build,
  migration, start, health, owner, sign-in, deployment and portability behavior;
- `scripts/installer/ui/seed.mjs` and its background artwork, which describe
  the product presentation for setup surfaces;
- `src/branding.json`, which stores the app's actual name and color.

The current manifest collects `APP_NAME`, `PRIMARY_COLOR`, `OWNER_EMAIL`,
`SESSION_SECRET` and `SETUP_TOKEN`. The owner email is required; the local CLI
may prompt for it or accept the documented owner-email flag. Managed secrets
are kept private. The branding hook writes application values before the real
build; the owner-claim step uses the declared owner and setup-token fields.
Keep setup defaults factual and do not infer owner identity or credentials.

The adapter exports `install` and `commandAdapter`. The command adapter points
to the same root manifest and declares the real internal targets: build,
migrations, Vite development, production preview, verification, owner-account
deployment and local portability. Keep internal targets distinct from public
RER aliases to avoid recursive calls.

## Lifecycle and safety

RER validates answers before effects. Setup preserves an existing owner, data
and exact private settings on reruns; it does not create a second owner or
rotate secrets. It performs the real build and local migrations, prepares the
first owner through operator-auth.
The temporary local Worker stops before setup exits. Local tooling proves
installation ownership using the session secret, without sending mail.
Development and demo mail is silently suppressed.

The shared adapter lifecycle captures declared child commands, redacts
credential values from output and private logs, stops owned descendants on
failure or cancellation, and restores private settings after build. Adapter
hooks must use the shared command store for child work, report the actual
health endpoint, and preserve process cleanup. Never pass secrets as command
arguments, print generated values, or add sample providers or mock runtime
fallbacks.

Canonical local durable data is `.wrangler/state`; private settings and
installer records remain outside source control. State selection rejects
symlinks, unsafe overlap and ambiguous prior state. Preserve unclear bytes and
require explicit recovery. To back up and restore this installation, use the declared portability
policy, verifies archives and restores atomically into an empty destination.
Every first-party seed verifies a complete local export/import/export round
trip across supported resources. Remote transfer requires complete resource
coverage; unsupported targets fail visibly.

Preserve applied migration history. Make schema changes with forward
migrations and verify transition and recovery for existing data. The edition
owns its real resource names, migration choices, auth behavior, data policy
and deployment inputs. Keep authorization in every private server handler and
keep server-only secrets out of client bundles.

For command flags, reset inventory, transfer exclusions, account credentials,
managed foreground server lifecycle, and verification boundaries, follow
`RUN-LOCALLY.md` and `SEED-COMMAND-CONTRACT.md`. Local checks do not prove
provider delivery or hosted acceptance.
