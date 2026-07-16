---
title: "The Snake Capsule"
description: "capsulesnake is the classic snake game as a signed NØNOS capsule: a normal GUI window with a real game loop behind it."
weight: 400
---
`capsule_snake` is the classic snake game as a signed NØNOS capsule: a normal GUI window with a real game
loop behind it. It is also the smallest complete interactive application in the tree, so it doubles as a
worked example of a self-contained app that owns nothing but its own state and its surface. Where
[capsule_terminal](/docs/userland/terminal/) shows how large an [app-skeleton](/docs/userland/writing-an-app/) app can
get, snake shows how small one can be and still be a real, verified, least-privilege capsule.

Its source under `userland/capsule_snake/src/` is a set of single-purpose modules, and this documentation
mirrors that structure one page per pillar so a page can be read beside the folder it describes.

## Identity

| Field | Value | Source |
|---|---|---|
| Slug | `snake` | `userland/capsule_snake/Capsule.mk:1` |
| Service handle | `app.snake` | `Capsule.mk:2`, [`src/userspace/capsule_snake/spawn.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_snake/spawn.rs#L30) |
| Service port | `4732` | `Capsule.mk:8`, `spawn.rs:31` |
| Namespace | `systems.nonos.app.snake` | `Capsule.mk:7` |
| Service endpoint | `service:4732:app.snake` | `Capsule.mk:8` |
| Reply endpoint | `reply:4733:endpoint.app.snake.reply` | `Capsule.mk:9`, `spawn.rs:32`, `spawn.rs:33` |
| Cargo feature | `nonos-capsule-snake` | `Capsule.mk:6` |
| Binary name | `snake` | `Capsule.mk:5`, `Cargo.toml:16` |
| Capability mask | `0x1819` | `Capsule.mk:11` |
| Kernel mirror | `src/userspace/capsule_snake` | `Capsule.mk:12` |

The mask decomposes into five bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants | Source |
|---|---|---|---|
| CoreExec | `0x0001` | run as a process | `types.rs:56` |
| IPC | `0x0008` | send and receive on its endpoints | `types.rs:59` |
| Memory | `0x0010` | map its own heap and stack | `types.rs:60` |
| GraphicsDisplayQuery | `0x0800` | ask the compositor for the display geometry | `types.rs:67` |
| GraphicsSurfaceCreate | `0x1000` | create the window surface it draws into | `types.rs:68` |

```
  0x1819 = 0x0001 + 0x0008 + 0x0010 + 0x0800 + 0x1000
```

The kernel spawn path requests exactly those five capabilities and no others
([`src/userspace/capsule_snake/spawn.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_snake/spawn.rs#L49)). There is no `Network` bit (`0x0004`, `types.rs:58`), no
`FileSystem` bit (`0x0040`, `types.rs:62`), and no hardware, driver, MMIO, IRQ, or DMA capability in the
mask. This is the same envelope the terminal holds, and for the same reason: the game can create a
surface, learn how big it is, and speak IPC, and that is all it can do. Compromising snake yields snake's
mask and nothing more.

## The pillars

The game logic under `userland/capsule_snake/src/snake/` is one file per concern, wrapped by a thin `App`
adapter. Data flows in a loop: a key comes in through `input`, which sets the direction the next `step`
will take, `step` advances the owned `state` and re-rolls `rng` food, and `paint` turns that state into
pixels on the next frame.

```
  input   ->   state + step   ->   paint
  keys         one tick of         the frame
  steer        motion, score       on screen
               and rng food
```

| Page | Mirrors | What it covers |
|---|---|---|
| [controls.md](/docs/userland/snake/controls/) | [`src/snake/input.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs) | Every keybinding: arrow and WASD steering, Enter restart, Space and P pause, the anti-reversal guard, one-turn buffering, and the phase gates. |
| [game-loop.md](/docs/userland/snake/game-loop/) | [`src/snake/app.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/app.rs), `state.rs`, `step.rs`, `rng.rs`, `grid.rs` | The `App` adapter, the owned `Game` model and phases, the self-timed tick, collision and growth, scoring and speed-up, and the bounded food placement. |
| [rendering.md](/docs/userland/snake/rendering/) | `src/snake/paint/` | How a frame is produced: the fit-to-window layout, the score header, the board with food and snake, and the per-phase overlay banners. |
| [contributing.md](/docs/userland/snake/contributing/) | the whole tree | Where to work, the common changes and where they go, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/snake/debugging/) | runtime | The boot marker, the failure modes, and where to look when input, motion, or the display misbehaves. |

## Lifecycle

Snake is spawned through [verified spawn](/docs/security/capsules-and-trust/): its embedded ELF, id
cert, manifest, and attestation trailer are checked, its requested capabilities are held against its
manifest ceiling, and only then is its ELF mapped ([`src/userspace/capsule_snake/spawn.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_snake/spawn.rs#L36)). It is
compiled into the desktop fleet only under the `nonos-capsule-snake` feature; the fleet spawn plan calls
`spawn_snake`, which is the real spawn under that feature and an empty stub without it
([`src/userspace/init/spawn_plan/apps.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L22), `apps.rs:111`, `apps.rs:116`). On success the kernel logs
`[APP-SNAKE] capsule spawned` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29),
[`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)).

From there the app skeleton owns the runtime. Its `run` loop waits for a delivery, builds the `SnakeApp`,
opens the window from the manifest, primes the first frame, and enters the event-and-tick loop
([`userland/app_skeleton/src/runner/entry.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/entry.rs#L31), [`runner/boot.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/runner/boot.rs#L39)). Each key-down flows into
`on_event`; on the tick cadence the loop calls `on_tick` and repaints only when the game actually moved
or died ([`runner/entry.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/runner/entry.rs#L52)). The three pillar pages cover input, the tick, and the frame in turn.

## Protocol and IPC

Snake defines no application opcodes of its own. The `app.snake` service on port 4732 and the reply inbox
on 4733 are registered for it by the spawn record, and the app never handles an inbound request frame; it
only produces frames. Everything it does that reaches outside the capsule is a call the app skeleton makes
on its behalf: opening and sharing its surface ([`userland/app_skeleton/src/setup/open.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/setup/open.rs#L26)), resolving
`compositor`, `wm`, and `input_router` by name ([`userland/app_skeleton/src/discover/require.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/discover/require.rs#L31),
`require.rs:34`, `require.rs:37`), and subscribing the window to the manifest's input mask
([`userland/app_skeleton/src/runner/boot.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/boot.rs#L46)). The only libc syscall the game itself makes is
`mk_time_millis`, used once to seed the RNG ([`src/snake/state.rs:76`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L76), [`userland/libc/src/time/wall.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/time/wall.rs#L19)).
There is no VFS call, no clipboard call, no network call, and no installer call anywhere in the capsule.

## Source map

Everything here is drawn from `userland/capsule_snake/` (the capsule source, its `Capsule.mk`, and its
`Cargo.toml`), [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bits), the kernel spawn mirror under
`src/userspace/capsule_snake/`, and the app skeleton under `userland/app_skeleton/`. Every reference above
is verified against those trees.
