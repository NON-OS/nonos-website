---
title: "Login protocol and dispatch"
description: "Login is a pure IPC service. It has no window, no input subscription, and no line editor; it answers a four-operation protocol on its service port and nothing else. This page fo..."
weight: 2
---
Login is a pure IPC service. It has no window, no input subscription, and no line editor; it answers a
four-operation protocol on its service port and nothing else. This page follows the wire format under
`src/protocol/` and the receive loop and handlers under `src/server/`. For what the operations actually do
to the session, see [the unlock flow](/docs/userland/login/unlock/); for identity and the capability mask, see the
[README](/docs/userland/login/).

## The frame

Every request is a 20-byte header followed by an explicit payload. The header is magic `NLGN`
(`0x4E4C474E`), version 1, then op, flags, a reserved gap, request id, and payload length
([`src/protocol/header.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L1), `:2`, `:3`). The parser reads the fields at fixed offsets: magic at 0, version
at 4, op at 6, flags at 8, request id at 12, payload length at 16, and the body from byte 20
([`src/protocol/decode.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L7), `:11`, `:15`, `:20`, `:26`, `:32`, `:39`).

The parse is strict and ordered. A buffer shorter than 20 bytes is `E_BAD_LEN` before any field is read
([`src/protocol/decode.rs:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L4)). A wrong magic is `E_BAD_MAGIC`, a wrong version is `E_BAD_VERSION`, and a
declared payload length that does not make `HDR_LEN + payload_len` equal the received length is `E_BAD_LEN`
([`src/protocol/decode.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L23), `:29`, `:36`). Only a frame that passes all of these yields the request and a
body slice. On any failure the parser still returns a best-effort `Request` so the runner can reply with the
right op and request id echoed back ([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19), `:42`).

The response header mirrors the request: same magic, version, op, flags, and request id, with the reserved
bytes zeroed and the payload length set to what the handler wrote ([`src/protocol/encode.rs:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L3)). A
status-only reply is a 4-byte little-endian status word after the header; a payload reply is the status
word followed by the body ([`src/protocol/encode.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L13), [`src/server/respond.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L5), `:11`).

## The four operations

There are exactly four ops ([`src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs)):

```
  OP_HEALTHCHECK    0x0001    empty body  -> status
  OP_START_SESSION  0x0002    body = key_id:u32 (4 bytes) -> status
  OP_END_SESSION    0x0003    empty body  -> status
  OP_GET_STATE      0x0004    empty body  -> status + state:u32 owner_pid:u32 serial:u32
```

`START_SESSION` is the only op that carries a body, and its body is exactly four bytes: a little-endian key
id ([`src/protocol/limits.rs:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L4), [`src/server/handlers/start_session.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs#L10), `:14`). This is the entire input
surface of the capsule. There is no passphrase field, no character buffer, and no variable-length text
anywhere in the request; a `START_SESSION` with any body length other than 4 is `E_INVAL`
([`src/server/handlers/start_session.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs#L10)). `GET_STATE` is the only op that returns a payload, a 12-byte
projection of the session machine ([`src/protocol/limits.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L5)).

## The receive loop

The server loop runs forever over a fixed pair of buffers sized to the 20-byte header plus a 256-byte
payload ceiling ([`src/server/runner.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L16), `:17`, [`src/protocol/limits.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L1)). It receives on service inbox
0, and only that inbox; login subscribes to no input or event channel ([`src/server/runner.rs:12`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L12), `:30`).

The loop batches. `drain` blocks for the first message of a batch, then switches to non-blocking receives
and drains without waiting until the inbox is empty, at which point it returns and the outer loop blocks
again ([`src/server/runner.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L25), `:28`, `:34`, `:31`). A receive that returns nothing or a zero sender pid
ends the batch ([`src/server/runner.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L31)). Every message is parsed against the header before dispatch; a
frame the parser rejects gets that parser's errno straight back, echoed on the request it managed to
recover ([`src/server/runner.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L35), `:38`).

## Dispatch by op

Dispatch is a match on `req.op` with a body-shape guard on each arm ([`src/server/runner.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L42)):

```
  OP_HEALTHCHECK   if body empty  -> health::handle
  OP_START_SESSION                -> start_session::handle   (checks its own body length)
  OP_END_SESSION   if body empty  -> end_session::handle
  OP_GET_STATE     if body empty  -> get_state::handle
  _  if body empty                -> E_BAD_OP
  _                               -> E_INVAL
```

The guards matter. `HEALTHCHECK`, `END_SESSION`, and `GET_STATE` require an empty body; a body on one of
those ops falls through to the final arm and is `E_INVAL` ([`src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L43), `:45`, `:48`, `:55`).
An unknown op with an empty body is `E_BAD_OP`, and an unknown op that carries a body is `E_INVAL`
([`src/server/runner.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L51), `:52`, `:54`). `START_SESSION` has no empty-body guard here because it must
inspect its 4-byte body itself, which it does in its handler ([`src/server/handlers/start_session.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs#L10)).

## The handlers

Each op is one file under `src/server/handlers/`.

- `health::handle` replies status 0 with no body; it is the liveness probe and touches no state
  ([`src/server/handlers/health.rs:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L4)).
- `start_session::handle` is the unlock. It validates the 4-byte key id, calls the keyring, flips the
  session state, notifies the desktop shell, repaints, and presents, rolling back on any follow-on failure.
  The full flow is [its own page](/docs/userland/login/unlock/) ([`src/server/handlers/start_session.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs#L9)).
- `end_session::handle` relocks: it reads the current key id, ends the session with an owner-pid check,
  relocks the key through the keyring, notifies the shell, and repaints the locked overlay
  ([`src/server/handlers/end_session.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/end_session.rs#L9)). Covered in [the unlock page](/docs/userland/login/unlock/).
- `get_state::handle` projects the machine to three little-endian words after the status: `state`,
  `owner_pid`, and the session serial, written at offset `HDR_LEN + STATUS_LEN`
  ([`src/server/handlers/get_state.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_state.rs#L6), `:8`). `Locked` reports all zeros; `Unlocked` reports `1`, the
  owner pid, and the serial ([`src/state/context/state_words.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/state_words.rs#L21), `:22`). The local binding is named
  `key_token` in the handler, but the value it carries is the session serial from `state_words`, not a key
  id ([`src/server/handlers/get_state.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_state.rs#L6), [`src/state/context/state_words.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/state_words.rs#L22)).

Every handler answers through `respond`, which builds the response header, writes the status word, and
replies to the sender's pid; there is no path in which a handler panics instead of returning a status
([`src/server/respond.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L5), `:11`).

## Source map

```
  userland/capsule_login/src/protocol/header.rs      NLGN magic, version, 20-byte header, Request
  userland/capsule_login/src/protocol/decode.rs      the strict field-by-field parser and its errnos
  userland/capsule_login/src/protocol/encode.rs      response header + status word writers
  userland/capsule_login/src/protocol/ops.rs         the four op numbers
  userland/capsule_login/src/protocol/limits.rs      payload ceiling, status len, body/state lengths
  userland/capsule_login/src/protocol/errno.rs       E_INVAL, E_BUSY, E_AUTH, E_BAD_OP, E_NOTREADY, parse errnos
  userland/capsule_login/src/server/runner.rs        the batched receive loop and op dispatch
  userland/capsule_login/src/server/respond.rs       status and payload reply builders
  userland/capsule_login/src/server/handlers/        health, start_session, end_session, get_state
  userland/capsule_login/src/state/context/state_words.rs   the GET_STATE projection
```

Every reference above is verified against those trees.