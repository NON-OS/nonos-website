---
title: "The Terminal"
description: "The terminal is a GUI capsule and a shell: a window that renders a scrollback and a prompt, and a command interpreter behind it with pipelines, redirects, aliases, and a set of ..."
weight: 7
---
The terminal is a GUI capsule and a shell: a window that renders a scrollback and a prompt, and a
command interpreter behind it with pipelines, redirects, aliases, and a set of builtins. It is also the
clearest worked example of an [app-skeleton](/docs/userland/writing-an-app/) application. This page documents it. The
code is `userland/capsule_terminal/`.

## An app-skeleton application

The terminal is an ordinary NØNOS GUI app. Its entry point hands its `App` implementation to the
skeleton's `run` ([`userland/capsule_terminal/src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_terminal/src/main.rs)):

```
  #[no_mangle]
  pub unsafe extern "C" fn _start() -> ! {
      run(term::Terminal::new)
  }
```

`Terminal` implements the [`App` trait](/docs/userland/writing-an-app/): a `manifest` (a normal window,
[`term/manifest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/manifest.rs)), an `on_event` that feeds keystrokes to the line editor and the command
interpreter, and a `paint` that draws the frame. Everything below, surface registration, window
management, input delivery, is the skeleton's job, so the terminal's own code is the shell and the
rendering, not the plumbing.

## The shell

The command side (`src/command/`) is a real shell, not a fixed menu. A line is parsed into statements
and run through a dispatch that supports the constructs you would expect:

```
  pipelines        cmd1 | cmd2 | cmd3           (dispatch/pipeline.rs)
  redirects        cmd > file, cmd >> file       (dispatch/redirect.rs, write_redirect.rs)
  statements       cmd1 && cmd2 ; cmd3           (dispatch/statements.rs, the Conn connectors)
  aliases          expanded before execution     (dispatch/alias_expand.rs)
  expansion        argument expansion             (dispatch/expand.rs)
```

`split_program` breaks a line into statements joined by connectors (`&&`, `||`, `;`), each statement is
a pipeline of commands, and each command is alias-expanded and argument-expanded before it runs. The
`Outcome` of a command flows to the next through the pipeline. So the terminal is a shell in the usual
sense: you can pipe one command into another, redirect output to a [file](/docs/userland/std-pal/), and chain
commands conditionally.

## The builtins

The builtin commands live under `src/command/builtin/`:

```
  about      capsules    clear     display    echo
  history    market      motd      nox        ping
  service    version     whoami    exit
```

They are the terminal's native verbs: `capsules` and `service` inspect the running capsule fleet and the
service registry, `display` queries the screen, `ping` exercises the [network](/docs/userland/networking-guide/),
`nox` and `market` reach the NOX and market capsules, `motd`, `about`, `version`, and `whoami` report
system and identity, and `clear`, `echo`, and `history` are the usual shell conveniences. A command not
matched as a builtin is dispatched through the same pipeline machinery, so the builtin set is the
starting vocabulary, not the boundary.

## The rendering

The paint side (`src/paint/` and `src/term/`) draws the terminal frame into the app's
[surface](/docs/subsystems/graphics/surfaces/): a header, a tab strip, the scrollback grid, the input
line with a cursor, and a footer, themed through [`term/theme.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/term/theme.rs) and a palette. The `term` module holds
the terminal model, the scrollback, the dimensions, the theme, the banner and MOTD, and the paint
module renders that model row by row. Because it is an app-skeleton app, the render lands in a shared
surface that the compositor presents, exactly like any other window.

## Using it

The terminal is spawned as part of the desktop fleet at boot (it is a signed capsule embedded and
verified like the others). Once the desktop is up, it is a window: type a command at the prompt, and it
runs through the shell above. To extend it, a new builtin is a module under `command/builtin/` wired
into the dispatch; to understand the app model it is built on, read [writing an app](/docs/userland/writing-an-app/),
for which the terminal is the reference implementation.

## Source

```
  userland/capsule_terminal/src/main.rs        the app entry (run(Terminal::new))
  userland/capsule_terminal/src/term/           the terminal model, manifest, theme, scrollback
  userland/capsule_terminal/src/command/        the shell: parse, dispatch, pipelines, builtins
  userland/capsule_terminal/src/paint/          the frame rendering
  src/userspace/capsule_terminal/               the kernel-side embed and spawn
```
