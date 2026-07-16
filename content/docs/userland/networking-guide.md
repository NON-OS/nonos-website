---
title: "Using the Network"
description: "This page is the developer's view of networking: how a capsule opens a TCP connection or sends a UDP datagram, what happens underneath, and what is and is not supported."
weight: 6
---
This page is the developer's view of networking: how a capsule opens a TCP connection or sends a UDP
datagram, what happens underneath, and what is and is not supported. For the internals of the stack
itself, see the [networking subsystem](/docs/subsystems/networking/); this page is about using it.

## The familiar API

A capsule uses the standard socket types, whether through the [std PAL](/docs/userland/std-pal/) (`std::net`) or the
[nonos_std crate](/docs/userland/nonos-std/) (`nonos_std::net`). The code looks like ordinary Rust:

```rust
  // TCP client
  let mut stream = TcpStream::connect("example.com:80")?;
  stream.write_all(b"GET / HTTP/1.0\r\n\r\n")?;
  let mut buf = Vec::new();
  stream.read_to_end(&mut buf)?;

  // UDP
  let sock = UdpSocket::bind("0.0.0.0:0")?;
  sock.send_to(b"ping", "10.0.2.3:9000")?;
  let (n, from) = sock.recv_from(&mut buf)?;
```

There is nothing NØNOS-specific in the source. `TcpStream`, `TcpListener`, and `UdpSocket` have their
usual methods, and a networked crate written for a host runs unchanged.

## What happens underneath

Each socket call becomes an IPC request to the `net.sockets` capsule ([`net/connection/nonos.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/net/connection/nonos.rs) in the
PAL, `net/` in nonos_std). The backend speaks the [sockets op set](/docs/subsystems/networking/sockets/):

```
  TcpStream::connect   ->  OP_SOCKET then OP_CONNECT
  stream.write         ->  OP_SEND
  stream.read          ->  OP_RECV
  TcpListener::bind     ->  OP_SOCKET, OP_BIND, OP_LISTEN
  listener.accept       ->  OP_ACCEPT
  UdpSocket::bind       ->  OP_SOCKET, OP_BIND
  drop(stream)          ->  OP_CLOSE
```

The `net.sockets` capsule runs those against the [smoltcp stack](/docs/subsystems/networking/stack/) in
`net_core`, which in turn exchanges frames with the [NIC driver capsule](/docs/subsystems/networking/drivers/).
A name in `connect("example.com:80")` is resolved by the DNS path (the PAL net backend also speaks to a
`net.dns` capsule) using the resolver the DHCP lease configured. So a single `TcpStream::connect` fans
out across four capsules, resolver, sockets, stack, and driver, but the caller sees one blocking call.

## The capability gate

Networking is a granted capability. The `net.sockets` endpoint has a required capability, and only a
capsule whose manifest granted it network access can open a socket; a capsule without it gets a
permission error from the first `OP_SOCKET`. This is the same capability model as the rest of the
system: a program does not get the network by default, it gets it because its
[manifest](/docs/security/capsules-and-trust/) asked for and was granted the capability, and the kernel
attests the caller's identity to the sockets service so one capsule's sockets are not another's.

## What works and what does not

The supported surface is the common case, and the limits are stated honestly (they come from the
[std PAL net backend](/docs/userland/std-pal/) and the IPv4 stack):

```
  supported     TCP connect / read / write, TCP listen / accept, UDP bind / send / recv, DNS lookup
  no-op         socket options (set_nodelay, timeouts, and similar are best-effort no-ops)
  unsupported   IPv6 and multicast (the userland stack is IPv4)
```

A program that connects, exchanges bytes, and closes works. A program that depends on a specific socket
option taking effect, or on IPv6, will find those unsupported rather than silently mis-behaving: the
option is ignored and IPv6 addresses are refused. The DHCP-obtained address is what the stack binds
(proven at runtime to a bound lease on a live boot), so `0.0.0.0` binds are on the leased interface.

## Source

```
  toolchain/nonos-std/sys/net/connection/nonos.rs   the std PAL net backend (ops, DNS, limits)
  userland/sdk/nonos_std/src/net/                    the nonos_std net types
  userland/capsule_net_sockets/                      the net.sockets service
  src/userspace/capsule_net_sockets/spawn.rs         the service registration and capability
```
