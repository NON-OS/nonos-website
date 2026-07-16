---
title: "Contributing to capsule_wm"
description: "This page is for a contributor who wants to change the window manager."
weight: 5
---
This page is for a contributor who wants to change the window manager. It covers where the source lives,
which folder owns which behaviour, the exact steps to add an operation, how to build and sign the capsule,
and the code standards a change has to meet. For what the wm does and how it is put together, read the
[README](/docs/userland/wm/), the [operations reference](/docs/userland/wm/operations/), the [placement and focus model](/docs/userland/wm/layout/),
the [compositor client and gate](/docs/userland/wm/clients/), and the [state](/docs/userland/wm/state/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_wm/`. It is a `no_std`/`no_main` capsule: `_start` initializes the
heap, blocks in `wait_for_setup`, then hands the resulting `Context` to `server::run`
([`userland/capsule_wm/src/main.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wm/src/main.rs#L36)). The nine top-level modules are declared there
([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NWMP` wire, opcodes, limits, errno, the `NWMV` notify envelope | you change the wire, add an opcode, or change a body length |
| `src/server/` | the run loop, dispatch, the per-op handlers, replies and notifications | you change how a request is handled or add a verb |
| `src/geometry/` | the rectangle, its predicates, and `clamp_to_display` | you change how geometry is bounded |
| `src/focus/` | the focus reference and the topmost hit test | you change focus tracking or hit-testing |
| `src/z_order/` | the monotonic z counter | you change stacking |
| `src/window/` | the `Window` record, `Kind`, `Visibility`, and the 256-entry table | you change the window model or its lookups |
| `src/state/` | the `Context` and the 16-entry subscriber list | you add per-run state or change subscriptions |
| `src/compositor_client/` | the `NCMP` client: display size and `FOCUS_SET` | you change how the wm talks to the compositor |
| `src/setup/`, [`src/wait_for_setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs) | bring-up: resolve, probe, read display size | you change startup |

The placement policy is a subtree of the server: `src/server/handlers/window_open/` holds the collide-and-step
search (`place.rs`), the overlap predicate (`collides.rs`), and the cascade of last resort
(`fallback_slot.rs`).

## Adding an operation

There are three edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode to [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17) and its request length to [`src/protocol/limits.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L21).
2. Write the handler as one file under `src/server/handlers/` (or a subdirectory for a multi-step op like
   `window_open/`), taking `(ctx, sender_pid, req, body, tx)`. Check the exact body length first and reply
   `E_INVAL` on a mismatch, scope any window lookup to `sender_pid` through `Window::matches`, and reply
   through `respond::status` or a dedicated encoder ([`src/server/handlers/window_move.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/window_move.rs) is the reference
   shape for a single-file verb).
3. Re-export the handler from [`src/server/handlers/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs) and add the match arm in
   [`src/server/runner/dispatch.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/dispatch.rs#L33). A bodyless verb belongs on an arm guarded by `body.is_empty()`, the
   way `OP_QUERY_FOCUS` and `OP_LIFECYCLE_SUBSCRIBE` are.

An operation that focuses a window another capsule owns must be gated: follow the `ROUTE_FOCUS` pattern and
resolve the allowed caller by service name ([`src/server/handlers/route_focus/is_input_router.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/route_focus/is_input_router.rs#L34)). Never
let an unprivileged verb act on a window it did not open.

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk:158` and pulled in through
`userland/capsule_wm/Capsule.mk:22`.

```
  make nonos-mk-wm                build the capsule ELF
  make nonos-mk-wm-sign           produce the id cert, manifest, and attestation trailer
  make nonos-mk-wm-verify         verify the signed artifacts against the trust anchor
  make nonos-mk-check-wm-keys     check the per-capsule signing keys exist
```

The wm is a member of the desktop fleet, so its signed artifacts (`$(wm_ARTIFACTS)`) are pulled into the
desktop GUI production images, for example `nonos-mk-desktop-gui-prod` (`Makefile:1079`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every handler returns errors as a status
  word, never a panic; the wire clamp and the z counter are written to never overflow (the clamp uses
  saturating and `clamp`, the z counter uses `checked_add`, [`src/geometry/constrain.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/geometry/constrain.rs#L25),
  [`src/z_order/stack.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/z_order/stack.rs#L33)).
- One unit per file. New handlers are one op per file under `src/server/handlers/`, and `mod.rs` is used
  only for re-exports, matching the existing tree.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/server/runner/dispatch.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/dispatch.rs#L1) and every other module.

## Source map

```
  userland/capsule_wm/src/main.rs             _start -> wait_for_setup -> server::run; the nine modules
  userland/capsule_wm/src/protocol/ops.rs     the opcode table
  userland/capsule_wm/src/protocol/limits.rs  the request length constants
  userland/capsule_wm/src/server/handlers/    one file per op (window_open/ is multi-step)
  userland/capsule_wm/src/server/handlers/mod.rs   the handler re-exports
  userland/capsule_wm/src/server/runner/dispatch.rs  the opcode match
  userland/capsule_wm/Capsule.mk              slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                         the nonos-mk-wm[-sign|-verify] target templates
  Makefile                                    the desktop-gui-prod image target and $(wm_ARTIFACTS)
```

Every reference above is verified against those trees.
</content>
