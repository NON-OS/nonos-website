---
title: "Operations and protocol"
description: "The IPC surface of capsuledrivervirtiorng is two operations behind a strict wire decoder."
weight: 2
---
The IPC surface of `capsule_driver_virtio_rng` is two operations behind a strict wire decoder. This page
covers the `NORD` frame under `src/protocol/`, the server loop and handlers under `src/server/`, the error
codes, and the kernel-side client that is the only in-tree caller. For the device side of a fill see the
[hardware bring-up](/docs/userland/driver-virtio-rng/hardware/) and the [request queue](/docs/userland/driver-virtio-rng/queue/) pages; for the identity and mask see the
[overview](/docs/userland/driver-virtio-rng/).

## The wire frame

The header is 20 bytes, little-endian, identical in shape to the entropy, crypto, vfs, ramfs, and keyring
capsules so one kernel-side client transport can serve them all uniformly ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17)):

```
  u32 magic        0x4E4F5244 "NORD"    header.rs:30
  u16 version      1                    header.rs:31
  u16 op
  u16 flags
  u16 _reserved
  u32 request_id   echoed, not routed on
  u32 payload_len
```

The magic is `0x4E4F_5244` ("NORD"), the version is `1`, and the header length is 20 bytes
([`src/protocol/header.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L30), `header.rs:31`, `header.rs:33`). The `Request` the decoder produces carries
just `op`, `flags`, `request_id`, and `payload_len`; the payload bytes after the header are not parsed in
the decoder, so each handler decides what they mean ([`src/protocol/header.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L37),
[`src/protocol/decode.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L18)).

The decoder is strict and returns `None` on anything it does not recognise. It rejects a buffer shorter
than the 20-byte header, a wrong magic, or a wrong version before it reads any op, so the server can answer
`EINVAL` rather than act on a stale protocol ([`src/protocol/decode.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L26), `decode.rs:31`, `decode.rs:35`).
It never panics and never unwraps: every field read is a checked `try_into` that funnels into the `None`
path ([`src/protocol/decode.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L30)).

The response reuses the same header, echoing the request's op, flags, and request id so the kernel client
can match replies, and prepends an `i32` status to its payload ([`src/protocol/encode.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L24),
`encode.rs:34`). The `request_id` is echoed but never routed on; IPC routing is by the per-process inbox.

## The two operations

The decoder validates the envelope, then [`src/server/runner.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L51) routes on the op; an unknown op returns
`EINVAL` ([`src/server/runner.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L54)). Two operations are defined ([`src/protocol/ops.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L21)):

| Op | Opcode | Handler | Request payload | Reply payload (after status) |
|---|---|---|---|---|
| `OP_FILL_RANDOM` | 1 | `handlers::fill::handle` | none; length is the header `payload_len` | up to `payload_len` entropy bytes |
| `OP_HEALTHCHECK` | 2 | `handlers::health::handle` | none | none |

Opcodes are `OP_FILL_RANDOM = 1` and `OP_HEALTHCHECK = 2` ([`src/protocol/ops.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L21)). Every reply carries
an `i32` status in the first four bytes of its payload, little-endian; a zero status means success
([`src/protocol/encode.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L34), [`src/server/error.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L28)).

### OP_FILL_RANDOM (op 1)

`fill::handle` ([`src/server/handlers/fill.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/fill.rs#L31)) reads the requested length from the header's
`payload_len` field, not from a body word, and bounds it before touching the device:

```
  fill(driver, req):
      want = req.payload_len
      if want == 0 or want > MAX_FILL_BYTES:  EMSGSIZE       // 4096 ceiling
      n = fill(regs, queue, irq_grant)                       // one virtqueue round trip
      if n is Err:                            EIO            // device did not complete
      take = min(want, n)
      copy take bytes from the DMA buffer into the reply
      return status 0 + take bytes
```

The size ceiling is `MAX_FILL_BYTES = 4096` ([`src/protocol/limits.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L21)), which the limits comment ties
to `ENTROPY_BUF_LEN` so a single fill can never ask for more than the buffer holds
([`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17)). A zero or over-ceiling request is refused with `EMSGSIZE` before the device
is touched ([`src/server/handlers/fill.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/fill.rs#L33)). The served count is the smaller of what the caller asked for
and what the device wrote into the used ring, so a short device write returns fewer bytes rather than
padding ([`src/server/handlers/fill.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/fill.rs#L44)). The bytes are copied out of the capsule's own DMA grant into
the response buffer under a single-threaded server loop, so no concurrent device write is in flight while
the copy runs ([`src/server/handlers/fill.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/fill.rs#L48), `fill.rs:51`).

### OP_HEALTHCHECK (op 2)

`health::handle` ([`src/server/handlers/health.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L25)) reads no input and replies success with an empty
body. Reaching it proves the decoder accepted the envelope and the runner routed the op, so it is a
structural liveness probe. The kernel client uses it before a real fill so a partial bring-up (virtqueue
programmed but device idle) shows up as a distinct failure rather than a fill timeout
([`src/server/handlers/health.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L18)).

### Errors

Three status codes are defined, mirroring Linux errnos so the kernel client can route them through the
same errno-to-error mapper it uses for the other capsules ([`src/protocol/errno.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L18)):

```
  E_INVAL    -22   malformed envelope, or an unknown op        errno.rs:22
  E_IO        -5   the device did not complete the fill        errno.rs:23
  E_MSGSIZE  -90   a fill request of zero or over 4096 bytes   errno.rs:24
```

A malformed envelope that fails to decode is answered `EINVAL` through a synthetic zero-valued request so
the caller is not left waiting on a reply that never comes ([`src/server/error.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L33),
[`src/server/runner.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L47)).

## The server loop

`run` ([`src/server/runner.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L36)) holds one request in flight at a time. The receive buffer is sized to
just the header (`RX_BUF_LEN = HDR_LEN`), and the transmit buffer is sized to the header plus the status
word plus `MAX_FILL_BYTES` (`TX_BUF_LEN = RESP_HDR_LEN + STATUS_LEN + MAX_FILL_BYTES`), so the largest
possible reply always fits without a reallocation ([`src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L33), `runner.rs:34`). The loop
receives on inbox 0, skips a non-positive receive length, decodes, and dispatches; a decode failure is
answered `EINVAL` and the loop continues ([`src/server/runner.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L40), `runner.rs:47`).

Every reply, success or error, goes through one path. `reply_with_status` encodes the response header,
writes the status word, and sends to `KERNEL_REPLY_ENDPOINT`; `reply_decode_failed` builds a synthetic
zero-valued request and funnels through the same call so a malformed envelope still produces a
well-formed reply ([`src/server/error.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L27), `error.rs:33`). The fill handler emits its success reply
inline with the same header and status encoders, then appends the entropy bytes and sends
([`src/server/handlers/fill.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/fill.rs#L46), `fill.rs:54`).

## The kernel-side client

The one in-tree caller is the kernel-side client under `src/hardware/virtio_rng_capsule/client/`. It gates
on `CAP_DRIVER` and round-trips through the shared lifecycle transport to the kernel-owned reply inbox
`endpoint.4294967302` under a transport lock ([`src/hardware/virtio_rng_capsule/client/transport.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_rng_capsule/client/transport.rs#L27),
`transport.rs:41`).

- `fill_random` ([`src/hardware/virtio_rng_capsule/client/fill_random.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_rng_capsule/client/fill_random.rs#L27)) gates on `CAP_DRIVER` through
  `gate_read`, refuses an over-4096 or empty request without round-tripping, writes the wanted length into
  the header's `payload_len` field rather than into a body word, does a locked round trip, and copies the
  reply bytes back only if their count matches the request (`fill_random.rs:29`, `fill_random.rs:42`,
  `fill_random.rs:47`).
- `healthcheck` ([`src/hardware/virtio_rng_capsule/client/healthcheck.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_rng_capsule/client/healthcheck.rs#L28)) gates on `CAP_DRIVER` and
  sends `OP_HEALTHCHECK`, returning `Ok` only when the round trip completes with status 0
  (`healthcheck.rs:34`).

The `CAP_DRIVER` check reads the caller pid from the kernel's process accounting, never from a caller
payload, and denies a caller that lacks the bit before any IPC leaves the kernel
([`src/hardware/virtio_rng_capsule/capability.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_rng_capsule/capability.rs#L25), `capability.rs:30`). The wire format has a bit-for-bit
kernel mirror under `src/hardware/virtio_rng_capsule/protocol/`; a change to the frame or the op set on the
capsule side has a counterpart there that must stay in step.

## Source map

```
  userland/capsule_driver_virtio_rng/src/protocol/header.rs   the 20-byte NORD header and Request
  userland/capsule_driver_virtio_rng/src/protocol/decode.rs   strict decoder, None on bad envelope
  userland/capsule_driver_virtio_rng/src/protocol/encode.rs   response header + i32 status writer
  userland/capsule_driver_virtio_rng/src/protocol/ops.rs      OP_FILL_RANDOM=1, OP_HEALTHCHECK=2
  userland/capsule_driver_virtio_rng/src/protocol/errno.rs    E_INVAL, E_IO, E_MSGSIZE
  userland/capsule_driver_virtio_rng/src/protocol/limits.rs   MAX_FILL_BYTES = 4096, STATUS_LEN
  userland/capsule_driver_virtio_rng/src/protocol/endpoint.rs KERNEL_REPLY_ENDPOINT (slot 6)
  userland/capsule_driver_virtio_rng/src/server/runner.rs     the loop, decode, op routing, EINVAL
  userland/capsule_driver_virtio_rng/src/server/error.rs      the single reply path
  userland/capsule_driver_virtio_rng/src/server/handlers/fill.rs    OP_FILL_RANDOM handler
  userland/capsule_driver_virtio_rng/src/server/handlers/health.rs  OP_HEALTHCHECK handler
  src/hardware/virtio_rng_capsule/client/                     the CAP_DRIVER-gated kernel client
  src/hardware/virtio_rng_capsule/protocol/                   the bit-for-bit kernel mirror of the frame
  src/hardware/virtio_rng_capsule/capability.rs               the CAP_DRIVER read gate
```

Every reference above is verified against those trees.
