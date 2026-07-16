---
title: "Contributing to capsule_clipboard"
description: "This page is for a contributor who wants to change the clipboard."
weight: 3
---
This page is for a contributor who wants to change the clipboard. It covers where the source lives, which
folder owns which behavior, the exact steps to add an operation, how to build and sign the capsule, and the
code standards a change has to meet. For what the clipboard does and how it is put together, read the
[README](/docs/userland/clipboard/), the [operations and wire](/docs/userland/clipboard/protocol/) page, and the [state](/docs/userland/clipboard/state/) page.

## Where the source lives

The capsule is at `userland/capsule_clipboard/`. It is a `no_std`/`no_main` service: `_start` initializes
the heap and hands control to `server::run`, which owns the port and never returns
([`userland/capsule_clipboard/src/main.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_clipboard/src/main.rs#L13)). The three top-level modules are declared there
([`src/main.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L6)). It draws no window and subscribes to no input; the whole capsule is a byte store behind
one IPC port.

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the wire: header, opcodes, limits, errno, the request parser, the reply encoders | you change the frame, add an opcode, or change a bound |
| `src/server/` | the port loop, the reply builders, and one handler per operation | you change how a request is dispatched or handled |
| `src/state/` | the entry record, the bounded FIFO, and the idle timer | you change the data model, the eviction rule, or the wipe |

Inside `src/protocol/`, each concern is one file: `header.rs` (magic, version, `HDR_LEN`, `Request`),
`ops.rs` (the opcodes), `limits.rs` (the bounds), `errno.rs` (the status codes), `decode.rs` (the parser),
and `encode.rs` (the reply header and status writers); `mod.rs` re-exports the public surface. Inside
`src/server/handlers/`, `router.rs` is the dispatch table and every operation is one file. Inside
`src/state/`, `entry.rs` is the record and `clipboard/` splits the store into `types.rs` (the struct),
`storage.rs` (copy, evict, read, clear), and `timer.rs` (the idle logic).

## Adding an operation

There are four edits, and the router wiring is the load-bearing one.

1. Add the opcode. Give it the next value in [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17) (the current set ends at
   `OP_SET_IDLE_TIMEOUT = 0x0007`) and re-export it from [`src/protocol/mod.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L32).

2. Write the handler as one file under `src/server/handlers/`, next to the existing ones. A handler has the
   shape `pub fn run(clipboard: &mut Clipboard, req: &Request, payload: &[u8], out: &mut [u8], now_ms: u64)
   -> usize` (drop the arguments it does not need, the way `health::run` takes only `out` and `req` and
   `history_list::run` takes an immutable `&Clipboard`). It validates the payload length first and returns
   `respond::status(out, req, E_INVAL)` on a short payload ([`src/server/handlers/copy.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/copy.rs#L22) is the
   reference shape), does its work against `clipboard`, and returns either `respond::status` for a
   status-only reply or `respond::with_payload` after laying the extra bytes into `out` past offset 24
   ([`src/server/handlers/paste.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/paste.rs#L36)). It returns the byte count of the reply.

3. Wire it into the router. Declare the module in [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17), add it to the
   `use super::{...}` import at the top of the router ([`src/server/handlers/router.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/router.rs#L17)), and add a match
   arm in `route` keyed on the new opcode ([`src/server/handlers/router.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/router.rs#L30)). A word no arm matches falls
   to the `_ =>` arm and returns `E_BAD_OP` (`router.rs:38`), so the new arm is what makes the op reachable.

4. Decide the idle-wipe posture. If the op is a use of the clipboard's content, call `clipboard.touch(now_ms)`
   (or stamp the time inline the way `copy` does) so it extends the retention window; if it is metadata or
   liveness, leave the timestamp alone the way `OP_HISTORY_LIST` and `OP_HEALTHCHECK` do. This choice is a
   privacy decision, not an incidental one; the [state](/docs/userland/clipboard/state/) page explains why.

If the op changes a bound, put the constant in [`src/protocol/limits.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs) and re-export it from
[`src/protocol/mod.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L28) rather than hard-coding a number in the handler.

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk:158` and pulled in through
`userland/capsule_clipboard/Capsule.mk:16`.

```
  make nonos-mk-clipboard              build the capsule ELF               capsule.mk:182
  make nonos-mk-clipboard-sign         id cert, manifest, attestation      capsule.mk:261
  make nonos-mk-clipboard-verify       verify artifacts vs trust anchor    capsule.mk:263
  make nonos-mk-check-clipboard-keys   assert the per-capsule signing keys exist   capsule.mk:184
```

The clipboard has no standalone image target of its own; it ships inside the desktop GUI images, which pull
in `$(clipboard_BIN)` and `$(clipboard_ARTIFACTS)` (`Makefile:576`, `Makefile:881`). Its verify artifact is
part of the aggregate verify pass (`Makefile:726`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. The request parser decodes by explicit
  little-endian indexing rather than `try_into().unwrap()` ([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19)), and every failure
  is a typed errno on the reply, never a panic.
- One unit per file. New operations are one handler per file under `src/server/handlers/`, and `mod.rs` is
  used only for re-exports, matching the existing tree.
- Keep the mask minimal. The clipboard is admitted with exactly `CoreExec | IPC | Memory = 0x19`
  (`Capsule.mk:13`) and the kernel mirror asserts the same ([`src/userspace/capsule_clipboard/spawn.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_clipboard/spawn.rs#L35)).
  A change that needs a new capability is a change to both, and the Debug bit stays absent so the capsule
  emits no serial markers.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/protocol/header.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L1) and every other module.

## Source map

```
  userland/capsule_clipboard/src/main.rs               _start, heap init, hand-off to server::run
  userland/capsule_clipboard/src/protocol/ops.rs       the opcodes; add the next value here
  userland/capsule_clipboard/src/protocol/mod.rs       the re-export surface
  userland/capsule_clipboard/src/server/handlers/mod.rs      declare the handler module here
  userland/capsule_clipboard/src/server/handlers/router.rs   dispatch table; add the match arm here
  userland/capsule_clipboard/src/server/respond.rs     status / with_payload reply builders
  userland/capsule_clipboard/src/protocol/limits.rs    the bounds; add a new limit here
  userland/capsule_clipboard/Capsule.mk                slug, ports, mask 0x19; includes the generated targets
  nonos-mk/capsule.mk                                  the nonos-mk-clipboard[-sign|-verify] target templates
  src/userspace/capsule_clipboard/spawn.rs             kernel spawn spec, caps 0x19, ports 4414/4415
```

Every reference above is verified against those trees.
