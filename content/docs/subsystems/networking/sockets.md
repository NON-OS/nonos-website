---
title: "The Sockets Service"
description: "Applications do not talk to the TCP/IP stack directly."
weight: 3
---
Applications do not talk to the TCP/IP stack directly. They talk to a sockets service, `net.sockets`,
which exposes a BSD-socket API over IPC and drives the [network stack](/docs/subsystems/networking/stack/) underneath. This is
the surface a NØNOS program's `TcpStream` or `UdpSocket` binds to. This page documents it. The code
is `src/userspace/capsule_net_sockets/` and `userland/capsule_net_sockets/`.

## The service

`net.sockets` is a capsule registered under a named service endpoint
([`src/userspace/capsule_net_sockets/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_net_sockets/spawn.rs#L31)):

```
  SERVICE_NAME = "net.sockets"
  REPLY_INBOX  = "endpoint.net.sockets.reply"
```

A client reaches it by name through the [IPC](/docs/subsystems/ipc/) service registry, sends a socket
request, and reads the reply from the endpoint inbox. Because the endpoint has a required capability,
only a capsule granted network access can open a socket, and the kernel-attested sender identity means
the service knows which capsule owns which socket.

## The socket operations

The wire protocol is the BSD-socket call set ([`.../protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../protocol/ops.rs)):

```
  OP_SOCKET   OP_BIND     OP_LISTEN   OP_ACCEPT   OP_CONNECT
  OP_SEND     OP_RECV     OP_CLOSE    OP_GETSOCKOPT  OP_SETSOCKOPT
  OP_HEALTHCHECK
```

These map one-to-one to the POSIX socket calls: create a socket, bind it to an address, listen and
accept for a server, connect for a client, send and receive data, close, and get or set socket
options. A socket lives in the service's socket table keyed to its owning capsule; the operations run
against the [net_core](/docs/subsystems/networking/stack/) stack over IPC, so a `send` becomes a write into a smoltcp TCP or UDP
socket and a `recv` reads from it. The service is the translation between the familiar socket API and
the capsule-hosted stack.

## The standard-library binding

The reason the API is BSD-shaped is that the NØNOS standard library binds to it: `nonos_std`'s
`TcpStream` and `UdpSocket` are implemented over `net.sockets`, so a Rust program that opens a
`TcpStream::connect` issues `OP_SOCKET` then `OP_CONNECT` to the service and reads and writes with
`OP_SEND` and `OP_RECV`, without knowing there is a capsule boundary underneath. This is what lets
ordinary networked Rust code run on NØNOS: the socket calls it makes land on a capability-checked IPC
service backed by a real TCP/IP stack, rather than on a kernel syscall.

## Source

```
  src/userspace/capsule_net_sockets/spawn.rs        the service name and spawn
  userland/capsule_net_sockets/src/protocol/ops.rs   the socket op set
  userland/capsule_net_sockets/src/sockets/          the socket table
  userland/capsule_net_sockets/src/server/handlers/  bind, connect, send, recv, sockopt
```
