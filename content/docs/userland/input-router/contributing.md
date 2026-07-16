---
title: "Contributing to capsule_input_router"
description: "This page is for a contributor who wants to change the router."
weight: 7
---
This page is for a contributor who wants to change the router. It covers where the source lives, which
folder owns which behaviour, the exact steps to add an operation or a routing rule, how to build and sign
the capsule, and the standards a change has to meet. For what the router does and how it is put together,
read the [README](/docs/userland/input-router/), the [operations reference](/docs/userland/input-router/operations/), the [routing engine](/docs/userland/input-router/routing/),
the [state](/docs/userland/input-router/state/), and the [clients](/docs/userland/input-router/clients/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_input_router/`. It is a `no_std`/`no_main` capsule: `_start`
initializes the heap and calls `server::run`, which never returns ([`src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L32)). There is no
`wait_for_setup` step; the router comes up first in the fleet and resolves each service lazily on first use.
The six top-level modules are declared in `main.rs` ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NIRS` request wire, the `NINP` delivery wire, the four opcodes, limits and errno | you change the wire, add an opcode, or change a body length |
| `src/server/` | the run loop, the non-blocking IPC drain, the four handlers, the reply helper | you change how a request is handled or add a verb |
| `src/sources/` | the kernel-ring batch drain, `MAX_BATCH = 32` | you change how events are pulled from the ring |
| `src/route/` | the decision engine: dispatch order, keyboard path, the pointer subtree, the delivery exit | you change where an event goes |
| `src/state/` | the `Context` and every routing table (cursor, grabs, subscriptions, key targets, press, hover) | you add per-run state or change a table |
| `src/clients/` | the outbound wm, compositor, and policy clients over the shared wire | you change how the router asks another service a question |

The pointer decision is a subtree of the route engine: `src/route/pointer/` holds the ordered
`route_pointer` (`route_pointer.rs`), the one-shot display fetch (`refresh_display.rs`), the shell mirror
(`mirror_shell_pointer.rs`), the drag path (`route_to_press.rs`), the cached-rect hover
(`hover_motion.rs`), the hit test (`topmost_target.rs`), and the two exits (`route_to_shell.rs`,
`route_to_window.rs`).

## Adding an operation

An operation is an inbound `NIRS` verb on the service inbox. There are three edits, and the dispatch wiring
is the load-bearing one.

1. Add the opcode to [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17) and, if it carries a body, its request length to
   [`src/protocol/limits.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs).
2. Write the handler as one file under `src/server/handlers/`, checking the exact body length first and
   replying `E_INVAL` on a mismatch, and reply through `respond::status` ([`src/server/respond.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L21)). A
   verb that grants or targets something a caller does not own must be gated: follow the grab-request
   pattern and resolve the allowed callers by name to a pid before acting
   ([`src/server/handlers/grab_request.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/grab_request.rs#L25)). Never let an unprivileged caller claim a class or reach a
   consumer it is not entitled to.
3. Re-export the handler from [`src/server/handlers/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs) and add the match arm in the opcode dispatch
   ([`src/server/drain_ipc.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/drain_ipc.rs#L44)). A bodyless verb belongs on an arm guarded by an empty-body check, the way
   `OP_HEALTHCHECK` and `OP_GRAB_RELEASE` are; the two wildcard arms then map an unknown empty-body op to
   `E_BAD_OP` and anything else to `E_INVAL` ([operations](/docs/userland/input-router/operations/)).

## Changing routing

Routing is the other half, and it is separate from the wire. To change where a drained event goes, work in
`src/route/`, not in a handler.

- The order in which grab, pointer, keyboard, and broadcast are tried is `route_event`
  ([`src/route/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/dispatch.rs#L28)). Reordering it changes the whole policy, so change it only with the routing
  page in view.
- A new pointer behaviour is a new file under `src/route/pointer/` slotted into the ordered `route_pointer`
  ([`src/route/pointer/route_pointer.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/pointer/route_pointer.rs#L33)), the same way hover and the drag path are.
- Any new destination must still deliver through the single exit, `deliver_one` ([`src/route/deliver.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/deliver.rs#L24)),
  so the `NINP` envelope and the 0/1 telemetry stay uniform, and must gate on `subscriptions.allows` before
  delivering to a window so the allow list is never bypassed ([state](/docs/userland/input-router/state/)).
- A routing change that reads a new fact from another service is a client change: add the call under
  `src/clients/` over the shared wire and cache its port on the `Context` ([clients](/docs/userland/input-router/clients/)).

The one invariant no change may break: the router drains and routes, it never posts. It holds no
`InputSource` capability, so there is no code path that injects an event back into the kernel ring, and none
should be added ([README](/docs/userland/input-router/) identity table).

## Build and sign

The per-slug make targets are generated from `nonos-mk/capsule.mk:158` and pulled in through
`userland/capsule_input_router/Capsule.mk:18`. The slug is `input-router`
(`userland/capsule_input_router/Capsule.mk:5`).

```
  make nonos-mk-input-router                build the capsule ELF
  make nonos-mk-input-router-sign           produce the id cert, manifest, and attestation trailer
  make nonos-mk-input-router-verify         verify the signed artifacts against the trust anchor
  make nonos-mk-check-input-router-keys     check the per-capsule signing keys exist
```

The router is a member of the desktop fleet, so its signed artifacts (`$(input-router_ARTIFACTS)`) are
pulled into the desktop GUI production images, for example `nonos-mk-desktop-gui-prod`
(`Makefile:1078`). The kernel embeds those same three artifacts at build time
([`src/userspace/capsule_input_router/embed.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_input_router/embed.rs#L24)).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every handler returns errors as a status
  word, and the routing tables are written to never overflow: the mask shifts use `checked_shl`
  ([`src/state/grabs/holder_for.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/grabs/holder_for.rs#L20)), the cursor uses saturating arithmetic and `clamp`
  ([`src/state/cursor.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/cursor.rs#L45)), the telemetry counters saturate ([`src/state/context/record.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/record.rs#L22)), and the
  request-id counter wraps ([`src/state/context/issue_request_id.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/issue_request_id.rs#L22)).
- One unit per file. New handlers are one op per file under `src/server/handlers/`, new state verbs are one
  method per file under `src/state/`, and `mod.rs` is used only for re-exports, matching the existing tree.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  src/main.rs                          _start -> heap_init -> server::run; the six modules
  src/protocol/ops.rs                  the opcode table
  src/protocol/limits.rs               the request length constants
  src/server/drain_ipc.rs              the opcode dispatch and empty-body guards
  src/server/handlers/                 one file per op
  src/server/handlers/mod.rs           the handler re-exports
  src/server/respond.rs                the status reply helper
  src/route/dispatch.rs                route_event: the decision order
  src/route/deliver.rs                 deliver_one: the single delivery exit
  src/route/pointer/                   the ordered pointer subtree
  src/state/                           the Context and the routing tables
  src/clients/                         the wm, compositor, and policy clients
  userland/capsule_input_router/Capsule.mk  slug input-router, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                  the nonos-mk-input-router[-sign|-verify] target templates
  Makefile                             the desktop-gui-prod image target and $(input-router_ARTIFACTS)
  src/userspace/capsule_input_router/embed.rs  the kernel embed of the signed artifacts
```

Every reference above is verified against those trees.
