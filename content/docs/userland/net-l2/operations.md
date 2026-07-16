---
title: "Client operations and the NL2 protocol"
description: "Everything a client can ask the L2 capsule for crosses one boundary: the NL2 binary protocol over IPC."
weight: 2
---
Everything a client can ask the L2 capsule for crosses one boundary: the `NL2` binary protocol over IPC.
This page mirrors `src/protocol/` (the wire format), `src/server/` (the request loop, the caller
authorization, and the per-op handlers), and `src/setup/` and [`src/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs) (the one-time NIC bind and the
state the handlers read). A request arrives as a fixed 20-byte header plus an optional payload, the server
parses and dispatches it on a 16-bit opcode, and a handler writes a 20-byte response header carrying an
errno in its `flags` field, then any op-specific payload. For the identity table and the capability mask see
the [README](/docs/userland/net-l2/); for how a handler reaches the NIC see the [nic-link](/docs/userland/net-l2/nic-link/) page.

## The wire format

A request header is 20 bytes and begins with a magic and a version ([`src/protocol/header.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L31)). The magic
is distinct from the NIC protocol's so a stray router cannot mistake one service for the other
([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17)). The parser rejects anything shorter than the header, a wrong magic, or a
wrong version, returning the matching errno ([`src/protocol/decode.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L20)).

| Field | Offset | Width | Meaning |
|---|---|---|---|
| magic | 0 | u32 | `MAGIC = 0x4E4C_3200` ("NL2\0") (`header.rs:31`) |
| version | 4 | u16 | `VERSION = 1` (`header.rs:32`) |
| op | 6 | u16 | the opcode (`decode.rs:32`) |
| flags | 8 | u16 | request: unused; response: errno (`header.rs:25`, `encode.rs:32`) |
| _reserved | 10 | u16 | zero (`encode.rs:33`) |
| request_id | 12 | u32 | echoed into the response header (`decode.rs:33`, `encode.rs:34`) |
| payload_len | 16 | u32 | request payload length in bytes (`decode.rs:34`) |

The parser also range-checks the declared payload: it computes `HDR_LEN + payload_len` and rejects a buffer
shorter than that with `E_BAD_LEN`, then hands the handler a slice of exactly the payload bytes so a handler
never reads past what the client sent ([`src/protocol/decode.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L35)). Every reply is a response header of the
same 20-byte length with the errno in `flags`, followed by any payload; `write_header` refuses to write into
a buffer shorter than the header ([`src/protocol/encode.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L26)).

## The request loop

`server::run` sizes one receive buffer and one transmit buffer each to the header plus `IPC_PAYLOAD_MAX`, so
a single receive holds a full-MTU frame and a single send holds one back ([`src/server/runner.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L32)).
`IPC_PAYLOAD_MAX` is the 14-byte Ethernet header plus the 1500-byte MTU plus a 64-byte margin, so a caller
can wrap a v1 envelope around a full frame without splitting ([`src/protocol/limits.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L22)).

The loop receives a request with `mk_ipc_recv_from`, which also returns the kernel-attested sender pid
([`src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L38)). A receive of zero or fewer bytes, or a sender pid of zero, is skipped
([`src/server/runner.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L39)). A parse failure is dropped silently, since a malformed frame has no valid reply
target ([`src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L43)). Each recognised op routes to its handler, and an unrecognised opcode is
answered with `E_BAD_OP` ([`src/server/runner.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L52)).

## The seven operations

The opcodes are defined in [`src/protocol/ops.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L21) and dispatched in [`src/server/runner.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L44).

| Op | Opcode | Request payload | Reply payload after status | Handler |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | `1` | none | none (status only) | [`server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/health.rs#L20) |
| `OP_GET_MAC` | `2` | none | 6-byte MAC | [`server/handlers/get_mac.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/get_mac.rs#L21) |
| `OP_GET_LINK` | `3` | none | 1-byte up/down flag | [`server/handlers/get_link.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/get_link.rs#L22) |
| `OP_SEND_FRAME` | `4` | raw Ethernet frame | none (status only) | [`server/handlers/send_frame.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/send_frame.rs#L23) |
| `OP_POLL_FRAME` | `5` | none | raw Ethernet frame | [`server/handlers/poll_frame.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/poll_frame.rs#L28) |
| `OP_ARP_RESOLVE` | `6` | 4-byte target IPv4 | 6-byte MAC | [`server/handlers/arp_resolve.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/arp_resolve.rs#L28) |
| `OP_SET_IP` | `7` | 4-byte interface IPv4 | none (status only) | [`server/handlers/set_ip.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/set_ip.rs#L25) |

Every reply carries the errno in the response-header `flags` field and only then the op-specific payload
([`src/server/respond/respond.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond/respond.rs#L23)). The status-only ops go through `respond_status_only`, which writes the
header with a zero payload length ([`src/server/respond/respond_status_only.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond/respond_status_only.rs#L19)).

## Per-op detail

- `OP_HEALTHCHECK` always answers `E_OK` with no payload; it is pure liveness
  ([`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20)).
- `OP_GET_MAC` copies the six-byte MAC out of capsule state into the reply and answers `E_OK`
  ([`src/server/handlers/get_mac.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_mac.rs#L22)). The MAC was read from the NIC at setup.
- `OP_GET_LINK` answers `E_NO_LINK` if no NIC port is bound, otherwise writes a single `1` byte for up and
  answers `E_OK` ([`src/server/handlers/get_link.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_link.rs#L23)).
- `OP_SEND_FRAME` is caller-gated: only `net.ip` or `net.dhcp.client` may send. It rejects any other caller
  with `E_PERM`, answers `E_NO_LINK` if no NIC is bound, then hands the raw body to the NIC client and maps
  a send failure to `E_TX_BUSY` ([`src/server/handlers/send_frame.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/send_frame.rs#L24)).
- `OP_POLL_FRAME` is caller-gated the same way. On a NIC frame it runs the frame through the ingress
  observer, then, if the frame fits the reply buffer, copies it in and answers `E_OK`; an empty NIC returns
  `E_RX_EMPTY`, and any other NIC error returns `E_NO_LINK` ([`src/server/handlers/poll_frame.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/poll_frame.rs#L29),
  `poll_frame.rs:49`).
- `OP_ARP_RESOLVE` reads the 4-byte target and rejects a wrong length with `E_BAD_LEN`. On a cache hit it
  returns the six-byte MAC with `E_OK`. On a miss with no NIC it returns `E_NO_LINK`; on a miss with a NIC it
  notes the target pending, broadcasts an ARP request, and returns `E_NO_NEIGHBOUR` so the caller retries
  ([`src/server/handlers/arp_resolve.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/arp_resolve.rs#L29)).
- `OP_SET_IP` is caller-gated to `net.dhcp.client` alone; any other caller gets `E_PERM`. It reads the
  4-byte interface IPv4, rejects a wrong length with `E_BAD_LEN`, and stores the address so L2 can put a real
  sender IP into outbound ARP and answer ARP-for-host ([`src/server/handlers/set_ip.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_ip.rs#L26)).

## Caller authorization

The sensitive ops do not trust the opcode alone; they check who is calling. `authorized` looks up the owner
pid the service registry bound to a named service and compares it to the kernel-attested `sender_pid`; a
lookup miss or a pid of zero rejects ([`src/server/authz.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L23), `authz.rs:32`). `authorized_any` accepts a
match against any service in a list ([`src/server/authz.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L36)). `OP_SEND_FRAME` and `OP_POLL_FRAME` allow
`net.ip` or `net.dhcp.client`; `OP_SET_IP` allows `net.dhcp.client` only. Because the pid is attested by the
kernel, not carried in the request, a caller cannot forge its identity.

## The error set

All errnos ride in the response-header `flags` field ([`src/protocol/errno.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L20)):

```
  E_OK           0   success
  E_BAD_MAGIC    1   wrong protocol magic
  E_BAD_VERSION  2   wrong protocol version
  E_BAD_OP       3   unrecognised opcode
  E_BAD_LEN      4   short header, short payload, or a wrong fixed-length body
  E_NO_LINK      5   no NIC bound, or a NIC-side link error
  E_NO_NEIGHBOUR 6   ARP cache miss; a request was broadcast, retry
  E_TX_BUSY      7   the NIC refused or failed the transmit
  E_RX_EMPTY     8   the NIC had no frame to hand up
  E_PERM         9   the caller is not an authorized owner of a permitted service
```

`E_BAD_MAGIC`, `E_BAD_VERSION`, and `E_BAD_LEN` come out of the parser before any handler runs
([`src/protocol/decode.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L25)); the rest are handler decisions.

## The one-time NIC bind

Before the server loop starts, `setup::run` binds one NIC. `first_available` probes a fixed candidate list,
`driver.virtio_net0`, `driver.e1000_0`, `driver.rtl8169_0`, `driver.rtl8139_0`, in order, and takes the
first the kernel registry knows ([`src/setup/discover.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover.rs#L22), `discover.rs:36`). Adding a NIC class is one
line in that list; nothing upstream of L2 changes ([`src/setup/discover.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover.rs#L20)). The resolved port and pid go
into capsule state, and the NIC's MAC is read and stored ([`src/setup/mod.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L47)). A missing NIC or a failed
MAC read maps to a `SetupError` that keeps the retry loop running rather than serving a request
([`src/setup/mod.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L25), [`src/main.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L42)).

## The state the handlers read

`STATE` is a single static holding the NIC port and pid as atomics, the MAC, the interface IPv4, and the ARP
cache each under a mutex ([`src/state.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L29), [`src/state.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L58)). `set_nic` stores the port and pid with
release ordering and `nic_port` loads with acquire, so a handler on another turn sees a consistent bind
([`src/state.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L48)). The MAC is written once at setup, the IPv4 is written by `OP_SET_IP`, and the cache is
mutated by ARP resolve and by the ingress observer.

## Security posture at this boundary

The server is the only inbound surface, and it is defensive. It validates the header magic and version and
rejects a malformed frame without a reply ([`src/protocol/decode.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L20), [`src/server/runner.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L43)). The
parser bounds the payload slice to the declared length so a handler cannot over-read
([`src/protocol/decode.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L35)). The three write-capable ops, send frame, poll frame, and set IP, are gated on
a kernel-attested caller pid, not a claim in the request ([`src/server/authz.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L32)). Fixed-length ops check
their body length before use (`arp_resolve.rs:29`, `set_ip.rs:30`). There is no panic path: the crate is
`panic = "abort"` and every handler returns an errno instead of unwinding (`Cargo.toml:28`). A client that
wants link-layer service must hold the capability to reach `net.l2` and speak this protocol; it never gets a
handle to the NIC or to the hardware.

## Source map

```
  userland/capsule_net_l2/src/protocol/header.rs   MAGIC, VERSION, HDR_LEN, the Request struct
  userland/capsule_net_l2/src/protocol/decode.rs   parse: magic/version/length checks, field parse
  userland/capsule_net_l2/src/protocol/encode.rs   write_header: the response-header encoder
  userland/capsule_net_l2/src/protocol/ops.rs      the seven opcode constants
  userland/capsule_net_l2/src/protocol/errno.rs    E_OK and the nine wire errnos
  userland/capsule_net_l2/src/protocol/limits.rs   IPC_PAYLOAD_MAX and the MTU math
  userland/capsule_net_l2/src/server/runner.rs     the receive/parse/dispatch loop
  userland/capsule_net_l2/src/server/authz.rs      the owner-pid caller check
  userland/capsule_net_l2/src/server/respond/      respond and respond_status_only
  userland/capsule_net_l2/src/server/handlers/     one file per op
  userland/capsule_net_l2/src/setup/               first_available and the MAC read
  userland/capsule_net_l2/src/state.rs             the NIC port/pid, MAC, IPv4, and cache
  userland/capsule_net_l2/Cargo.toml               panic = "abort" and the binary name
  src/capabilities/types.rs                        the capability bits the mask decodes into
```

Every reference above is verified against those trees.
</content>
