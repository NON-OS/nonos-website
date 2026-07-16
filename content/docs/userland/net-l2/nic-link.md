---
title: "The NIC link"
description: "This is the pillar that reaches the hardware without holding any authority over it."
weight: 5
---
This is the pillar that reaches the hardware without holding any authority over it. It mirrors
`src/nic_client/`: the `NNET` envelope the driver capsule speaks, the request-id sequence, the MAC read, the
frame transmit, and the frame receive with its payload parser. The L2 capsule has no device grants; it talks
to a driver capsule that does, entirely by IPC through the service registry. For how the L2 capsule found
that driver, see the one-time NIC bind on the [operations](/docs/userland/net-l2/operations/) page. For the frames this pillar
carries, see the [framing](/docs/userland/net-l2/framing/) page.

## The NNET envelope

The NIC driver capsule speaks its own 20-byte v1 envelope, distinct from the `NL2` protocol L2 serves
upstream. The magic is `0x4E4E_4554` ("NNET"), the version is 1, and the header is 20 bytes
([`src/nic_client/wire.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/wire.rs#L24)). The three ops L2 uses are MAC address (3), TX packet (4), and RX packet (5)
([`src/nic_client/wire.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/wire.rs#L28)). L2 talks to the existing driver capsule unchanged: it uses `mk_ipc_call`, so
the reply comes back on L2's own pid inbox and no reply-port field is needed in the header
([`src/nic_client/wire.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/wire.rs#L17)).

`write_request` lays a request header down: magic, version, op, two zeroed 16-bit fields, the request id, and
the payload length, refusing a buffer shorter than 20 bytes ([`src/nic_client/header/write_request.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/header/write_request.rs#L19)).
`parse_response` validates a reply: it refuses a short buffer, checks the magic and version, and returns the
op, request id, and payload length ([`src/nic_client/header/parse_response.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/header/parse_response.rs#L19)). Every call path validates
the magic, version, op, and length of the reply before trusting a byte of its payload.

## The request-id sequence

`seq::next` hands out request ids from an atomic counter, skipping zero on wrap so a request id is never zero
([`src/nic_client/seq.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/seq.rs#L19)). Each of the three call paths draws a fresh id for its request
([`src/nic_client/mac.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/mac.rs#L32), [`src/nic_client/tx.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/tx.rs#L35), [`src/nic_client/rx/poll_frame.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/rx/poll_frame.rs#L30)).

## Reading the MAC

`read_mac` is the setup-time call. It writes an `OP_MAC_ADDRESS` request with no payload, sizes a response
buffer for the header plus a 4-byte status and a 6-byte MAC, and issues `mk_ipc_call`
([`src/nic_client/mac.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/mac.rs#L31)). A negative return is `SendFailed`; a length past the buffer is `BadResponse`
([`src/nic_client/mac.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/mac.rs#L38)). It then parses the response header and rejects a wrong op or a payload length
that is not exactly 4 + 6, and rejects a short body, before copying the six MAC bytes out from after the
status word ([`src/nic_client/mac.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/mac.rs#L46)). The three error variants, `SendFailed`, `BadResponse`, `BadLength`,
map upstream to a setup failure that keeps the retry loop running ([`src/setup/mod.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L36)).

## Transmitting a frame

`send_frame` writes an `OP_TX_PACKET` request whose payload is the raw frame, sized to the 20-byte header
plus the frame length, copies the frame in after the header, and calls the driver
([`src/nic_client/tx.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/tx.rs#L32)). The response is the header plus a 4-byte status. A negative call return is
`SendFailed`, an oversize reply or a wrong op/length is `BadResponse`, and a negative status word from the
driver is `Refused` ([`src/nic_client/tx.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/tx.rs#L42), `tx.rs:57`). `OP_SEND_FRAME`'s handler and the ingress
observer both call this; the handler maps any error to `E_TX_BUSY` upstream
([`src/server/handlers/send_frame.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send_frame.rs#L33), [`src/ingress.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingress.rs#L46)).

## Receiving a frame

`poll_frame` writes an `OP_RX_PACKET` request with no payload and sizes its response to `RESP_CAP`, which is
the header plus an 8-byte prefix, a 12-byte margin, and a 1514-byte maximum frame
([`src/nic_client/rx/poll_frame.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/rx/poll_frame.rs#L29), [`src/nic_client/rx/constants.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/rx/constants.rs#L19)). A negative call return is
`SendFailed` and an oversize reply is `BadResponse`; otherwise it hands the reply to the payload parser
([`src/nic_client/rx/poll_frame.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/rx/poll_frame.rs#L36)).

`parse_payload` is the strict decoder for a received frame. It validates the response header and the op,
then reads the 4-byte status word, treating a non-zero status as an empty receive
([`src/nic_client/rx/parse_payload.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/rx/parse_payload.rs#L24), `parse_payload.rs:38`). This is why `OP_POLL_FRAME` turns a
`RxError::Empty` into `E_RX_EMPTY` rather than a fault ([`src/server/handlers/poll_frame.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_frame.rs#L40)). On a
zero status it reads a 4-byte frame length after the status word, bounds-checks that the frame start plus
length stays inside the received buffer, and copies the frame out; any length that would run past the buffer
is `BadResponse` ([`src/nic_client/rx/parse_payload.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/rx/parse_payload.rs#L41), `parse_payload.rs:47`). The three RX error
variants are `SendFailed`, `BadResponse`, and `Empty` ([`src/nic_client/rx/error.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/nic_client/rx/error.rs#L18)).

## Why this holds no authority

Every path in this pillar is an IPC call to a port L2 resolved from the service registry
([`src/setup/discover.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover.rs#L40)), and every reply is validated by magic, version, op, and length before its
payload is trusted. L2 never maps a BAR, binds an interrupt, or programs DMA; the driver capsule that does
holds those broker grants, and L2's manifest carries none of them (see the mask on the [README](/docs/userland/net-l2/)).
The link between the two is a capability-checked service handle, not a shared hardware handle.

## Source map

```
  userland/capsule_net_l2/src/nic_client/wire.rs               NNET magic, version, and the three ops
  userland/capsule_net_l2/src/nic_client/seq.rs                the non-zero request-id sequence
  userland/capsule_net_l2/src/nic_client/header/write_request.rs   the NNET request-header encoder
  userland/capsule_net_l2/src/nic_client/header/parse_response.rs  the NNET response-header validator
  userland/capsule_net_l2/src/nic_client/mac.rs                read_mac and its error set
  userland/capsule_net_l2/src/nic_client/tx.rs                 send_frame and its error set
  userland/capsule_net_l2/src/nic_client/rx/poll_frame.rs      poll_frame: request and buffer sizing
  userland/capsule_net_l2/src/nic_client/rx/constants.rs       MAX_FRAME and RESP_CAP
  userland/capsule_net_l2/src/nic_client/rx/parse_payload.rs   the strict received-frame decoder
  userland/capsule_net_l2/src/nic_client/rx/error.rs           the RX error variants
  userland/capsule_net_l2/src/setup/discover.rs                the service-registry NIC lookup
```

Every reference above is verified against those trees.
</content>
