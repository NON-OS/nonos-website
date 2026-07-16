---
title: "Contributing to capsule_net_dns"
description: "This page is for a contributor who wants to change the DNS capsule."
weight: 4
---
This page is for a contributor who wants to change the DNS capsule. It covers where the source lives, which
folder owns which concern, the steps to add a client op, how to build and sign the capsule, and the code
standards a change has to meet. For what the capsule does and how it fits together, read the
[README](/docs/userland/net-dns/), the [operations](/docs/userland/net-dns/operations/) page, the [resolver](/docs/userland/net-dns/resolver/) page, and the
[transport](/docs/userland/net-dns/transport/) page.

## Where the source lives

The capsule is at `userland/capsule_net_dns/`. It is a `no_std`/`no_main` capsule: `_start` initialises the
heap, loops calling `setup::run` until it succeeds, and then enters `server::run`, which loops forever
([`src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L33)). The top-level modules are declared there: `dns`, `dhcp_upstream`, `protocol`, `server`,
`setup`, `state`, and `udp_client` ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NDNS` wire constants: magic, ops, errno, limits | you change an opcode, an errno, or the payload ceiling |
| `src/server/` | the request loop, the parser, the reply encoder, the admin gate, one handler per op | you add or change a client op |
| `src/dns/` | the DNS header, name coding, query builder, response parser, and the answer cache | you change the DNS wire handling or the cache |
| `src/udp_client/` | the `net.udp` IPC client: the `NUDP` envelope, bind, send, recv | you change how the capsule talks to `net.udp` |
| `src/dhcp_upstream/` | asking `net.dhcp.client` for the lease DNS server | you change upstream discovery |
| [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs) | resolving `net.udp`, minting and binding the local port, applying the DHCP upstream | you change bring-up |
| [`src/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs) | the cache, the UDP port, the local port, the upstream, xid and clock helpers | you change global state or entropy |

## Adding a client op

There are three edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode constant to [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17). The current set runs `1` through `5`; a new op takes
   the next value. If the op needs a new failure reason, add an errno to [`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17) and
   re-export it from [`src/protocol/mod.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L22).
2. Write the handler as one file under `src/server/handlers/`, exposing a `handle` function that reads the
   body, does its work, and replies with `respond` ([`src/server/respond.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L23)). Follow `health.rs` (a
   status-only op), `resolve_a.rs` (an op that reaches the resolver engine), or `upstream.rs` (a control op
   behind the admin gate). Declare the module in [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17). Shared resolve logic that
   more than one handler needs belongs in `resolve_common.rs` rather than being copied.
3. Wire it into the dispatch match in [`src/server/runner.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L42). Every op arm passes the sender pid through
   so the handler can attribute the request; a control op that changes resolver policy must gate on
   `authz::admin(sender_pid)` before it acts, the way flush and set-upstream do
   ([`src/server/handlers/flush.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/flush.rs#L24), [`src/server/handlers/upstream.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/upstream.rs#L24)).

## Where a change belongs

- A change to the on-wire DNS format, name coding, or the answer parser is a `src/dns/` change, and it must
  keep the parser bounded: `skip` stops at the first compression pointer and bounds its step count, and
  `read_answer` bounds the record data against the buffer ([`src/dns/name/skip.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/name/skip.rs#L20),
  [`src/dns/response/record.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/response/record.rs#L22)). Do not follow a compression pointer or trust a wire length without a
  bound.
- A change to how the capsule reaches the wire is a `src/udp_client/` change; it does not belong in a
  handler. The handlers reach the wire only through `send_to` and `recv_from`
  ([`src/server/handlers/resolve_common.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_common.rs#L43)).
- A change to the cache shape, capacity, or eviction is a `src/dns/cache/` change; the current table is 128
  slots with round-robin eviction and a case-folding hash ([`src/dns/cache/entry.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/cache/entry.rs#L19),
  [`src/dns/cache/ops.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/cache/ops.rs#L41)).

## Build and sign

The per-slug make targets are generated from the template in `nonos-mk/capsule.mk` (documented at
`nonos-mk/capsule.mk:1`) and pulled in through `userland/capsule_net_dns/Capsule.mk:16`. The slug is
`net-dns`, so the generated targets are:

```
  make nonos-mk-net-dns                build the capsule ELF
  make nonos-mk-net-dns-sign           produce the id cert, manifest, and attestation trailer
  make nonos-mk-net-dns-verify         verify the signed manifest against the trust-anchor policy
  make nonos-mk-check-net-dns-keys     assert the per-capsule signing seeds and pubs exist
```

The target names come straight from the template's `.PHONY` line and rules
(`nonos-mk/capsule.mk:158`, `capsule.mk:182`, `capsule.mk:261`, `capsule.mk:263`, `capsule.mk:184`). The
build rule compiles the capsule against the `x86_64-nonos-user` target with a build-std
(`nonos-mk/capsule.mk:72`, `capsule.mk:175`). The sign rule derives the `nonos_id` from the handle, domain,
and recovery, signs the id cert and the CapsuleManifest v3 under the baked trust anchor, and proves the
attestation trailer over the capability mask (`nonos-mk/capsule.mk:193`, `capsule.mk:230`, `capsule.mk:254`).
The manifest carries the required-caps value straight from `CAPSULE_REQUIRED_CAPS`
(`nonos-mk/capsule.mk:113`, `capsule.mk:230`), which is why the manifest mask and the `Capsule.mk` mask are
the same by construction. The slug's `_VERIFY` target is aggregated into the tree-wide verify list in the
top `Makefile:721`, and its `Capsule.mk` is included at `Makefile:678`.

The kernel embeds the signed capsule through the feature-gated `include_bytes!` in
[`src/userspace/capsule_net_dns/embed.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_dns/embed.rs#L17), which the `nonos-capsule-net-dns` feature enables
(`Cargo.toml:125`). That is the `cfg` gate on the embed and on the spawn entry
([`src/userspace/init/spawn_plan/network/spawn_dns.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_dns.rs#L18)).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Setup returns a `SetupError`, name coding
  returns a `NameError`, response parsing returns a `ParseError`, and every request path returns an errno
  word; the release profile is `panic = "abort"` (`Cargo.toml:27`).
- One unit per file. New ops are one file per handler under `src/server/handlers/`, and `mod.rs` is used
  only for module declarations and re-exports, as in [`src/dns/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/mod.rs#L17) and [`src/protocol/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L17).
- Every wire-supplied length is bounded before a read. `parse_req` uses a checked add on `payload_len`
  ([`src/server/parse_req.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L40)), `skip` bounds its walk ([`src/dns/name/skip.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/name/skip.rs#L36)), `read_answer` bounds
  the record data ([`src/dns/response/record.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/response/record.rs#L29)), and `recv_from` bounds the declared payload against the
  buffer ([`src/udp_client/recv.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/udp_client/recv.rs#L60)). A new parse path must do the same.
- Control ops fail closed. A policy-changing op checks `authz::admin` first, and that check denies when the
  `net.admin` principal is not registered ([`src/server/authz.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L38)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_net_dns/src/main.rs               _start -> setup retry -> server::run; module list
  userland/capsule_net_dns/src/protocol/ops.rs       the opcode constants
  userland/capsule_net_dns/src/protocol/errno.rs     the errno constants
  userland/capsule_net_dns/src/protocol/mod.rs       the protocol re-exports
  userland/capsule_net_dns/src/server/handlers/mod.rs the handler module declarations
  userland/capsule_net_dns/src/server/runner.rs      the dispatch match and the sender-pid gate
  userland/capsule_net_dns/src/server/respond.rs     the reply encoder handlers call
  userland/capsule_net_dns/src/server/authz.rs       the admin gate a control op must respect
  userland/capsule_net_dns/src/dns/name/skip.rs      the bounded name walk a new parser must follow
  userland/capsule_net_dns/src/dns/response/record.rs the bounded record read
  userland/capsule_net_dns/src/udp_client/recv.rs    the bounded receive
  userland/capsule_net_dns/Cargo.toml                panic = "abort" and the binary name
  userland/capsule_net_dns/Capsule.mk                slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                                the nonos-mk-net-dns[-sign|-verify] target template
  Makefile                                           the Capsule.mk include and the aggregated verify list
  Cargo.toml                                         the nonos-capsule-net-dns feature
  src/userspace/capsule_net_dns/embed.rs             the feature-gated kernel embed
```

Every reference above is verified against those trees.
