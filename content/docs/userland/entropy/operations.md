---
title: "Operations and protocol"
description: "This page mirrors src/server/ and src/protocol/: the IPC loop, the NOEN wire frame, the four operations and their handlers, the dispatch, the error codes, and the kernel client ..."
weight: 1
---
This page mirrors `src/server/` and `src/protocol/`: the IPC loop, the NOEN wire frame, the four
operations and their handlers, the dispatch, the error codes, and the kernel client that gates and
drives them. For the randomness source and the counters, read [pool.md](/docs/userland/entropy/pool/). For identity, the
capability mask, and the lifecycle, read the [README](/docs/userland/entropy/).

## The request loop

The capsule is `no_std`/`no_main`. `_start` initializes the heap and, on success, calls `server::run`
([`src/main.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L29)). `run` allocates a 4608-byte receive buffer (`MAX_MSG`, [`src/server/runner.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L25)),
builds a fresh `Pool`, and loops ([`src/server/runner.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L27)):

```
  run():
      buf  = vec![0; 4608]
      pool = Pool::new()
      loop:
          n = mk_ipc_recv(inbox 0, buf, 4608)
          if n <= 0:  continue                 // skip empty or failed recv
          match decode_request(buf[..n]):
              Ok(req)  -> resp = dispatch(pool, req)
              Err(_)   -> resp = EINVAL reply   // structurally valid error frame
          mk_ipc_send(KERNEL_REPLY_ENDPOINT, resp)
```

A non-positive receive length is skipped ([`src/server/runner.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L32)). A frame that fails to decode is
not dropped: the loop emits a structurally valid `EINVAL` reply so the kernel client gets an answer
rather than a transport timeout ([`src/server/runner.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L41)). Every reply is sent to
`KERNEL_REPLY_ENDPOINT`, the kernel-owned inbox `0x1_0000_0003` ([`src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L43)).

## The NOEN wire frame

The wire format is authoritative in [`src/protocol/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs), and the kernel-side mirror at
[`src/security/entropy_capsule/protocol.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/protocol.rs) must match it bit-for-bit; the mirror's constants are
identical (`protocol.rs:25`). The header is 20 bytes, little-endian, packed (`types.rs:44`):

```
  u32 magic         0x4E4F454E "NOEN"           types.rs:26
  u16 version       1                           types.rs:27
  u16 op
  u16 flags
  u16 _reserved
  u32 request_id    echoed, not routed on        types.rs:23
  u32 payload_len   <= MAX_PAYLOAD_BYTES (4096)  types.rs:38
  = 20 bytes                                     HDR_LEN types.rs:54
```

`decode_request` ([`src/protocol/decode.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L29)) rejects, in order, a short buffer (`Short`), a wrong
magic (`BadMagic`), a wrong version (`BadVersion`), an over-large `payload_len` (`BadLength`), and a
frame shorter than header plus declared payload (`BadLength`) ([`src/protocol/decode.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L30)). It never
panics and never unwraps ([`src/protocol/decode.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L28)), and on success it returns a `Request` borrowing
the payload slice ([`src/protocol/types.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L57)).

`encode_response` ([`src/protocol/encode.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L25)) reuses the same header and prepends an `i32` status word
to the payload; the status rides in the first four bytes of the payload, little-endian, and a zero
status means success ([`src/protocol/encode.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L26)). `request_id` is echoed so the caller can match
replies, but the capsule never routes on it; IPC handles routing through the per-process inbox
([`src/protocol/types.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L22)).

## The four operations

Four ops are defined ([`src/protocol/types.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L30)), dispatched by `dispatch` on `req.op`
([`src/server/dispatch.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L25)); an unknown op returns `EINVAL` ([`src/server/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L31)).

| Op | Opcode | Handler | Request payload | Reply payload (after status) |
|---|---|---|---|---|
| GET_RANDOM | 1 | `get_random` | `u32` length (LE) | `length` random bytes |
| GET_STATS | 2 | `get_stats` | none | 32-byte stats blob |
| RESEED | 3 | `reseed` | `u32` len (LE) + `len` bytes | none |
| HEALTHCHECK | 4 | `healthcheck` | none | none |

Opcodes are `OP_GET_RANDOM = 1`, `OP_GET_STATS = 2`, `OP_RESEED = 3`, `OP_HEALTHCHECK = 4`
([`src/protocol/types.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L30)).

### GET_RANDOM (op 1)

`get_random` ([`src/server/handlers/getrandom.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/getrandom.rs#L27)) parses the length, caps it, fills, and checks the
result exactly:

```
  get_random(pool, req):
      if payload < 4:                 EINVAL          // no length word
      length = u32(payload[0..4])
      if length > MAX_RANDOM_BYTES:   EMSGSIZE        // 4096 ceiling
      out = vec![0; length]
      n = pool.fill(out)
      if n < 0 or n != length:        EIO             // hardware source failure
      return out                                      // status 0 + length bytes
```

The size ceiling is `MAX_RANDOM_BYTES = 4096` ([`src/protocol/types.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L36)), checked at
`getrandom.rs:32`. The result check is strict: a negative return or a served count that does not equal
the request is answered `EIO` ([`src/server/handlers/getrandom.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/getrandom.rs#L38)). The fill itself is the pool's
job; see [pool.md](/docs/userland/entropy/pool/).

### GET_STATS (op 2)

`get_stats` ([`src/server/handlers/getstats.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/getstats.rs#L23)) reads no untrusted input. It snapshots the four
counters and encodes them as a fixed 32-byte little-endian blob (`getstats.rs:24`). Status is always 0.
The blob layout is in [pool.md](/docs/userland/entropy/pool/).

### RESEED (op 3)

`reseed` ([`src/server/handlers/reseed.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/reseed.rs#L26)) bounds-checks the supplied entropy, records the reseed for
observability, and acknowledges:

```
  reseed(pool, req):
      if payload < 4:                       EINVAL
      length = u32(payload[0..4])
      if length > MAX_RESEED_BYTES:         EINVAL    // 256 ceiling
      if 4 + length != payload.len():       EINVAL    // declared vs actual
      pool.record_reseed()                            // bump last_reseed_request
      return ()                                       // status 0, empty body
```

The ceiling is `MAX_RESEED_BYTES = 256` ([`src/protocol/types.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L37)), checked at `reseed.rs:31`, and the
handler also rejects a declared length that does not match the actual payload size (`reseed.rs:34`). It
does not mix the supplied bytes into any state, because there is no userland CSPRNG state to mix into:
`record_reseed` only increments a counter ([`src/pool/record_reseed.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/record_reseed.rs#L21)). So `RESEED` on this capsule
is an observability breadcrumb, not a mixing operation; this is spelled out in [pool.md](/docs/userland/entropy/pool/).

### HEALTHCHECK (op 4)

`healthcheck` ([`src/server/handlers/healthcheck.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/healthcheck.rs#L24)) takes no input and returns an empty success
reply. Reaching it proves the decoder accepted the envelope and the dispatcher routed the op, so it is a
structural liveness probe.

## Error codes

Three error codes are defined ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)):

| Code | Value | Meaning |
|---|---|---|
| `EIO` | -5 | hardware source failure (`RDRAND` gave up) |
| `EINVAL` | -22 | short frame, bad length match, or unknown op |
| `EMSGSIZE` | -90 | a `GET_RANDOM` over the 4096 ceiling |

A malformed envelope that fails to decode at all is answered `EINVAL` rather than dropped, so a bad
request does not leave the caller waiting on a reply that never comes ([`src/server/runner.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L41)).

## The kernel client

The one in-tree caller is the kernel-side client under `src/security/entropy_capsule/client/`, driven by
the `CryptoRandom` syscall. Although the capsule serves `GET_STATS` and `RESEED` without checking a
capability itself, the only path that reaches them enforces `CAP_ENTROPY` for stats and `CAP_ADMIN` for
reseed on the kernel side before the IPC leaves the kernel.

- `handle_crypto_random` ([`src/syscall/dispatch/crypto/random.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/crypto/random.rs#L35)) requires `CAP_CRYPTO`, rejects a
  null buffer, a zero length, or a length over 4096, then calls the client's `get_random`
  (`random.rs:39`).
- `client::get_random` ([`src/security/entropy_capsule/client/get_random.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/client/get_random.rs#L26)) rejects an over-4096
  request without round-tripping (`get_random.rs:28`), encodes an `OP_GET_RANDOM` frame with a fresh
  request id, does a locked round trip through the lifecycle transport (`get_random.rs:34`), and maps a
  non-zero status back to a typed error (`get_random.rs:35`).
- `client::get_stats` ([`src/security/entropy_capsule/client/get_stats.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/client/get_stats.rs#L31)) first gates on
  `CAP_ENTROPY` through `gate_read` ([`src/security/entropy_capsule/capability.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/capability.rs#L23)), then requests the
  32-byte stats blob (`get_stats.rs:34`).
- `client::reseed` ([`src/security/entropy_capsule/client/reseed.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/client/reseed.rs#L25)) gates on `CAP_ADMIN` through
  `gate_reseed` ([`src/security/entropy_capsule/capability.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/capability.rs#L35)), rejects an empty seed
  (`reseed.rs:27`), and sends `OP_RESEED` (`reseed.rs:37`).

The pid used for each capability check is read from the kernel's process accounting, never from a
caller-supplied payload ([`src/security/entropy_capsule/capability.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/entropy_capsule/capability.rs#L24)). A caller that reached the
service on the wire directly, bypassing this client, would face no in-capsule capability check on
`GET_STATS` or `RESEED`; the enforcement lives on the client side by design.

## Source map

```
  userland/capsule_entropy/src/main.rs                 _start: heap_init then server::run
  userland/capsule_entropy/src/server/runner.rs        the loop, decode, EINVAL-on-malformed
  userland/capsule_entropy/src/server/dispatch.rs      op -> handler routing
  userland/capsule_entropy/src/server/handlers/        get_random, get_stats, reseed, healthcheck
  userland/capsule_entropy/src/protocol/types.rs       the NOEN frame, ops, limits
  userland/capsule_entropy/src/protocol/decode.rs      frame decode; never panics, never unwraps
  userland/capsule_entropy/src/protocol/encode.rs      response frame + i32 status word
  userland/capsule_entropy/src/protocol/errno.rs       EIO / EINVAL / EMSGSIZE
  src/security/entropy_capsule/protocol.rs             the bit-for-bit kernel mirror of the wire format
  src/security/entropy_capsule/client/                 the kernel client (get_random/get_stats/reseed)
  src/security/entropy_capsule/capability.rs           CAP_ENTROPY read gate, CAP_ADMIN reseed gate
  src/syscall/dispatch/crypto/random.rs                the CryptoRandom syscall and CAP_CRYPTO gate
```

Every reference above is verified against those trees.
