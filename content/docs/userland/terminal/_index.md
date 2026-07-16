---
title: "The Terminal Capsule"
description: "The terminal is the reference NØNOS application: a signed userland capsule that draws its own window, reads the keyboard, runs a small shell, and reaches the system only through..."
weight: 400
---
The terminal is the reference NØNOS application: a signed userland capsule that draws its own window,
reads the keyboard, runs a small shell, and reaches the system only through capability-checked IPC. Its
source is organized into four pillars, and this documentation mirrors that structure one page per pillar
so a page can be read beside the folder it describes.

## Identity

| Field | Value | Source |
|-------|-------|--------|
| Slug | `terminal` | `userland/capsule_terminal/Capsule.mk:1` |
| Service handle | `app.terminal` | `Capsule.mk:2` |
| Service endpoint | `service:4722:app.terminal` | `Capsule.mk:8` |
| Reply endpoint | `reply:4723:endpoint.app.terminal.reply` | `Capsule.mk:9` |
| Capability mask | `0x1819` | `Capsule.mk:11` |

The mask decomposes into five bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|-----|-------|--------|
| CoreExec | `0x0001` | run as a process |
| IPC | `0x0008` | send and receive on its endpoints |
| Memory | `0x0010` | map its own heap and stack |
| GraphicsDisplayQuery | `0x0800` | ask the compositor for the display geometry |
| GraphicsSurfaceCreate | `0x1000` | create the window surface it draws into |

The terminal holds no filesystem, network, driver, or crypto capability of its own. Every file listing,
name lookup, or install it performs is a request to another capsule that does hold that right, checked at
that capsule's boundary. Compromising the terminal yields the terminal's mask and nothing more.

## The four pillars

The source under `userland/capsule_terminal/src/` is four top-level modules, and the documentation is one
page each. Data flows clockwise: a key comes in through `event`, may run a line through `command`, which
mutates the `term` emulator state, which `paint` turns into pixels.

```
  event/   ->   command/   ->   term/   ->   paint/
  input        the shell       the        the frame
  handling     and builtins    emulator   on screen
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [input.md](/docs/userland/terminal/input/) | `src/event/` | Every keybinding and pointer action, the key router, control chords, tab completion, copy and paste, and the multi-tab shortcuts. |
| [commands.md](/docs/userland/terminal/commands/) | `src/command/` | The shell engine: parse, dispatch, the complete builtin command reference (the `nox` family, `market`, `ping`), pipe filters, redirects, and the service wires. |
| [emulation.md](/docs/userland/terminal/emulation/) | `src/term/` | The terminal emulator: the VT escape parser, the character grid, scrollback and history, line editing, the prompt, working-directory tracking, and the tab model. |
| [rendering.md](/docs/userland/terminal/rendering/) | `src/paint/` | How a frame is produced: the repaint trigger, walking the grid, turning a cell into pixels, the cursor and palette, and delivery to the compositor. |
| [contributing.md](/docs/userland/terminal/contributing/) | the whole tree | Where to work, how to add a command, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/terminal/debugging/) | runtime | The boot marker, the failure modes, and where to look when input, a command, or the display misbehaves. |

## Lifecycle

The terminal is spawned through [verified spawn](https://github.com/NON-OS/nonos-micro-kernel/blob/main/security/capsules-and-trust.md): its signature
and attestation are checked, its requested capabilities are held against its manifest ceiling, and only
then is its ELF mapped. It registers `app.terminal` at port 4722, creates its window surface, and enters
the input-driven paint loop. A successful spawn prints `[TERMINAL] capsule spawned` on the boot log; the
[debugging](/docs/userland/terminal/debugging/) page covers what each later marker means.

## Source map

Everything here is drawn from `userland/capsule_terminal/` (the capsule source and its `Capsule.mk`),
[`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bits), and the kernel spawn mirror under
`src/userspace/capsule_terminal/`. Every reference above is verified against those trees.
