---
title: "The input_probe Capsule"
description: "capsuleinputprobe is the input stack's end-to-end diagnostic."
weight: 400
---
`capsule_input_probe` is the input stack's end-to-end diagnostic. It is a tiny signed capsule that
registers a full-screen compositor surface, subscribes to the input router, grabs the keyboard, and
echoes every printable key it receives back onto the screen. It does not read a device directly and it
does not draw a device census. What it proves is that a real key travels the whole path, from a driver
capsule through the kernel ring, through [the input router](/docs/userland/input-router/), over IPC, and
onto glass. If a character you type appears in the probe's window, the path is alive; if it does not, the
[debugging](/docs/userland/input-probe/debugging/) page walks you back up the path to the break.

Its source under `userland/capsule_input_probe/src/` is a small set of single-purpose modules, and this
documentation mirrors that structure so a page can be read beside the folder it describes.

## What it diagnoses

The probe is a live consumer of the shared input stream, not a device inspector. Concretely:

- It brings up its own drawing surface exactly the way the desktop shell does: it looks up the compositor,
  health-checks it, asks for the display geometry, maps a backing buffer, and submits it as an overlay
  ([`src/setup/mod.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L18)).
- It then subscribes to keyboard events and requests an exclusive keyboard grab from the router
  ([`src/server/runner.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L13), [`src/server/runner.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L14)).
- Every routed delivery is decoded, and each printable `KEY_DOWN` (ASCII `0x20..=0x7E`) is appended to a
  64-byte ring and rendered as a row of scaled bitmap glyphs ([`src/server/runner.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L31),
  [`src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L38), [`src/render/mod.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/mod.rs#L10)).

Because it holds a keyboard grab, a running probe captures the whole keyboard class ahead of focus, so it
is a deliberate test surface, not something to leave running under a normal desktop. See
[the input path](/docs/subsystems/input/path/) for how a grab bypasses focus and hit testing.

## Identity

| Field | Value | Source |
|---|---|---|
| Slug | `input-probe` | `userland/capsule_input_probe/Capsule.mk:7` |
| Service handle | `app.input_probe` | `Capsule.mk:8`, [`src/userspace/capsule_input_probe/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_input_probe/spawn.rs#L31) |
| Domain | `systems.nonos` | `Capsule.mk:9` |
| Namespace | `systems.nonos.app.input_probe` | `Capsule.mk:13` |
| Service port | `4792` | `Capsule.mk:14`, `spawn.rs:32` |
| Service endpoint | `service:4792:app.input_probe` | `Capsule.mk:14` |
| Reply endpoint | `reply:4793:endpoint.app.input_probe.reply` | `Capsule.mk:15`, `spawn.rs:33`, `spawn.rs:34` |
| Cargo feature | `nonos-capsule-input-probe` | `Capsule.mk:12` |
| Binary name | `input_probe` | `Capsule.mk:11`, `Cargo.toml:8` |
| Capability mask | `0x1819` | `Capsule.mk:16` |
| Kernel mirror | `src/userspace/capsule_input_probe` | `Capsule.mk:17` |

The mask decomposes into five bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants | Source |
|---|---|---|---|
| CoreExec | `0x0001` | run as a process | `types.rs:56` |
| IPC | `0x0008` | send and receive on its endpoints | `types.rs:59` |
| Memory | `0x0010` | map its own heap and stack | `types.rs:60` |
| GraphicsDisplayQuery | `0x0800` | ask the compositor for the display geometry | `types.rs:67` |
| GraphicsSurfaceCreate | `0x1000` | create the surface it draws into | `types.rs:68` |

```
  0x1819 = 0x0001 + 0x0008 + 0x0010 + 0x0800 + 0x1000
```

The kernel spawn path requests exactly those five capabilities and no others
([`src/userspace/capsule_input_probe/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_input_probe/spawn.rs#L50)). This is the same leaf-renderer envelope the desktop
shell holds: it can create a surface, learn its size, and speak IPC, and that is all. There is no
`Network` bit (`0x0004`, `types.rs:58`), no `FileSystem` bit (`0x0040`, `types.rs:62`), and no hardware,
driver, MMIO, IRQ, DMA, crypto, admin, or debug capability in the mask. In particular the probe holds no
`InputSource` capability, so it cannot post synthetic events into the kernel ring; it can only receive
what the router routes to it.

The keyboard grab is not a capability. It is an IPC request to the router, which admits it only because
`app.input_probe` is one of three named capsules on the router's grab allowlist
([`userland/capsule_input_router/src/server/handlers/grab_request.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/handlers/grab_request.rs#L25)). The grant lives in the router,
not in this capsule's mask; compromising the probe yields the probe's mask and its granted keyboard grab,
nothing more.

## The pillars

The source is a handful of modules, each with one job. Data flows from setup, into the receive loop, out
to the renderer, on every printable key.

```
  setup/   ->   server/   ->   render/
  bring up      recv loop      glyph the
  the surface   subscribe,     key history
  and clients   grab, decode   onto the surface
```

| Page | Mirrors | What it covers |
|---|---|---|
| [rendering.md](/docs/userland/input-probe/rendering/) | `src/server/`, `src/render/`, [`src/protocol.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol.rs) | How the probe reads a delivery, filters it, and turns a keystroke into pixels: the receive loop, the delivery decode, the printable filter, the 64-byte history ring, the bitmap font, and the damage commit. |
| [contributing.md](/docs/userland/input-probe/contributing/) | the whole tree | Where the source lives, which file owns what, how to build and sign the capsule, and the code standards a change has to meet. |
| [debugging.md](/docs/userland/input-probe/debugging/) | runtime | The failure modes, what a blank versus black-but-unresponsive surface means, and where to look when a keystroke never reaches glass. |

## Lifecycle

The probe is spawned through [verified spawn](/docs/security/capsules-and-trust/): its signature and
attestation are checked, its requested capabilities are held against its manifest ceiling, and only then
is its ELF mapped ([`src/userspace/capsule_input_probe/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_input_probe/spawn.rs#L37)). `_start` initializes the heap and
runs `setup::run`, exiting with code 1 on heap failure and 2 on setup failure
([`src/main.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L16)). Setup looks up the `compositor` and `input_router` services, health-checks the
compositor, queries the display geometry, maps and registers an ARGB8888 surface, submits it as an
overlay, and commits damage ([`src/setup/mod.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L18)). The runner then subscribes to keyboard events, grabs
the keyboard, and enters a blocking receive loop that never returns ([`src/server/runner.rs:12`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L12)). It is
built and injected as a proof capsule through the `nonos-mk-input-probe-inject-prod` image target
(`Makefile:1143`).

## Source map

```
  userland/capsule_input_probe/Capsule.mk           slug, handle, ports, mask, kernel mirror
  userland/capsule_input_probe/Cargo.toml           crate and binary name
  userland/capsule_input_probe/src/main.rs          _start: heap init, setup, run
  userland/capsule_input_probe/src/setup/           service lookup, surface bring-up, background fill
  userland/capsule_input_probe/src/server/runner.rs subscribe, grab, recv loop, printable filter
  userland/capsule_input_probe/src/render/          history ring, bitmap font, glyph draw
  userland/capsule_input_probe/src/protocol.rs      request and delivery wire formats
  userland/capsule_input_probe/src/clients/         compositor, display_info, input_router IPC clients
  userland/capsule_input_probe/src/state.rs         the Context struct
  src/capabilities/types.rs                         the capability bits behind 0x1819
  src/userspace/capsule_input_probe/spawn.rs        the kernel spawn mirror and requested caps
  userland/capsule_input_router/src/server/handlers/grab_request.rs  the grab allowlist
  Makefile                                          the input-probe inject image target
```

Every reference above is verified against those trees.
