---
title: "Contributing to capsule_snake"
description: "This page is for a contributor who wants to change the game."
weight: 6
---
This page is for a contributor who wants to change the game. It covers where the source lives, which file
owns which behaviour, the common changes and where they go, how to build and sign the capsule, and the
code standards a change has to meet. For what the game does and how it is put together, read the
[overview](/docs/userland/snake/), the [controls](/docs/userland/snake/controls/), the [game loop](/docs/userland/snake/game-loop/), and the
[rendering](/docs/userland/snake/rendering/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_snake/`. It is a `no_std`/`no_main` app-skeleton GUI app: `_start`
hands `SnakeApp::new` to the skeleton's `run`, and the runtime owns the surface, window, input
subscription, and paint loop ([`userland/capsule_snake/src/main.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_snake/src/main.rs#L27)). All game logic is under
`src/snake/`, declared as one module per concern in [`src/snake/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/mod.rs#L17), which re-exports only
`SnakeApp` (`mod.rs:26`).

## Module map

| File | Owns | Touch it when |
|---|---|---|
| [`src/snake/app.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/app.rs) | the `App` impl and the `SnakeApp` wrapper | you change how the game wires to the runtime |
| [`src/snake/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs) | the `Game` model, `Dir`, `Phase`, and the tunables | you change the data model or the speed/score constants |
| [`src/snake/input.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs) | every control | you change a keybinding or the steering rules |
| [`src/snake/step.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/step.rs) | one tick of motion, collision, growth | you change the game rules |
| [`src/snake/rng.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/rng.rs) | xorshift and food placement | you change how food is placed |
| [`src/snake/grid.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/grid.rs) | board dimensions and window geometry | you resize the board or the window |
| [`src/snake/manifest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/manifest.rs) | the window request and input mask | you change the window kind, size, or subscribed inputs |
| `src/snake/paint/` | the renderer (layout, header, board, overlay) | you change how a frame is drawn |

## Common changes

1. Board size or window geometry: the grid constants in [`src/snake/grid.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/grid.rs#L17) (`CELL`, `COLS`, `ROWS`,
   the margins, and the derived `WIN_W`/`WIN_H`). The layout math and the paint code read these, so
   changing `COLS`/`ROWS` resizes the game with no other edit.
2. Speed and scoring: the three constants in [`src/snake/state.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L24) (`START_INTERVAL_MS`,
   `MIN_INTERVAL_MS`, `SPEEDUP_MS`). `step` applies them; no other file needs touching
   ([`src/snake/step.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/step.rs#L42)).
3. A new control: add the key code to the match in `on_event`, and if it needs new behaviour add a small
   helper next to `steer`, `restart`, and `toggle_pause` ([`src/snake/input.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L30)). Return `Repaint` for a
   change the player should see and `Idle` for a no-op.
4. Game rules: the collision and growth logic is all in `step` ([`src/snake/step.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/step.rs#L21)). Keep it panic
   free: bound every new index against `COLS`/`ROWS` before you use it, the way the wall check does
   ([`src/snake/step.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/step.rs#L33)).
5. Appearance: the colours and text are constants at the top of the `paint` submodules
   ([`src/snake/paint/board.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/board.rs#L22), [`src/snake/paint/overlay.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/overlay.rs#L21), [`src/snake/paint/header.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/header.rs#L23)).

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk:158` and pulled in through
`userland/capsule_snake/Capsule.mk:14`.

```
  make nonos-mk-snake                build the capsule ELF
  make nonos-mk-snake-sign           produce the id cert, manifest, and attestation trailer
  make nonos-mk-snake-verify         verify the signed artifacts against the trust anchor
  make nonos-mk-check-snake-keys     check the per-capsule signing keys exist
```

For a running desktop that includes the game, `make nonos-mk-snake-prod` builds the full desktop GUI image
with snake in the fleet (`Makefile:1164`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every branch is total: motion arithmetic
  is bounded before use, the score is a `u32` with no subtraction, the interval clamps with `max`, and
  food placement never unwraps ([`src/snake/step.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/step.rs#L33), `step.rs:42`, [`src/snake/rng.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/rng.rs#L28)). The release
  profile is `panic = "abort"` (`Cargo.toml:24`).
- One unit per file. Each concern is its own file under `src/snake/`, and `mod.rs` is used only for module
  wiring and re-exports ([`src/snake/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/mod.rs)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/snake/state.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L1) and every other module.

## Source map

```
  userland/capsule_snake/src/main.rs         _start -> run(SnakeApp::new); declares the snake module
  userland/capsule_snake/src/snake/mod.rs    module wiring, re-exports SnakeApp
  userland/capsule_snake/src/snake/          state, input, step, rng, grid, manifest, app, paint/
  userland/capsule_snake/Capsule.mk          slug, ports, mask, kernel mirror; includes the generated targets
  userland/capsule_snake/Cargo.toml          crate, panic=abort, AGPL license
  nonos-mk/capsule.mk                        the nonos-mk-snake[-sign|-verify] target templates
  Makefile                                   the nonos-mk-snake-prod desktop image target
```

Every reference above is verified against those trees.
