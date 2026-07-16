---
title: "The Node Directory"
description: "This page documents the signed node directory: the NYMD wire format, the Ed25519 authority check, the validity window and epoch anti-rollback, the node record parse, the layered..."
weight: 6
---
This page documents the signed node directory: the `NYMD` wire format, the Ed25519 authority check, the
validity window and epoch anti-rollback, the node record parse, the layered five-hop route selection, and the
HTTP fetch that pulls a directory over `net.tcp`. It mirrors `src/topology/` and `src/directory_sync/`. The
route header that consumes the selected hops is on the [mixnet](/docs/userland/net-nym/mixnet/) page; the trusted-authority store
the verify path consults is on the [state](/docs/userland/net-nym/state/) page.

## Why a directory

A mixnet client cannot route without knowing the nodes, their addresses, their published X25519 packet keys,
and their roles. The directory is that list, and because a lying directory would deanonymize every user, it is
signed. The capsule stores exactly one directory at a time and will not route until a valid one is installed
([`src/topology/store.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/store.rs#L46)). Installing a directory resets every open session, because the routes those
sessions would take have changed underneath them ([`src/server/handlers/set_topology.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_topology.rs#L32)).

## The NYMD wire format

A directory is a 128-byte header followed by fixed-size node records ([`src/topology/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/types.rs#L17)):

```
  offset  size  field                              types.rs / parse.rs / layout.rs
  0       4     magic = "NYMD"                      DIR_MAGIC:17, parse.rs:46
  4       1     version = 1                         DIR_VERSION:18, parse.rs:49
  5       1     reserved, zero                      parse.rs:52
  6       2     node count                          layout.rs:25
  8       8     epoch                               parse.rs (meta):67
  16      8     not-before (ms)                     parse.rs:55
  24      8     not-after (ms)                      parse.rs:56
  32      32    issuer public key                   parse.rs:64
  64      64    Ed25519 signature                   verify.rs:31
  128     ..    node records, 74 bytes each         NODE_WIRE_LEN:21
```

`layout::check_len` requires the body to be at least the 128-byte header, reads the node count, rejects zero
(`Empty`) and a count over `NODE_CAP` (128) (`TooLarge`), and requires the body length to be exactly
`128 + count * 74` ([`src/topology/layout.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/layout.rs#L21)). Each node record is 74 bytes:

```
  offset  size  field                     node.rs
  0       1     role (1 entry, 2 mix, 3 exit)
  1       1     layer
  2       2     delay_ms
  4       4     IP
  8       2     port
  10      32    identity
  42      32    packet_key (X25519 public)
```

`node::parse` reads those fields and rejects an unknown role byte ([`src/topology/node.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/node.rs#L19)).

## The signature check

`install` runs three checks in order before it stores anything ([`src/topology/parse.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/parse.rs#L25)): the length check
above, a header check, and the signature check. The header check requires the `NYMD` magic, version 1, a zero
reserved byte, and a coherent validity window, `not_after > not_before` and the current clock inside
`[not_before, not_after)` ([`src/topology/parse.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/parse.rs#L45)). The clock comes from `mk_time_millis`, and a negative
read is a `Clock` error ([`src/topology/clock.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/clock.rs#L21)).

The signature check is in [`src/topology/verify.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/verify.rs#L23). The signed message is the first 64 bytes of the header
(everything up to the signature) concatenated with the node records, so the signature covers the metadata and
the node list but not the signature field itself ([`src/topology/layout.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/layout.rs#L41)). The issuer key is the 32 bytes
at offset 32. Before verifying, the code asks the trusted-authority store whether that issuer is the trusted
signer: `Some(true)` proceeds, `Some(false)` is `UntrustedAuthority`, and `None`, meaning no authority is set
at all, is `NoAuthority` (`verify.rs:26`). Only then does it call `crypto_ed25519_verify`, returning
`BadSignature` on a non-zero result (`verify.rs:32`). This is fail-closed: with no authority installed no
directory verifies, and a directory signed by anyone but the installed authority is rejected.

## Epoch anti-rollback and freshness

`store::replace` holds the parsed directory behind a mutex and enforces two more rules on install
([`src/topology/store.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/store.rs#L31)). It re-checks freshness against the clock, and it rejects a directory whose epoch
is less than or equal to the stored one, so an attacker cannot replay an older, still-in-window directory to
force a stale node set (`store.rs:39`). On read, `snapshot` re-checks that the stored directory is still
inside its validity window and that its issuer is still the trusted authority before handing out the node
list, so a directory that expires or an authority that is rotated away invalidates routing immediately
without a separate revocation step (`store.rs:46`). The status reported by `OP_TOPOLOGY_STATUS` comes from
the same predicates: `Missing`, `Ready`, `Expired`, `Clock`, or `UntrustedAuthority` ([`src/topology/status.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/status.rs#L20)).

## Route selection

`route` selects five hops from the current directory using the route seed ([`src/topology/select.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/select.rs#L22)). The
route is fixed shape: an entry gateway, three mixes at layers 1, 2, and 3, and an exit gateway:

```
  hop 0  EntryGateway  (any layer)
  hop 1  Mix layer 1
  hop 2  Mix layer 2
  hop 3  Mix layer 3
  hop 4  ExitGateway   (any layer)
```

For each position, `pick` filters the node set to the matching role and, for mixes, the matching layer, then
selects one deterministically by taking a seed byte modulo the number of candidates (`select.rs:33`). An empty
candidate set at any position is `MissingHop`, which becomes `E_NO_ROUTE` at the send site. The selection is
deterministic given the seed, so the same session and payload reproduce the same route, while different
sessions spread across the available nodes. `snapshot` is what enforces that selection only ever runs against
a fresh, trusted directory (`select.rs:23`).

## Fetching a directory over net.tcp

`OP_SYNC_DIRECTORY` fetches a directory rather than taking it in the request body. `directory_sync::fetch`
opens a TCP stream to the source, sends a plain HTTP/1.1 GET, reads the response, closes the stream, and
parses the body ([`src/directory_sync/http.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/directory_sync/http.rs#L27)). The source is an IPv4 address, a port, a host string, and a
path, parsed from the op body with bounded host and path lengths, a non-zero port, and a leading `/` on the
path ([`src/directory_sync/source.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/directory_sync/source.rs#L30)). A source given once is remembered, so a later `OP_SYNC_DIRECTORY`
with an empty body reuses it, and an empty body with no stored source is `E_DIRECTORY_SOURCE`
([`src/server/handlers/sync_directory.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/sync_directory.rs#L47)). The HTTP client is deliberately small: it builds a
`Connection: close` request ([`src/directory_sync/http/request.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/directory_sync/http/request.rs#L21)), reads until the headers complete and
the `Content-Length` body has arrived or the peer closes ([`src/directory_sync/http/read.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/directory_sync/http/read.rs#L23)), requires a
`200` status, and returns the body bytes ([`src/directory_sync/http/parse.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/directory_sync/http/parse.rs#L21)). Those body bytes are then
fed to the same signed `install` path as `OP_SET_TOPOLOGY`, so a fetched directory is verified exactly like a
pushed one; the transport is untrusted and the signature is what is trusted (`sync_directory.rs:56`).

## Real versus design

The verify, epoch, freshness, and selection logic is real and self-contained: it makes a genuine
`crypto_ed25519_verify` call, enforces anti-rollback, and produces a concrete five-hop route. What the tree
does not contain is a NØNOS-run directory authority or a live set of mix nodes, so the directory has to be
supplied by an external operator, pushed with `OP_SET_TOPOLOGY` or fetched with `OP_SYNC_DIRECTORY` from a
server that publishes the `NYMD` format. The capsule is the client and verifier of a directory; it is not the
authority that issues one.

## Source map

```
  userland/capsule_net_nym/src/topology/types.rs      DIR_MAGIC, NODE_WIRE_LEN, ROUTE_HOPS, Node, Role
  userland/capsule_net_nym/src/topology/parse.rs      install: length, header, signature, node parse
  userland/capsule_net_nym/src/topology/layout.rs     the length check and the signed-message assembly
  userland/capsule_net_nym/src/topology/verify.rs     the trusted-authority gate and Ed25519 verify
  userland/capsule_net_nym/src/topology/node.rs       the 74-byte node record parse
  userland/capsule_net_nym/src/topology/store.rs      the epoch anti-rollback and freshness store
  userland/capsule_net_nym/src/topology/select.rs     the layered five-hop route selection
  userland/capsule_net_nym/src/topology/status.rs     the OP_TOPOLOGY_STATUS predicates
  userland/capsule_net_nym/src/topology/clock.rs      the mk_time_millis wrapper
  userland/capsule_net_nym/src/directory_sync/http.rs        the fetch pipeline over net.tcp
  userland/capsule_net_nym/src/directory_sync/source.rs      the HTTP source parse
  userland/capsule_net_nym/src/directory_sync/http/request.rs the GET request build
  userland/capsule_net_nym/src/directory_sync/http/read.rs    the response read
  userland/capsule_net_nym/src/directory_sync/http/parse.rs   the status and body parse
```

Every reference above is verified against those trees.
