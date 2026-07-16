---
title: "The NIC bridge"
description: "This page mirrors src/device/ and src/setup.rs."
weight: 4
---
This page mirrors `src/device/` and [`src/setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs). It documents how `net_core` finds a NIC driver capsule,
brings its link up, reads its MAC, and then presents that driver to smoltcp as a `phy::Device` that
exchanges Ethernet frames over IPC. This is the boundary between the TCP/IP stack and the hardware: the
stack never touches the NIC, it calls a driver capsule that holds the device. For the smoltcp interface
built on top of this device, read the [iface](/docs/userland/net-core/iface/) page; for the `NNET` wire format used here, read
the [protocol](/docs/userland/net-core/protocol/) page.

## Discovery and bring-up

`setup::run` is the whole bring-up ([`src/setup.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L46)). It discovers a NIC driver by service name, brings
the link up, reads the MAC, builds the smoltcp state, and stores it. If any step fails it returns a
`SetupError` variant ([`src/setup.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L27)), and `main` decides whether to retry or exit on it
([README](/docs/userland/net-core/), [`src/main.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L45)).

Discovery walks a fixed candidate list and returns the port of the first driver the registry knows:
`driver.virtio_net0`, `driver.e1000_0`, `driver.rtl8169_0`, `driver.rtl8139_0`
([`src/setup.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L23), [`src/setup.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L35)). No match returns `SetupError::NicNotFound`, which `main` treats as
retryable so the stack waits for the driver to come up rather than dying ([`src/setup.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L47), [`src/main.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L49)).

With a port in hand, bring-up asks the driver three things over the `NNET` protocol, each a single
`mk_ipc_call`:

- `link_up` sends `OP_LINK_STATUS` and reads a 5-byte body (a 4-byte status word and a 1-byte up flag),
  returning `Some(true)` only when the status is zero and the flag is non-zero ([`src/device/link_up.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/link_up.rs#L23)).
  A down link returns `SetupError::LinkDown` (retryable), a malformed reply `SetupError::LinkFailed`
  ([`src/setup.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L48)).
- `mac` sends `OP_MAC_ADDRESS` and reads a 10-byte body (a 4-byte status and the 6-byte MAC), returning the
  MAC only on a zero status ([`src/device/mac.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/mac.rs#L23)). A failure returns `SetupError::MacFailed`
  ([`src/setup.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L53)).

Each request carries a fresh request id from a monotonic counter that never reuses zero
([`src/device/seq.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/seq.rs#L21)), so a reply can be matched to its call.

## The phy::Device bridge

`NicDevice` is the smoltcp device the interface drives, and it holds nothing but the driver's IPC port
([`src/device/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/types.rs#L19)). The `Device` impl is the bridge ([`src/device/device_impl.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/device_impl.rs#L23)):

- `receive` polls one frame from the driver and, if one arrives, hands back an rx token holding that frame
  and a tx token ([`src/device/device_impl.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/device_impl.rs#L27)). Returning `None` when no frame is ready is how smoltcp
  learns the receive queue is empty.
- `transmit` always returns a tx token; the frame is not built until smoltcp fills the token
  ([`src/device/device_impl.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/device_impl.rs#L32)).
- `capabilities` reports a 1514-byte MTU over an Ethernet medium ([`src/device/device_impl.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/device_impl.rs#L36)), matching
  the maximum frame the receive path is sized for ([`src/device/rx.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/rx.rs#L26)).

## The receive path

`rx::poll_frame` sends `OP_RX_PACKET` and reads a reply sized for a full frame:
`HDR_LEN + 4 + 4 + 12 + 1514` bytes ([`src/device/rx.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/rx.rs#L27)). It validates the op, a zero status, and a
payload long enough to hold the frame-length field, then reads the 4-byte frame length after the status,
bounds-checks that the frame fits the received buffer, and returns the frame bytes as an owned `Vec`
([`src/device/rx.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/rx.rs#L44)). Any shortfall or non-zero status returns `None`, which smoltcp reads as no frame
available. The rx token simply hands smoltcp a mutable view of that owned frame
([`src/device/rx_token.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/rx_token.rs#L21)).

## The transmit path

When smoltcp consumes a tx token it asks for a buffer of a given length, fills it with the outbound frame,
and the token forwards it to the driver ([`src/device/tx_token.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/tx_token.rs#L23)). `tx::send_frame` prepends the 20-byte
`NNET` header with `OP_TX_PACKET` and the frame length as the payload length, copies the frame after the
header, sends it, and checks the reply's op and a non-negative status ([`src/device/tx.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/tx.rs#L25)). The send
result is not surfaced back into smoltcp's return value; the token returns whatever the fill closure returned
([`src/device/tx_token.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/tx_token.rs#L28)), which is smoltcp's contract for a fire-and-forget transmit.

## What the bridge does not do

The bridge is frame-in, frame-out. It does not program the NIC, map registers, bind interrupts, or touch
DMA; all of that lives in the driver capsule, which holds the broker authority `net_core` deliberately does
not ([README](/docs/userland/net-core/)). `net_core` holds no `DeviceEnum`, `Driver`, `Mmio`, `Irq`, or `Dma` bit; its
only reach to the hardware is these four `NNET` calls to a driver it found by name.

## Source map

```
  userland/capsule_net_core/src/setup.rs             discovery, link-up, MAC, build, and the SetupError set
  userland/capsule_net_core/src/device/mod.rs        the device module's public surface
  userland/capsule_net_core/src/device/types.rs      NicDevice, NicRxToken, NicTxToken
  userland/capsule_net_core/src/device/device_impl.rs the smoltcp phy::Device impl and capabilities
  userland/capsule_net_core/src/device/link_up.rs    OP_LINK_STATUS over NNET
  userland/capsule_net_core/src/device/link_state.rs the link_up re-export
  userland/capsule_net_core/src/device/mac.rs        OP_MAC_ADDRESS over NNET
  userland/capsule_net_core/src/device/mac_addr.rs   the mac re-export
  userland/capsule_net_core/src/device/rx.rs         OP_RX_PACKET and the frame decode
  userland/capsule_net_core/src/device/rx_token.rs   the smoltcp RxToken impl
  userland/capsule_net_core/src/device/tx.rs         OP_TX_PACKET and the frame encode
  userland/capsule_net_core/src/device/tx_token.rs   the smoltcp TxToken impl
  userland/capsule_net_core/src/device/seq.rs        the request-id counter that never reuses zero
  userland/capsule_net_core/src/protocol/ops.rs      the NNET magic and the four device ops
```

Every reference above is verified against those trees.
