---
title: "Contributing to capsule_terminal"
description: "This page is for a contributor who wants to change the terminal."
weight: 5
---
This page is for a contributor who wants to change the terminal. It covers where the source lives, which
folder owns which behaviour, the exact steps to add a command, how to build and sign the capsule, and the
code standards a change has to meet. For what the terminal does and how it is put together, read the
[README](/docs/userland/terminal/), the [command reference](/docs/userland/terminal/commands/), the [input model](/docs/userland/terminal/input/), the
[rendering](/docs/userland/terminal/rendering/), and the [terminal emulation](/docs/userland/terminal/emulation/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_terminal/`. It is a `no_std`/`no_main` app-skeleton GUI app: `_start`
hands `Terminal::new` to the skeleton's `run`, and the runtime owns the surface, window, input
subscription, and paint loop ([`userland/capsule_terminal/src/main.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_terminal/src/main.rs#L36)). The four top-level modules are
declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/command/` | the shell: parsing, sequencing, dispatch, the builtins | you change what a command does or add one |
| `src/event/` | input handlers: keys, ctrl chords, tab completion, history, clipboard | you change a keybinding or the line editor |
| `src/paint/` | the renderer: header, tab strip, scrollback grid, input line, cursor, footer | you change how a frame is drawn |
| `src/term/` | the terminal model: tabs, `State`, grid, vt, prompt, theme, cwd | you change the shell's data model or terminal state |

Inside `src/command/`, `dispatch/` holds the runner and the routing (statements, run, exec, pipeline,
filters, redirect, alias and variable expansion), and `builtin/` holds the command bodies. The top-level
verbs (`about`, `capsules`, `ping`, `market`, `service`, and friends) live directly under `builtin/`; the
Unix-like family (`ls`, `cat`, `cp`, `mv`, `rm`, `find`, `svc`, `run`, `install`, and the rest) lives
under `builtin/nox/`.

## Adding a command

Most new commands belong in the `nox` family. There are four edits, and the dispatch wiring is the load
bearing one.

1. Write the command module as one file per verb under `src/command/builtin/nox/`, next to the existing
   ones (for example [`nox/stat.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nox/stat.rs)). A fallible command exposes
   `pub fn run(state: &mut State, args: &[&[u8]]) -> bool` and returns `false` after pushing an error line
   ([`src/command/builtin/nox/stat.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/nox/stat.rs#L25) is the reference shape; it calls `state.scrollback.push_error`
   and returns `false` on a bad argument, [`src/command/builtin/nox/stat.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/nox/stat.rs#L27)). An infallible command can
   return `()` and be wrapped by the `true` arm in the dispatch, the way `ls` and `caps` are. A filesystem
   command resolves its path with `crate::term::cwd::resolve` and caches the owner pid with `ensure_pid`
   ([`src/command/builtin/nox/ensure_pid.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/nox/ensure_pid.rs#L5)).

2. Wire it into the dispatch table. Add the module to the `use super::{...}` import list at the top of the
   match module ([`src/command/builtin/nox/dispatch.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/nox/dispatch.rs#L17)) and add a match arm in `dispatch`
   ([`src/command/builtin/nox/dispatch.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/nox/dispatch.rs#L35)). A fallible command's arm evaluates to its `bool`; an
   infallible command's arm calls `run` and evaluates to `true`. Put any familiar alias on the same arm
   with `|`, the way `b"ls" | b"dir"` and `b"read" | b"cat"` are wired
   ([`src/command/builtin/nox/dispatch.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/nox/dispatch.rs#L40)). The value the arm produces becomes `state.last_status`,
   which is what `&&` and `||` gate on ([`src/command/builtin/nox/dispatch.rs:135`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/nox/dispatch.rs#L135)). A word no arm matches
   falls to the `other =>` arm and runs `unknown`, reporting failure
   ([`src/command/builtin/nox/dispatch.rs:130`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/nox/dispatch.rs#L130)).

3. If the command should be a top-level verb instead of a `nox` sub-command, add the arm to `exec` rather
   than the `nox` dispatch ([`src/command/dispatch/exec.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/dispatch/exec.rs#L29)). Keep the module under
   `src/command/builtin/`. Most verbs there build an `Output` over `state.scrollback` and call the
   builtin, the way `about` and `echo` do ([`src/command/dispatch/exec.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/dispatch/exec.rs#L32)).

4. Make it discoverable. Add the verb and any alias to the completion table so Tab completes it
   ([`src/event/complete.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/event/complete.rs#L21)), and add a line to the help index so `nox help` lists it
   ([`src/command/builtin/nox/help.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/nox/help.rs#L19)).

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk:158` and pulled in through
`userland/capsule_terminal/Capsule.mk`.

```
  make nonos-mk-terminal              build the capsule ELF          capsule.mk:182
  make nonos-mk-terminal-sign         id cert, manifest, attestation capsule.mk:261
  make nonos-mk-terminal-verify       verify artifacts vs trust anchor capsule.mk:263
  make nonos-mk-check-terminal-keys   assert the per-capsule signing keys exist capsule.mk:184
```

For a bootable image that includes the terminal:

```
  make nonos-mk-terminal-prod         full desktop GUI image         Makefile:1165
  make nonos-mk-terminal-only-prod    terminal-only kernel profile   Makefile:1168
  make nonos-mk-terminal-test         autorun-selftest build         Makefile:1177
```

`nonos-mk-terminal-test` builds under the `nonos-autorun-selftest` feature and re-signs
(`Makefile:1182`); [`tests/boot/terminal_round_trip.sh`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/tests/boot/terminal_round_trip.sh) runs it and restores the plain GUI capsule
afterward (`Makefile:1414`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every command reports an error as a
  pushed scrollback line and a `false` status, never a panic; the release profile is `panic = "abort"`.
- One unit per file. New commands are one verb per file under `builtin/` or `builtin/nox/`, and `mod.rs`
  is used only for re-exports, matching the existing tree.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/command/builtin/nox/dispatch.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/command/builtin/nox/dispatch.rs#L1) and every other module.

## Source map

```
  userland/capsule_terminal/src/main.rs               _start -> run(Terminal::new); the four modules
  userland/capsule_terminal/src/command/dispatch/     statements, run, exec, pipeline, filters, redirect
  userland/capsule_terminal/src/command/builtin/      top-level verbs
  userland/capsule_terminal/src/command/builtin/nox/  the Unix-like family and its dispatch table
  userland/capsule_terminal/src/event/complete.rs     Tab completion table
  userland/capsule_terminal/src/command/builtin/nox/help.rs   the help index
  userland/capsule_terminal/Capsule.mk                slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                                 the nonos-mk-terminal[-sign|-verify] target templates
  Makefile                                            the -prod, -only-prod, and -test image targets
```

Every reference above is verified against those trees.
