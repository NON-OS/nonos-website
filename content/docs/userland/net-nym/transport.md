---
title: "The Gateway Transport"
description: "This page documents the link the capsule uses to reach the mixnet: the NTCP client that speaks to the net.tcp capsule, the RFC 6455 WebSocket transport it runs over that stream,..."
weight: 7
---
This page documents the link the capsule uses to reach the mixnet: the `NTCP` client that speaks to the
`net.tcp` capsule, the RFC 6455 WebSocket transport it runs over that stream, and the raw-TCP alternative.
It mirrors `src/gateway_client/`, `src/tcp_client/`, and [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs). The packet these carry is on the
[packet](/docs/userland/net-nym/packet/) page; the gateway address and transport mode come from `OP_SET_GATEWAY` on the
[operations](/docs/userland/net-nym/operations/) page.

## The layering below the packet

`net_nym` does not touch a NIC and does not run its own TCP. It sends wire packets to an entry gateway by
asking `net.tcp` to carry bytes, exactly as any other TCP client would. Setup finds `net.tcp` once at
bring-up: `setup::run` looks up the service name `net.tcp`, stores its port, and the only failure is
`TcpMissing` when the lookup fails or returns port zero ([`src/setup.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L27)). Every later send or receive reads
that stored port back with `setup::tcp_port` ([`src/setup.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L33)). If the port is zero, meaning setup has not
completed, the data handlers reply `E_NO_TCP` rather than proceeding.

## The NTCP client

`src/tcp_client/` speaks the `NTCP` protocol to `net.tcp`. Its `envelope::call` frames a 20-byte `NTCP`
header (magic `0x4E544350`, version 1, an op, a request id, and a payload length), issues a synchronous
`mk_ipc_call` to the TCP port, and parses the reply, checking the magic, the echoed op, the errno, and the
declared length before copying the body out ([`src/tcp_client/envelope.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp_client/envelope.rs#L23)). On top of that, `ops`
implements the four calls the gateway needs ([`src/tcp_client/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp_client/ops.rs#L17)):

| Call | NTCP op | Body | Result |
|---|---|---|---|
| `connect` | 3 | ip4 + u16 port | a u32 stream handle |
| `send_all` | 5 | handle + chunk | splits the payload into `SEGMENT_MAX` (1460-byte) chunks |
| `recv` | 6 | handle | up to `out.len()` bytes |
| `close` | 7 | handle | drops the stream |

`send_all` chunks by 1460 bytes so a full 2413-byte wire packet crosses the TCP link as two segments
(`ops.rs:38`). These op numbers are `net.tcp`'s, not `net_nym`'s; the TCP capsule owns the connection state machine on the
other side, which `net_nym` treats as an opaque byte pipe.

## The two transports

A gateway is reached over one of two transports, chosen by the `mode` byte in `OP_SET_GATEWAY`: `0` is raw
TCP and `1` is WebSocket, with WebSocket the default ([`src/server/handlers/gateway.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/gateway.rs#L56)). The `Gateway`
struct carries the IP, port, stream handle, and transport tag ([`src/state/gateway.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/gateway.rs#L23)). The gateway client
dispatches on that tag for connect, send, receive, and close ([`src/gateway_client/ops.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/gateway_client/ops.rs#L22)):

- Raw TCP send and receive pass straight through to the `NTCP` `send_all` and `recv`
  ([`gateway_client/ops.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/gateway_client/ops.rs#L33)).
- WebSocket send and receive wrap and unwrap RFC 6455 frames, described below ([`gateway_client/ops.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/gateway_client/ops.rs#L34)).

`connect` opens the TCP stream first, and if the transport is WebSocket, runs the upgrade handshake on it
before returning the connected gateway ([`gateway_client/ops.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/gateway_client/ops.rs#L22)). `close` sends a WebSocket close frame
first when the transport is WebSocket, then closes the underlying TCP stream ([`gateway_client/ops.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/gateway_client/ops.rs#L45)).

## The WebSocket handshake

The upgrade is a real RFC 6455 client handshake, not a stub ([`src/gateway_client/ws/handshake.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/gateway_client/ws/handshake.rs#L26)). It
draws sixteen random bytes, base64-encodes them into a `Sec-WebSocket-Key`, and sends a GET with the
`Upgrade: websocket`, `Connection: Upgrade`, `Sec-WebSocket-Key`, and `Sec-WebSocket-Version: 13` headers
([`ws/request.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/ws/request.rs#L22)). It reads the response headers until the `\r\n\r\n` terminator, bounded to sixteen read
attempts and 2048 bytes, then verifies the accept (`handshake.rs:40`). `accept::verify` requires a `101`
status line, recomputes the expected `Sec-WebSocket-Accept` by appending the RFC 6455 GUID to the sent key,
taking SHA-1, and base64-encoding it, and compares that to the header the server returned, case-insensitively
on the header name ([`ws/accept.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/ws/accept.rs#L21)). The SHA-1 is implemented in the capsule ([`ws/sha1.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/ws/sha1.rs#L21)), as is the
base64 encoder ([`ws/base64.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/ws/base64.rs#L19)); neither is a syscall, because they are protocol glue rather than
security-critical crypto. A handshake failure surfaces as `E_GATEWAY_PROTO`.

## WebSocket framing

Once upgraded, data crosses as masked binary frames (`src/gateway_client/ws/frame/`). `send_binary` emits an
opcode `0x82` frame (FIN + binary), and every client frame is masked with a fresh random 4-byte mask as RFC
6455 requires of clients ([`ws/frame/send.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/ws/frame/send.rs#L24)). The length field uses the 7-bit form under 126 bytes and
the 16-bit extended form otherwise; a 2413-byte packet takes the extended form ([`ws/frame/send.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/ws/frame/send.rs#L52)).
`recv_binary` reads into a buffer, parses complete frames out of it, and handles the control frames inline:
it answers a Ping with a Pong, ignores a Pong, and treats a Close as an error, returning only on a Binary
frame ([`ws/frame/recv.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/ws/frame/recv.rs#L26)). The frame parser validates the FIN bit, reads the length in its 7-bit or
16-bit form, rejects the 64-bit form, and unmasks the payload if the mask bit is set
([`ws/frame/parse.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/ws/frame/parse.rs#L20), [`ws/frame/read.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/ws/frame/read.rs#L20)). Control-frame payloads are bounded to 125 bytes into a fixed
buffer, per the spec ([`ws/frame/parse.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/ws/frame/parse.rs#L48)).

## What is real here

This pillar is fully real and self-contained. The `NTCP` client makes genuine `mk_ipc_call` syscalls to the
live `net.tcp` capsule; the WebSocket handshake computes a real SHA-1 accept and checks it; the framing masks
and unmasks per the spec and services ping/pong. The one thing outside the tree is a gateway to connect to:
the capsule is a working WebSocket and raw-TCP client, but it dials an address supplied by `OP_SET_GATEWAY`,
and there is no in-tree gateway server. Reaching a real Nym gateway is a deployment and wire-compatibility
matter, not a gap in this code.

## Source map

```
  userland/capsule_net_nym/src/setup.rs                     find net.tcp, store its port
  userland/capsule_net_nym/src/tcp_client/envelope.rs       the NTCP frame and mk_ipc_call
  userland/capsule_net_nym/src/tcp_client/ops.rs            connect, send_all, recv, close
  userland/capsule_net_nym/src/gateway_client/ops.rs        the transport dispatch and connect/close order
  userland/capsule_net_nym/src/gateway_client/ws/handshake.rs  the RFC 6455 client handshake
  userland/capsule_net_nym/src/gateway_client/ws/request.rs    the upgrade GET
  userland/capsule_net_nym/src/gateway_client/ws/accept.rs     the Sec-WebSocket-Accept check
  userland/capsule_net_nym/src/gateway_client/ws/sha1.rs       the in-capsule SHA-1
  userland/capsule_net_nym/src/gateway_client/ws/base64.rs     the base64 encoder
  userland/capsule_net_nym/src/gateway_client/ws/frame/send.rs the masked frame emit
  userland/capsule_net_nym/src/gateway_client/ws/frame/recv.rs the frame receive and ping/pong
  userland/capsule_net_nym/src/gateway_client/ws/frame/parse.rs, read.rs  the frame parse and unmask
  userland/capsule_net_nym/src/state/gateway.rs             the Gateway struct and Transport tag
```

Every reference above is verified against those trees.
