---
title: "The Network Stack"
description: "The TCP/IP stack in NØNOS runs in a capsule, not the kernel."
weight: 1
---
The TCP/IP stack in NØNOS runs in a capsule, not the kernel. One capsule, `net_core`, holds a full
smoltcp interface, ARP, IPv4, TCP, UDP, DHCP, and DNS, and drives it over a device that bridges to
the NIC driver capsule by IPC. This page documents that stack and how it is assembled. The code is
`userland/capsule_net_core/`.

## smoltcp in a capsule

`net_core` builds on smoltcp 0.11 (`Cargo.toml`), the no_std Rust TCP/IP stack. Its interface is
constructed in [`iface/build.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/iface/build.rs):

```
  build(mac, port):
      seed  = crypto_random(8)                 // random_seed for the stack
      config = Config::new(Ethernet(mac)); config.random_seed = seed
      device = NicDevice { port }              // the bridge to the NIC driver capsule
      iface  = Interface::new(config, device, now)
      sockets = SocketSet::new(...)
```

So `net_core` is a real TCP/IP stack: it owns a smoltcp `Interface` and a `SocketSet`, seeds it with
kernel randomness, and polls it forward. The layers, Ethernet and ARP, IPv4, and the TCP and UDP
transports, are smoltcp's, and `net_core` adds the NØNOS-specific pieces around them: the device
bridge, the [DHCP](/docs/subsystems/networking/services/) client, the [DNS](/docs/subsystems/networking/services/) resolver, and the IPC server that
other capsules call.

## The device bridge

smoltcp talks to hardware through a `Device`, and `net_core`'s device is `NicDevice`
(`src/device/`), which does not touch hardware itself: it exchanges frames with the NIC driver
capsule over IPC, keyed by a `port`. The device implements the standard token model, an `rx_token`
yields a received frame to the stack and a `tx_token` accepts a frame to transmit, and the tokens
move the bytes to and from the [driver capsule](/docs/subsystems/networking/drivers/). This is the seam that keeps the TCP/IP
stack and the device driver in separate capsules: `net_core` speaks IP and TCP, the driver speaks
DMA rings and registers, and they meet at a frame over IPC.

## The server and the poll loop

`net_core` runs a request server (`src/server/`) and polls the interface. The server parses an
incoming request (`parse_req`), runs the operation against the socket set, and responds
(`respond`); the poll ([`iface/poll.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/iface/poll.rs)) advances smoltcp, processing received frames, running the
protocol timers, and emitting frames to transmit. The protocol wire types for TCP, UDP, and DNS are
in `src/protocol/`. The result is one capsule that, given a MAC address and a driver port, brings up
a full IP host: it obtains an address by DHCP, resolves names by DNS, and serves TCP and UDP.

## Consolidated and decomposed

There are two forms of the stack, and it is worth being clear which runs. The live form is the
consolidated `net_core` above, selected by the `nonos-capsule-net-core` feature. There is also a
decomposed form, separate `net_l2`, `net_ip`, `net_tcp`, `net_udp`, `net_dhcp`, and `net_dns`
capsules, each a layer of the stack talking to its neighbors over IPC; those per-layer spawns are
compiled out when `net-core` is enabled ([`src/userspace/init/spawn_plan/network/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/mod.rs)). The
decomposed form is the maximal-isolation design (one capsule per protocol layer); the consolidated
`net_core` is the form that is [runtime-proven](/docs/subsystems/networking/services/), bringing the stack up to a bound DHCP
lease on a desktop boot.

## Source

```
  userland/capsule_net_core/src/iface/build.rs   the smoltcp Interface construction
  userland/capsule_net_core/src/device/          NicDevice, the rx/tx tokens over IPC
  userland/capsule_net_core/src/iface/poll.rs    the poll loop
  userland/capsule_net_core/src/server/          the request server
  userland/capsule_net_core/src/protocol/        TCP, UDP, DNS wire types
  src/userspace/init/spawn_plan/network/         the consolidated vs decomposed spawn
```
