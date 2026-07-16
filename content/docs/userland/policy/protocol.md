---
title: "Protocol and the request loop"
description: "This page mirrors the shared wire format in userland/policyproto/ and the request loop in userland/capsulepolicy/src/server/."
weight: 2
---
This page mirrors the shared wire format in `userland/policy_proto/` and the request loop in
`userland/capsule_policy/src/server/`. It covers the header, the two operations, the per-kind payloads, the
poll-decode-dispatch loop, and the full error table. The field catalog those operations name is on
[fields.md](/docs/userland/policy/fields/); the write gate that guards `set` is on [gate.md](/docs/userland/policy/gate/).

## The header

Every request and every reply begins with a fixed 12-byte header, little-endian
([`userland/policy_proto/src/hdr.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/hdr.rs#L17)):

```
  offset  size  field         meaning
  0       2     op            OP_GET (1) or OP_SET (2)
  2       4     field         the u32 Field discriminant
  6       1     kind          KIND_BOOL/U8/I8/STR
  7       1     pad           always 0
  8       2     status        the reply status word; 0 on a request
  10      2     payload_len   bytes of payload that follow the header
```

`Header::encode` writes exactly this layout and `Header::decode` reads it back, returning `None` if fewer
than 12 bytes are present (`hdr.rs:29`, `hdr.rs:38`). The kinds are `KIND_BOOL 1`, `KIND_U8 2`, `KIND_I8 3`,
`KIND_STR 4` ([`userland/policy_proto/src/kind.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/kind.rs#L17)). The whole frame is bounded by `IPC_PAYLOAD_MAX = 512`
and a reply payload by `IPC_PAYLOAD_MAX - HDR_LEN` ([`userland/policy_proto/src/limits.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/limits.rs#L18),
[`src/server/respond/ok.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond/ok.rs#L22)).

## The two operations

The protocol has exactly two operations. There is no separate push or subscribe opcode on this service; the
"push" side is outbound and belongs to the capsule, described on [gate.md](/docs/userland/policy/gate/). Readers do not
subscribe, they poll a `get` when they need a value.

| Op | Opcode | Direction | Payload | Source |
|----|--------|-----------|---------|--------|
| `OP_GET` | 0x0001 | request | none; the reply carries the value | `ops.rs:17`, [`src/server/handle_get.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handle_get.rs#L21) |
| `OP_SET` | 0x0002 | request | the new value, per kind | `ops.rs:18`, [`src/server/handle_set.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handle_set.rs#L40) |

### get

`handle_get::dispatch` routes by the field's kind to the matching handler
([`src/server/handle_get.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handle_get.rs#L21)). Each handler reads the store and replies with the value, or `E_NOT_FOUND`
if the field is not one this kind's getter carries ([`src/server/handlers/get_bool.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_bool.rs#L22)):

- bool: one payload byte, `1` or `0` ([`src/server/handlers/get_bool.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_bool.rs#L24), store [`src/store/get_bool.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/get_bool.rs#L21)).
- u8: one payload byte ([`src/server/handlers/get_u8.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_u8.rs#L22), store [`src/store/get_u8.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/get_u8.rs#L21)).
- i8: one payload byte, the value reinterpreted ([`src/server/handlers/get_i8.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_i8.rs#L24), store
  [`src/store/get_i8.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/get_i8.rs#L21)).
- str: up to `STRING_CAP = 64` payload bytes with no trailing NUL ([`src/server/handlers/get_str.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_str.rs#L22),
  store [`src/store/get_str.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/get_str.rs#L22)).

### set

`handle_set::dispatch` first applies the write gate (see [gate.md](/docs/userland/policy/gate/)), then routes by kind to the
matching setter ([`src/server/handle_set.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handle_set.rs#L40)). Each setter length-checks the payload, mutates the store,
mirrors the field if it is a kernel-mirrored one, and replies:

- bool: payload must be exactly one byte or `E_BAD_LEN`; nonzero is true; on success it mirrors through
  `push::on_bool_set` and replies empty; an unknown bool field is `E_INVAL`
  ([`src/server/handlers/set_bool.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_bool.rs#L23)).
- u8: exactly one byte or `E_BAD_LEN`; the value is range-checked in the store (`E_INVAL` if over the field
  max) before the mutation ([`src/server/handlers/set_u8.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_u8.rs#L22), [`src/store/set_u8.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/set_u8.rs#L22)).
- i8: exactly one byte or `E_BAD_LEN`; the store enforces `-12..=14` for `Timezone` (`E_INVAL` otherwise);
  on success it mirrors through `push::on_i8_set` ([`src/server/handlers/set_i8.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_i8.rs#L23),
  [`src/store/set_i8.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/set_i8.rs#L25)).
- str: at most `STR_MAX = 63` bytes or `E_BAD_LEN`; the store further caps at `STRING_CAP = 64` and
  validates the byte set to `[A-Za-z0-9._-]` (`E_INVAL` otherwise); on success it mirrors through
  `push::on_string_set` ([`src/server/handlers/set_str.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_str.rs#L24), [`src/store/set_str.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/set_str.rs#L23),
  [`src/store/str_validate.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/str_validate.rs#L17)).

## The request loop

`server::run` allocates one 512-byte buffer and loops forever, polling the endpoint, decoding the header,
bounds-checking the body against the frame, decoding the field, and dispatching on the op
([`src/server/runner.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L23)):

```
  run(endpoint):
      loop:
          n = recv::poll(endpoint, buf, &sender)      // mk_ipc_recv_from, non-blocking
          if n <= 0: mk_yield; continue                // nothing waiting, yield the CPU
          if n < HDR_LEN: continue                     // 12-byte header required, drop
          hdr = Header::decode(buf[..HDR_LEN])         // else drop
          if HDR_LEN + hdr.payload_len > n: E_INVAL    // body must fit the frame
          field = decode_field(hdr.field)              // u32 -> Field; else E_INVAL
          match hdr.op:
              OP_GET -> handle_get::dispatch(sender, field)
              OP_SET -> handle_set::dispatch(sender, field, body)
              _      -> E_INVAL
```

The receive is `mk_ipc_recv_from` in non-blocking poll mode, which also reports the sender pid
([`src/server/recv.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/recv.rs#L21)). The reply goes straight back to that sender through `mk_ipc_reply`
([`src/server/reply.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/reply.rs#L19)). A frame shorter than the 12-byte header, or one whose header fails to decode,
is silently skipped rather than answered; only a decodable header with a bad op, a bad field, or a body
that runs past the frame gets an error reply ([`src/server/runner.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L32), `:36`, `:42`).

## The reply and the error table

A success reply is a header with `status = E_OK` followed by the payload; `respond::ok` refuses a payload
that would exceed the buffer and downgrades it to `E_BAD_LEN` ([`src/server/respond/ok.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond/ok.rs#L24)). Every failure
is a header-only reply carrying the op, field, kind, and a status word ([`src/server/respond/err.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond/err.rs#L21)).

| Status | Value | When | Source |
|--------|-------|------|--------|
| `E_OK` | 0 | success reply | `errno.rs:17`, [`src/server/respond/ok.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond/ok.rs#L33) |
| `E_INVAL` | 22 | unknown op, unknown field discriminant, body longer than the frame, or a value the store rejects | `errno.rs:18`, [`src/server/runner.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L42), `:48`, `:55` |
| `E_BAD_LEN` | 90 | payload length wrong for the kind, or a reply payload that would exceed the buffer | `errno.rs:19`, [`src/server/handlers/set_bool.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_bool.rs#L25), [`src/server/respond/ok.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond/ok.rs#L26) |
| `E_NOT_FOUND` | 91 | `get` for a field this kind's getter does not carry | `errno.rs:20`, [`src/server/handlers/get_bool.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_bool.rs#L28) |
| `E_ACCES` | 93 | `set` from a caller that is not a trusted setter | `errno.rs:22`, [`src/server/handle_set.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handle_set.rs#L42) |

`E_WRONG_KIND` (92) is defined in the proto but is not currently raised by any handler; a kind mismatch
surfaces as `E_BAD_LEN` or `E_INVAL` through the per-kind length and field checks
([`userland/policy_proto/src/errno.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/errno.rs#L21)).

## Source map

This page is drawn from `userland/policy_proto/src/` (`hdr.rs`, `kind.rs`, `ops.rs`, `errno.rs`,
`limits.rs`, `service.rs`, `field_decode.rs`) and `userland/capsule_policy/src/server/` (`runner.rs`,
`recv.rs`, `reply.rs`, `handle_get.rs`, `handle_set.rs`, `handlers/`, `respond/`). Every reference above is
verified against those trees.
