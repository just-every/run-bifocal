Your whole Bifocal installation can be saved to one archive file and restored from it. Keep a backup before you reset
an installation or move it to another computer.

## Back up

Stop Bifocal first, so nothing writes while the archive is made. From the `run-bifocal` folder:

```sh
rer dev --stop
rer export --output exports/bifocal.rer
```

`rer export` saves the installation's records to `exports/bifocal.rer` with an integrity receipt: the owner and the
people you invited with their roles, sign-in settings and history, and your imported datasets with their original
files. It leaves out sign-in sessions and links, private settings and other state that belongs to this computer
only. A large installation takes a while; the command prints a line every few seconds with the parts done and the
time left.

Keep the archive private: it holds your installation's records.

## Restore

A restore goes into an empty installation only. To restore into the same folder, reset it first, then import, then
run setup with the email address of the owner the archive was made with:

```sh
rer reset --yes
rer import --input exports/bifocal.rer --yes
rer setup --owner-email you@example.com
rer dev
```

`rer reset` removes this installation's local data and settings and keeps the source, the dependencies and your
`exports/` folder; it refuses while Bifocal is running. `rer import` checks the archive and restores it; if it stops
part way, run the same command again and it starts over cleanly. `rer setup` recreates this computer's private
settings and keeps the archived owner instead of making a new one, so give it that owner's address; it is not a way
to change the owner. Then `rer dev` starts the restored Bifocal. Sign in again, since sessions are not in the
archive; provider sign-in starts out turned off.

## What a backup is not

The archive is a copy of one installation of Bifocal. It is not an export for other reporting tools, and it cannot
be uploaded anywhere in the app.
