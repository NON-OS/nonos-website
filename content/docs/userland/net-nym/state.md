---
title: "The Nym State"
description: "This page documents the tables the capsule holds in process memory: the session and its receive queue, the replay window, the current gateway, the trusted-authority store, the a..."
weight: 8
---
This page documents the tables the capsule holds in process memory: the session and its receive queue, the
replay window, the current gateway, the trusted-authority store, the access credential, the SURB store, and
the cover-timing policy. It mirrors `src/state/`. The ops that mutate these are on the
[operations](/docs/userland/net-nym/operations/) page; the directory store, which also lives under a mutex, is documented with the
rest of the directory on the [directory](/docs/userland/net-nym/directory/) page. All of this is RAM-only; nothing is written to
disk and nothing survives a reboot, which the source README states correctly.

## The session table

The central table is a single mutex-guarded `Table` holding the current gateway, a monotonic id counter, a
bounded vector of sessions, and a receive staging buffer ([`src/state/table/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table/types.rs#L26)). It is capped at
`TABLE_CAP`, 32 sessions ([`table/types.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/table/types.rs#L23)). Sessions are keyed by their owner pid: `open` records the
sender pid as the owner, and every lookup matches both owner and id so one caller can never touch another
caller's session ([`src/state/table/ops.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table/ops.rs#L29)). `open` also gates on readiness before allocating: it fails
`Full` at the cap, `NoTopology` or `StaleTopology` if the directory is not ready, `NoCredential` if no
credential is installed, and `NoGateway` if no gateway is set ([`table/ops.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/table/ops.rs#L29)). Ids are allocated by a
wrapping counter that skips zero ([`table/ops.rs:69`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/table/ops.rs#L69)). `close` finds the session, zeroizes its key, and removes
it ([`table/ops.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/table/ops.rs#L56)); `set_gateway`, an authority change, or a directory change all call `reset_sessions`,
which zeroizes every session key and clears the table because the routes or trust root just changed
([`src/state/table/reset.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table/reset.rs#L20)).

## The session and its receive queue

A `Session` carries its owner, id, gateway, 32-byte key, a replay window, and a bounded receive queue
([`src/state/session.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/session.rs#L28)). The receive queue is a `VecDeque` capped at `RX_DEPTH`, 8 datagrams; a push at
capacity drops the oldest ([`src/state/session.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/session.rs#L42)). `zeroize` fills the session key with zeros, and it is
called on close and on every reset, so a key never lingers in freed memory (`session.rs:57`). The receive path
decodes a wire packet, looks up the session by id, and, if the replay window accepts the tag, opens the
ciphertext under the session key and queues the recovered datagram ([`src/server/handlers/recv_drain.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv_drain.rs#L60)).

## The replay window

Each session owns a `ReplayWindow`: a ring of the last 64 replay tags it has accepted ([`src/state/replay.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/replay.rs#L19)).
`accept` returns false if it has seen the tag, otherwise records it in the ring and returns true
(`replay.rs:32`). This is what stops a captured packet from being replayed into a session: because the replay
tag is a BLAKE3 hash over the session id, flags, nonce, and ciphertext, a genuine retransmission of the same
bytes produces the same tag and is rejected, while a fresh packet with a fresh nonce always differs. The
window is per session and bounded, so it costs 64 tags of memory per open session and never grows.

## The gateway

The current gateway is a single `Option<Gateway>` inside the table, not a per-session field, because one
capsule uses one entry gateway at a time ([`table/types.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/table/types.rs#L27)). `set_gateway` resets the sessions and replaces
the gateway, returning the old one so the handler can close its stream ([`table/ops.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/table/ops.rs#L24)). The `Gateway`
itself is the IP, port, TCP stream handle, and transport tag from the [transport](/docs/userland/net-nym/transport/) page
([`src/state/gateway.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/gateway.rs#L23)).

## The trusted authority

The directory and credential trust roots both resolve through one 32-byte Ed25519 key held in
[`src/state/authority.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/authority.rs#L19). `install` accepts exactly 32 non-zero bytes and stores them; `trusted` returns
`Some(true)` if the queried issuer equals the stored key, `Some(false)` if it differs, and `None` if no
authority is set (`authority.rs:21`). The comparison is constant-time over the 32 bytes (`authority.rs:36`).
This single store is why both the directory verify and the credential verify are fail-closed with no
authority: both call `trusted` and treat `None` as a hard error. Installing a new authority resets every
session ([`src/server/handlers/set_authority.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_authority.rs#L30)).

## The access credential

A caller installs its own signed credential, and the capsule refuses to open or send without one. The stored
form is an expiry, an issuer, and 32 bytes of material ([`src/state/credential/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/credential/types.rs#L17)). `verify::parse`
validates a credential body: it bounds the length, rejects a zero or already-expired expiry, checks the
issuer against the trusted authority, verifies the Ed25519 signature over the expiry and payload, and derives
the 32-byte material as the BLAKE3 hash of the whole credential body ([`src/state/credential/verify.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/credential/verify.rs#L28)).
`material` reads the stored credential back, dropping it if it has expired and re-checking that its issuer is
still the trusted authority, so a credential that outlives its authority stops working immediately
([`src/state/credential/store.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/credential/store.rs#L32)). The credential material is what binds a session's route seed and its
SURB tags, so a session's anonymity set is scoped to the credential it was opened under.

## The SURB store

A SURB, single-use reply block, lets a correspondent send one reply back on a session without learning its
route. The store is a bounded, TTL-pruned vector of `Surb` records, each an owner, id, session, 32-byte tag,
and expiry, capped at `CAP`, 64, with a default TTL of ten minutes and a clamp between 30 seconds and 24
hours ([`src/state/surb_types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/surb_types.rs#L17)). `create` draws a random non-zero id that does not collide for the owner,
computes the tag as an HMAC-SHA256 over the owner, session, id, and a random seed keyed by the credential
material, prunes expired entries, evicts the oldest if full, and stores the record
([`src/state/surb.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/surb.rs#L26), [`src/state/surb_id.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/surb_id.rs#L20), [`src/state/surb_tag.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/surb_tag.rs#L21)). `consume` finds a record by
owner, id, and a constant-time tag match, removes it, and returns the session it named, so a SURB is genuinely
single-use (`surb.rs:40`, `surb_tag.rs:38`). `OP_SEND_REPLY` uses that returned session to send the reply.

## The cover-timing policy

Cover traffic is paced by a small policy in [`src/state/timing.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/timing.rs): a cover burst count and a delay jitter,
each an atomic, plus the next scheduled cover time (`timing.rs:21`). `install` sets the burst clamped to
`[1, 8]` and the jitter clamped to `[10, 10000]` ms from a four-byte body (`timing.rs:31`). `cover_due` is the
rate limiter: it returns false while the current time is before the next scheduled time, and when a burst is
due it schedules the next one a random jitter ahead, drawing the jitter from `crypto_random`
(`timing.rs:51`). `OP_COVER_TICK` consults `cover_due` before sending, so a client can call it on a fixed
timer and the policy decides whether a burst actually goes out ([`src/server/handlers/cover.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/cover.rs#L31)). The policy
and the next cover time are reported by `OP_TIMING_STATUS` ([`src/server/handlers/timing_status.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/timing_status.rs#L24)).

## The stream staging buffer

The receive path does not read a whole wire packet in one `recv`; it accumulates bytes. `append_stream` adds
received bytes to the table's `stream_rx` buffer, clearing it if it would exceed four packets' worth of bytes
so a desynchronized stream cannot grow unboundedly ([`src/state/table/stream.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table/stream.rs#L24)). `take_packet` pulls one
`WIRE_PACKET_MAX`-sized packet off the front when enough bytes are buffered ([`table/stream.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/table/stream.rs#L31)). This is
what lets the receive drain loop turn a byte stream from the gateway into whole packets to decode
([`src/server/handlers/recv_drain.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/recv_drain.rs#L44)).

## Source map

```
  userland/capsule_net_nym/src/state/mod.rs             the state re-exports
  userland/capsule_net_nym/src/state/table/types.rs     the Table, its cap, and TableError
  userland/capsule_net_nym/src/state/table/ops.rs       open, close, gateway, id allocation, ownership
  userland/capsule_net_nym/src/state/table/reset.rs     the session zeroize-and-clear on trust change
  userland/capsule_net_nym/src/state/table/stream.rs    the stream staging and whole-packet extraction
  userland/capsule_net_nym/src/state/table/owner.rs     the per-owner session lookups
  userland/capsule_net_nym/src/state/table/topology_gate.rs  the readiness gate on open
  userland/capsule_net_nym/src/state/session.rs         the Session, its key, and its receive queue
  userland/capsule_net_nym/src/state/replay.rs          the 64-tag replay window
  userland/capsule_net_nym/src/state/gateway.rs         the Gateway and Transport
  userland/capsule_net_nym/src/state/authority.rs       the trusted Ed25519 authority store
  userland/capsule_net_nym/src/state/credential/        the signed credential verify and store
  userland/capsule_net_nym/src/state/surb.rs, surb_id.rs, surb_tag.rs, surb_types.rs  the SURB store
  userland/capsule_net_nym/src/state/timing.rs          the cover-timing policy and rate limiter
```

Every reference above is verified against those trees.
