Bifocal runs on your own computer: you own the copy, the data and the code. Starting it takes one line.

## Start Bifocal

With Node 22 or later installed, run:

```sh
npx -y @runeditrun/rer dev just-every/run-bifocal
```

Without Node, install `rer` first; the installer brings its own Node and edits none of your shell files:

```sh
curl -fsSL https://runeditrun.com/install.sh | sh
rer dev just-every/run-bifocal
```

If the installer ends with a line to run, run it before the second line: it puts `rer` on your PATH for this
terminal and for new ones. Bifocal runs on macOS, Linux, or Windows with WSL2, with git installed; `rer` brings pnpm.
The same two lines are on the [Run Bifocal](/run) page.

## What the line does

`rer` clones Bifocal into a folder named `run-bifocal`, installs its dependencies, makes you the owner of this
installation and starts it. A first start can take several minutes and prints its progress as it goes. If the command
is interrupted, run it again: it picks up where it stopped.

When Bifocal is ready, `rer` prints:

- `RER_READY` and the address Bifocal answers on, on this computer only.
- `RER_SIGNED_IN` and the owner's email address.
- `RER_OPEN` and a private link. Open it on this computer and Bifocal opens signed in as you, the owner. Treat the
  link like a password: anyone who has it can sign in as you.

## Finish setup

The first time you open Bifocal it shows **Finish setup**. Check your name, tick
**I confirm this owner account is ready to use** and choose **Finish setup**. Until you do, Bifocal sends you back to
this page. Then the app home opens.

## The front page

The installed Bifocal's front page is its Lobby: the Bifocal mark and one button. Before the owner is set up the
button reads **Finish setup**; after, it reads **Sign in**. The Lobby is the same for every visitor and shows nothing
about your installation beyond that.

## Start it again, and stop it

To start Bifocal again later, from the folder you started it in:

```sh
cd run-bifocal && rer dev
```

In a terminal, `rer dev` stays in the foreground: press Ctrl-C to stop it. If it is running in the background, stop
it from the `run-bifocal` folder with:

```sh
rer dev --stop
```
