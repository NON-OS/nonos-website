---
title: "Server"
description: "This page mirrors src/server/, the loop and the reply machinery."
weight: 3
---
This page mirrors `src/server/`, the loop and the reply machinery. The module has three parts: `runner`,
the receive/dispatch/reply loop; `respond`, the reply builders; and `handlers`, the per-op work. It
re-exports `run` through [`src/server/mod.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/mod.rs#L21). The handlers themselves are on the [decode](/docs/userland/image-codec/decode/)
page; this page covers how a request gets to one and how the answer gets back.

## Entry

The capsule is `no_std`/`no_main`. Its `_start` initializes the heap and, on success, calls
`server::run`, which never returns ([`src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L28), [`src/main.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L32)). A heap init failure exits with
status 1 before the loop starts ([`src/main.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L29)).

`run` allocates one receive buffer and one transmit buffer, each `HDR_LEN + IPC_PAYLOAD_MAX` bytes, and
loops forever calling `drain_ipc` ([`src/server/runner.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L28), `runner.rs:31`). The buffers are allocated
once and reused for every request, so the steady-state loop does no per-request allocation for transport.

## The blocking-then-drain loop

`drain_ipc` is the core ([`src/server/runner.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L36)). It starts blocking and switches to non-blocking after
the first message:

```
  blocking = true
  loop:
    timeout = RECV_BLOCK if blocking else RECV_NOWAIT      runner.rs:40
    n = mk_ipc_recv_from(SERVICE_INBOX, rx, timeout, &sender)   runner.rs:41
    if n <= 0 or sender_pid == 0: return                  runner.rs:42
    blocking = false                                      runner.rs:45
    parse, dispatch, reply                                runner.rs:46
```

The first receive blocks on the service inbox (`SERVICE_INBOX = 0`, `RECV_BLOCK = 0`) until a message
arrives (`runner.rs:24`, `runner.rs:25`, `runner.rs:41`). After servicing it, `blocking` flips to false and
subsequent receives are non-blocking (`RECV_NOWAIT = 1`, `runner.rs:26`, `runner.rs:45`). The loop drains
everything already queued and, when a non-blocking receive returns nothing, ends and returns to `run`,
which calls `drain_ipc` again and blocks. A receive that returns `n <= 0` or a zero sender pid is treated
as empty and ends the drain (`runner.rs:42`). The effect is that the capsule sleeps when idle, wakes on the
first request, clears the backlog in one pass, and sleeps again.

## Dispatch

For each received frame the loop parses it and dispatches on the opcode ([`src/server/runner.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L46)):

```
  parse(&rx[..n]) -> Err(req, errno)  =>  respond::status(errno); continue   runner.rs:49
  OP_HEALTHCHECK, body empty          =>  handlers::health::handle           runner.rs:52
  OP_DECODE_PNG|BMP|LZ4_RAW|JPEG      =>  handlers::decode::handle           runner.rs:53
  other op, body empty                =>  respond::status(E_BAD_OP)          runner.rs:54
  anything else                       =>  respond::status(E_INVAL)           runner.rs:55
```

A parse failure replies with the parser's own errno and moves to the next message; the parser hands back a
default `Request` alongside the errno so the reply header can still carry the right shape
([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19), `runner.rs:49`). `OP_HEALTHCHECK` is served only with an empty body; a
healthcheck with a non-empty body falls through to the `E_INVAL` arm. The four decode ops are grouped into a
single arm that calls the decode handler regardless of body (the handler validates the body per format).
Any opcode outside the known set with an empty body is `E_BAD_OP`, and anything else is `E_INVAL`. The op
constants and error codes are on the [protocol](/docs/userland/image-codec/protocol/) page.

## Replies

`respond` builds the two reply shapes over `mk_ipc_reply` ([`src/server/respond.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs)):

- `status(sender_pid, req, errno, tx)` writes the response header with a `STATUS_LEN` payload and the errno
  status word, then replies `HDR_LEN + STATUS_LEN` bytes (`respond.rs:21`). This is every error path and
  the healthcheck success.
- `payload(sender_pid, req, body_len, tx)` writes the response header with a `STATUS_LEN + body_len`
  payload and a zero status word, then replies `HDR_LEN + STATUS_LEN + body_len` bytes (`respond.rs:27`).
  The decode handler uses this with `body_len = DECODE_RESP_LEN` after filling the 32-byte descriptor
  ([`src/server/handlers/decode.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L44)).

Both reuse `response_header` and `write_status` from the protocol module (`respond.rs:22`, `respond.rs:23`,
`respond.rs:29`), so the wire encoding lives in one place. The reply goes back to the `sender_pid` returned
by the receive, so an answer always reaches the caller that made the request.

## Handlers

`handlers` is three modules ([`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17)):

- `health` replies status 0 with no payload ([`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20)).
- `decode` is the format dispatch and the parser boundary, covered on the [decode](/docs/userland/image-codec/decode/) page
  ([`src/server/handlers/decode.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L25)).
- `surface` maps, registers, and shares the decoded ARGB pixels, also covered on the [decode](/docs/userland/image-codec/decode/)
  page ([`src/server/handlers/surface.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/surface.rs#L28)).

## Source map

This page is drawn from [`userland/capsule_image_codec/src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/main.rs) (the entry) and
`src/server/` (`runner.rs`, `respond.rs`, `mod.rs`, and the `handlers/` tree), together with the protocol
constants and encoders under `src/protocol/` that the loop and the reply builders use. Every reference
above is verified against those trees.
