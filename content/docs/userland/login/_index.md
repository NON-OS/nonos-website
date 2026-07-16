---
title: "capsule_login"
description: "capsulelogin is the session gate that stands between boot and the desktop."
weight: 400
---
`capsule_login` is the session gate that stands between boot and the desktop. It comes up locked, paints a
full-screen lock overlay, and holds the desktop there until a caller asks it to start a session. Starting a
session means unlocking a key in the [keyring](/docs/userland/keyring/); once the keyring authorizes the
unlock, login records the session, tells the desktop shell the session is live, and repaints to the
unlocked color. It is the visible gate and the session bookkeeper. It is not the credential authority, and
it holds no secret of its own.

The one fact to carry into every page below: there is no passphrase in this capsule. The `START_SESSION`
body is a bare 4-byte little-endian key id, with no text field, no character buffer, and no input
subscription; the overlay renders no glyphs ([`src/protocol/limits.rs:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L4), [`src/server/handlers/start_session.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs#L14),
[`src/render/mod.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/mod.rs#L7)). The credential lives in the keyring, not here.

This documentation mirrors the source tree one page per pillar, so a page can be read beside the folder it
describes.

## Contents

- [Identity](#identity)
- [The three pillars](#the-three-pillars)
- [Lifecycle](#lifecycle)
- [Source map](#source-map)

## Identity

Everything the kernel and the service registry need to name and reach login comes from its `Capsule.mk` and
its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `login` | `Capsule.mk:1` |
| Service handle | `login` | `Capsule.mk:2`, [`src/userspace/capsule_login/spawn.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_login/spawn.rs#L29) |
| Namespace | `systems.nonos.login` | `Capsule.mk:7` |
| Service endpoint | `service:4416:login` | `Capsule.mk:8`, `spawn.rs:30` |
| Reply endpoint | `reply:4417:endpoint.login.reply` | `Capsule.mk:9`, `spawn.rs:31`, `:32` |
| Capability mask | `0x19` | `Capsule.mk:11`, `spawn.rs:34` |
| Binary name | `login` | `Capsule.mk:5` |
| Kernel mirror | `src/userspace/capsule_login` | `Capsule.mk:12` |

The mask `0x19` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x01  CoreExec   bit()  1    types.rs:56
  0x08  IPC        bit()  8    types.rs:59
  0x10  Memory     bit() 16    types.rs:60
  ----
  0x19  = 1 + 8 + 16
```

The kernel spawn path requests exactly `0x19` and no more ([`src/userspace/capsule_login/spawn.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_login/spawn.rs#L34)). Note
that the `Capsule.mk` comment reads `IPC | Memory = 0x08 | 0x10 = 0x19`, which is a slip: `0x08 | 0x10` is
`0x18`, and the extra bit is `CoreExec` (`0x01`), which every capsule carries to run at all. The value on
the line, `0x19`, is the one that is enforced, and it decodes to CoreExec, IPC, and Memory. There is no
`Crypto` bit (32), no `GraphicsSurfaceCreate` (4096) or `GraphicsPresent` (16384), no `Network` (4),
`FileSystem` (64), or any hardware bit ([`src/capabilities/types.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L61), `:62`, `:58`). Login speaks IPC,
has a heap, and runs; it cannot sign, cannot own the screen, cannot touch a device, and cannot reach the
network or a filesystem.

There is one consequence worth stating plainly at the identity level. Login has no keyboard interaction of
its own: no text field on the overlay, no character buffer, no key handler, and no input subscription. Its
runner receives only on its service inbox ([`src/server/runner.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L30)), and its overlay is a solid fill plus
one decorative bar that renders no glyphs ([`src/render/mod.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/mod.rs#L7), `:12`). What a person perceives as
"unlocking" is a caller sending `START_SESSION` with a key id over IPC, not a keystroke into login. The
passphrase prompt a user expects to type into is not part of this capsule; if a desktop profile has one, it
lives in the caller that decides which key id to unlock.

## The three pillars

The source under `userland/capsule_login/src/` splits into three concerns, and the documentation is one page
each. A request comes in over IPC, is parsed and dispatched (the protocol pillar), drives the unlock and the
peer signals (the unlock pillar), and ends in a repaint of the overlay presented by the compositor (the
rendering pillar).

```
  protocol/ + server/   ->   state/ + clients/   ->   render/ + setup/ + clients/compositor/
  the wire and the           the session machine,     the overlay and the surface it is
  four-op dispatch           the keyring gate,        submitted through
                             the desktop signal
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [protocol.md](/docs/userland/login/protocol/) | `src/protocol/`, `src/server/` | The `NLGN` wire format, the four operations, the receive loop and op dispatch, and the four handlers. |
| [unlock.md](/docs/userland/login/unlock/) | `src/state/`, [`src/clients/keyring.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/keyring.rs), [`src/clients/desktop_shell.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/desktop_shell.rs) | The two-state session machine, the keyring `UNLOCK`/`LOCK` gate, the desktop-shell notify that hands off the desktop, and the transactional rollback. |
| [rendering.md](/docs/userland/login/rendering/) | `src/render/`, `src/setup/`, `src/clients/compositor/` | The overlay painter (no text), the setup path that discovers peers and brings up the backing surface, and the compositor client that submits and presents it. |
| [contributing.md](/docs/userland/login/contributing/) | the whole tree | Where to work, how to change a handler or a peer wire, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/login/debugging/) | runtime | The boot marker, the setup-ordering stall, and the concrete failure signatures when an unlock fails or the desktop never launches. |

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initializes the heap, blocks in `wait_for_setup` until setup
succeeds, then enters the server loop ([`src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L32)). It is spawned in the desktop-services fleet as
`boot::capsule("LOGIN", "login", ...)` ([`src/userspace/init/spawn_plan/desktop_services.rs:66`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_services.rs#L66)), through the
[verified spawn](/docs/security/capsules-and-trust/) path: its signature, manifest, and requested
capabilities are checked before its ELF is mapped ([`src/userspace/capsule_login/spawn.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_login/spawn.rs#L36)). On success
the kernel prints `[LOGIN] capsule spawned` on the boot log ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29));
the [debugging](/docs/userland/login/debugging/) page covers what that marker and its absence mean.

Setup is order-dependent: login must find three peers by name before it can serve, the keyring, the desktop
shell, and the compositor ([`src/setup/run.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L22)). It then health-checks the compositor, sizes a
full-screen backing surface, paints the locked overlay, and submits it as a scene layer at `OVERLAY_Z = 1`
([`src/setup/run.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L25), `:37`, `:45`, [`src/setup/constants.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/constants.rs#L18)). Once the overlay is up it drops into the
receive loop and answers its four-operation protocol. The [rendering](/docs/userland/login/rendering/) page follows the setup
path in full, and the [protocol](/docs/userland/login/protocol/) page follows the loop.

## Source map

```
  userland/capsule_login/src/main.rs        _start -> wait_for_setup -> server::run
  userland/capsule_login/src/protocol/      the NLGN wire, ops, limits, errnos, decode/encode
  userland/capsule_login/src/server/        the receive loop and the four handlers
  userland/capsule_login/src/state/         the Locked/Unlocked session machine
  userland/capsule_login/src/clients/       the keyring, desktop-shell, and compositor clients
  userland/capsule_login/src/render/        the locked/unlocked overlay painter (no text)
  userland/capsule_login/src/setup/         peer discovery, surface bring-up, submit at z=1
  userland/capsule_login/Capsule.mk         slug, endpoints, CAPSULE_REQUIRED_CAPS = 0x19
  src/capabilities/types.rs                 the capability bit values behind the mask
  src/userspace/capsule_login/spawn.rs      the kernel-side embed and verified spawn
  src/userspace/init/spawn_plan/desktop_services.rs   the desktop-fleet spawn entry (LOGIN)
```

Every reference above is verified against those trees.