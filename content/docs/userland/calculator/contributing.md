---
title: "Contributing to capsule_calculator"
description: "This page is for a contributor who wants to change the calculator."
weight: 6
---
This page is for a contributor who wants to change the calculator. It covers where the source lives, which
folder owns which behaviour, the exact steps to add an operation, how to build and sign the capsule, and
the code standards a change has to meet. For what the calculator does and how it is put together, read the
[README](/docs/userland/calculator/), the [input model](/docs/userland/calculator/input/), the [engine](/docs/userland/calculator/engine/), and the
[rendering](/docs/userland/calculator/rendering/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_calculator/`. It is a `no_std`/`no_main` app-skeleton GUI app:
`_start` hands `Calculator::new` to the skeleton's `run`, and the runtime owns the surface, window, input
subscription, and paint loop ([`userland/capsule_calculator/src/main.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_calculator/src/main.rs#L27)). The single top-level module is
`calc`, which declares every submodule and re-exports `Calculator` ([`src/calc/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/mod.rs#L17), `mod.rs:31`).

## Module map

| Folder or file | Owns | Touch it when |
|---|---|---|
| `src/calc/event/` | input handlers: the router, the pointer hit-test path, and the keyboard classifier | you change a keybinding or how a click routes |
| `src/calc/buttons/` | the 6x5 keypad grid, one file per row plus the `Action`/`Button`/`Role` kinds | you add, move, or relabel a keypad button |
| `src/calc/actions/` | one file per operation, the bodies that mutate `State` | you change what an operation does or add one |
| [`src/calc/op.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/op.rs), [`src/calc/unary.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/unary.rs) | the binary and unary arithmetic, the only place the math lives | you change how a computation is done |
| [`src/calc/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/state.rs), [`src/calc/fixed.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/fixed.rs) | the state machine and the fixed-point scale | you change the data model or the numeric precision |
| `src/calc/format/` | number-to-text for the display | you change how a value is rendered as text |
| `src/calc/paint/` | the renderer: background, wordmark, display, badge, grid, per-role button colour | you change how a frame is drawn |
| [`src/calc/layout.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/layout.rs), [`src/calc/theme.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/theme.rs), [`src/calc/manifest.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/manifest.rs) | grid geometry and hit-test, the palette, the window manifest | you change the window size, colours, or input subscription |

## Adding an operation

Adding an operation is four edits, and the dispatch wiring is the load-bearing one.

1. Write the action module. Each operation is one file under `src/calc/actions/`, exposing a
   `pub fn run(state: &mut State)` (or `run(state: &mut State, arg)` for digit and operator) that mutates
   `State`. Guard the top with `if state.is_error() { return; }` unless the operation should run while
   errored, the way `memory_recall` and `memory_clear` do ([`src/calc/actions/memory_recall.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/memory_recall.rs#L19)). Do the
   math with `checked_*`/`saturating_*` and set `state.error` on failure rather than panicking, the way
   `square` does ([`src/calc/actions/square.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/square.rs#L24)). If it is a pure numeric transform, put the math in
   [`src/calc/unary.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/unary.rs) and keep the action file thin, the way `square` calls `unary::square`
   ([`src/calc/actions/square.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/square.rs#L18)).
2. Register it. Add a variant to the `Action` enum ([`src/calc/buttons/kinds.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/buttons/kinds.rs#L28)), add a match arm in
   the dispatcher ([`src/calc/actions/dispatch.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/dispatch.rs#L24)), and declare the module in [`src/calc/actions/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/mod.rs#L17).
3. Give it a way in. Add a keyboard mapping in the classifier ([`src/calc/event/key_classifier.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/event/key_classifier.rs#L33)) and
   place the button on the keypad by editing the relevant row file under `src/calc/buttons/` (for example
   [`src/calc/buttons/row_function.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/buttons/row_function.rs#L20)). The grid is a fixed 6x5, so a new button replaces an existing
   cell unless the grid dimensions and the geometry constants change together
   ([`src/calc/buttons/mod.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/buttons/mod.rs#L27), [`src/calc/layout.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/layout.rs#L21)).
4. Pick a role for the button so it gets a colour. The five roles are `Number`, `Operator`, `Equals`,
   `Function`, and `Memory`, each mapped to a background and text pair in `button::paint`
   ([`src/calc/buttons/kinds.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/buttons/kinds.rs#L19), [`src/calc/paint/button.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/paint/button.rs#L29)).

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk:158` and pulled in through
`userland/capsule_calculator/Capsule.mk:14`.

```
  make nonos-mk-calculator              build the capsule ELF               capsule.mk:182
  make nonos-mk-calculator-sign         id cert, manifest, attestation      capsule.mk:261
  make nonos-mk-calculator-verify       verify artifacts vs trust anchor    capsule.mk:263
  make nonos-mk-check-calculator-keys   assert the per-capsule signing keys exist  capsule.mk:184
```

For a bootable desktop that includes the calculator:

```
  make nonos-mk-calculator-prod         full desktop GUI image              Makefile:1163
```

`nonos-mk-calculator-prod` is an alias onto `nonos-mk-desktop-gui-prod`, so it builds the whole desktop
fleet image with the calculator embedded rather than a calculator-only kernel (`Makefile:1163`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, `panic!`, `todo!`, or `unimplemented!`. Every failure
  becomes a typed `ErrorKind` and an early return, never a panic; the release profile is `panic = "abort"`
  ([`userland/capsule_calculator/Cargo.toml:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_calculator/Cargo.toml#L26)).
- One unit per file. New operations are one `run` per file under `src/calc/actions/`, new keypad rows are
  one file under `src/calc/buttons/`, and `mod.rs` is used only for re-exports, matching the existing tree
  ([`src/calc/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/mod.rs), [`src/calc/actions/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/mod.rs)).
- No `unsafe` outside the unavoidable `_start` extern ([`src/main.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L27)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on every
  existing module ([`src/calc/state.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/state.rs#L1)).

## Source map

```
  userland/capsule_calculator/src/main.rs         _start -> run(Calculator::new)
  userland/capsule_calculator/src/calc/mod.rs     the module tree; re-exports Calculator
  userland/capsule_calculator/src/calc/actions/   one operation per file + dispatch + mod
  userland/capsule_calculator/src/calc/buttons/   the 6x5 keypad grid, kinds, and row files
  userland/capsule_calculator/src/calc/event/     router, key_classifier, on_key, on_pointer_button
  userland/capsule_calculator/src/calc/op.rs      the four binary operators
  userland/capsule_calculator/src/calc/unary.rs   square, reciprocal, integer sqrt
  userland/capsule_calculator/src/calc/paint/     the renderer, one concern per file
  userland/capsule_calculator/Capsule.mk          slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                             the nonos-mk-calculator[-sign|-verify] target templates
  Makefile                                        the -prod desktop image alias
```

Every reference above is verified against those trees.
