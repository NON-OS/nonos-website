---
title: "Client and protocol: the NVGP wire format and the twelve ops"
description: "This page mirrors the wire layer of the capsule: src/protocol/ is the NVGP frame format, and src/server/ is the receive loop, the dispatcher, and the twelve handlers that turn a..."
weight: 3
---
This page mirrors the wire layer of the capsule: `src/protocol/` is the `NVGP` frame format, and
`src/server/` is the receive loop, the dispatcher, and the twelve handlers that turn a request into an
engine call and a reply. This is the surface the compositor talks to. For identity and the capability mask
see the [README](/docs/userland/driver-virtio-gpu/); for the virtqueue and control commands the command ops drive, see the
[engine](/docs/userland/driver-virtio-gpu/engine/) page; the compositor's side of this protocol is documented in the
[compositor gpu-client reference](/docs/userland/compositor/gpu-client/).

## The NVGP frame

`NVGP` is magic `0x4E56_4750`, version `1`, a 20-byte header, little-endian throughout
([`src/protocol/header.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L16)). The header is `magic(4) | version(2) | op(2) | flags(2) | reserved(2) |
request_id(4) | payload_len(4)`. `parse` rejects any frame shorter than the header, any wrong magic or
version, and any frame whose declared `payload_len` does not exactly match the remaining buffer, returning
the parsed `Request` and a borrowed body slice ([`src/protocol/decode.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L17), `:31`). Every reply repeats
the header, then a 4-byte signed status word, then an optional body: a status-only reply is `HDR(20) |
status(4)`, and a payload reply is `HDR(20) | status(4) | body` with status 0 ([`src/server/respond.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L20),
`:26`).

Errors are POSIX-style negative ints in the status word ([`src/protocol/errno.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L16)): `E_INVAL -22`,
`E_NOMEM -12`, `E_BUSY -16`, `E_BAD_OP -38`, `E_DEVICE -110`.

## The receive loop and dispatch

The server allocates two `HDR_LEN + IPC_PAYLOAD_MAX` = 276-byte buffers and enters `loop_once`
([`src/server/runner/entry.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/entry.rs#L23), [`src/protocol/limits.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L16)). Each turn receives on the service inbox
with `mk_ipc_recv_from`, drops an empty frame or a zero sender pid, parses the header, and dispatches;
anything that fails to parse is silently skipped rather than answered ([`src/server/runner/loop_once.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/loop_once.rs#L25)).

The dispatcher matches on the opcode ([`src/server/runner/dispatch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/dispatch.rs#L26)). The seven read-only and
empty-body ops are gated behind `if body.is_empty()`, so a read-only op that arrives with a stray body
falls through. The five command ops that carry a fixed body are matched unconditionally and validate their
own length. An unknown op is answered `E_BAD_OP` if its body was empty and `E_INVAL` if it carried a body
([`src/server/runner/dispatch.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/dispatch.rs#L53)). Every reply goes back to the sender pid through `mk_ipc_reply`, never
to a fixed reply port ([`src/server/respond.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L23)).

## The twelve ops

The opcodes are defined in [`src/protocol/ops.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L16) and each has one handler file under
`src/server/handlers/`.

### Read-only state ops (empty request body)

| Op | Code | Reply body | Contents | Source |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | `0x0001` | none | status 0 | `ops.rs:16`, [`handlers/health.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/health.rs) |
| `OP_CONTROLLER_INFO` | `0x0002` | 40 bytes | device_id(8), claim_epoch(8), pci_device(2), queue_size(2), host_features(4), mmio_grant(8), irq_grant(8) | `ops.rs:17`, [`handlers/controller.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/controller.rs), `limits.rs:18` |
| `OP_DISPLAY_INFO` | `0x0003` | 12 bytes | events_read(4), num_scanouts(4), num_capsets(4), read live from device config | `ops.rs:18`, [`handlers/display.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/display.rs), `driver.rs:49` |
| `OP_CONTROLQ_STATE` | `0x0004` | 24 bytes | queue_grant(8), queue_user_va(8), queue_device_addr(8) | `ops.rs:19`, [`handlers/controlq.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/controlq.rs), `limits.rs:20` |
| `OP_QUERY_CAPS` | `0x0005` | 12 bytes | num_scanouts(4), num_capsets(4), events_read(4) | `ops.rs:20`, [`handlers/query_caps.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/query_caps.rs), `limits.rs:26` |
| `OP_MODE_LIST` | `0x000B` | 32 bytes per scanout | id(4), enabled(4), width(4), height(4), x(4), y(4), current_resource_id(4), pad(4); one entry per recorded scanout, bounded by the reply buffer | `ops.rs:26`, [`handlers/mode_list.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/mode_list.rs), `limits.rs:27` |

`OP_DISPLAY_INFO` and `OP_QUERY_CAPS` both re-read the device config MMIO at call time through
`Driver::config` ([`src/driver.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/driver.rs#L40)); they differ only in field order. `OP_MODE_LIST` reports the driver's
own recorded scanout table and refuses to write past the reply buffer even if more scanouts exist than fit
([`handlers/mode_list.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/mode_list.rs)).

### Command ops

`OP_GET_PRIMARY_SURFACE` takes an empty body; the five that follow carry a fixed-length body and post a real
virtio-gpu control command onto the device.

| Op | Code | Request body | Reply | Errors | Source |
|---|---|---|---|---|---|
| `OP_GET_PRIMARY_SURFACE` | `0x000C` | none | 32 bytes: handle(8), resource_id(4), width(4), height(4), stride(4), format(4), pad(4) | `E_DEVICE` if no primary, `E_BUSY` if owned by another pid | `ops.rs:27`, [`handlers/get_primary_surface.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/get_primary_surface.rs#L22) |
| `OP_CREATE_RESOURCE` | `0x0006` | 16 bytes: requested_id(4), format(4), width(4), height(4) | 4 bytes: resource_id | `E_INVAL` on bad length/zero dims/wrong format, `E_DEVICE` on device reject, `E_NOMEM` if the table is full | `ops.rs:21`, [`handlers/create_resource.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/create_resource.rs#L24) |
| `OP_ATTACH_BACKING` | `0x0007` | 24 bytes: resource_id(4), pad(4), backing_addr(8), backing_len(8) | status only | `E_INVAL` on bad args, unknown resource, or out-of-region backing, `E_BUSY` if not the owner, `E_DEVICE` on device reject | `ops.rs:22`, [`handlers/attach_backing.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/attach_backing.rs#L20) |
| `OP_TRANSFER_TO_HOST` | `0x0008` | 32 bytes: resource_id(4), x(4), y(4), width(4), height(4), pad(4), offset(8) | status only | `E_INVAL` on bad rect or unknown resource, `E_BUSY` if not the owner, `E_DEVICE` on device reject | `ops.rs:23`, [`handlers/transfer_to_host.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/transfer_to_host.rs#L24) |
| `OP_SET_SCANOUT` | `0x0009` | 24 bytes: scanout_id(4), resource_id(4), x(4), y(4), width(4), height(4) | status only | `E_INVAL` on bad args or unknown resource, `E_BUSY` if not the owner, `E_DEVICE` on device reject | `ops.rs:24`, [`handlers/set_scanout.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/set_scanout.rs) |
| `OP_FLUSH` | `0x000A` | 20 bytes: resource_id(4), x(4), y(4), width(4), height(4) | status only | `E_INVAL` on bad rect or unknown resource, `E_BUSY` if not the owner, `E_DEVICE` on device reject | `ops.rs:25`, [`handlers/flush.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/flush.rs#L20) |

These are the exact opcodes the compositor's gfx client uses: `GET_PRIMARY_SURFACE` (`0x000C`) once at
setup, then per frame `TRANSFER_TO_HOST` (`0x0008`), `SET_SCANOUT` (`0x0009`) on the first frame only, and
`FLUSH` (`0x000A`) (`docs/userland/compositor/gpu-client.md:66`). The opcodes line up byte for byte.

## The two invariants

Two rules govern every command op, and they are the whole client-isolation and bounds story.

Ownership. `GET_PRIMARY_SURFACE` claims the primary resource: if its `owner_pid` is still 0 the first
caller becomes the owner, and thereafter the handler returns `E_BUSY` to any pid that is not the owner
([`handlers/get_primary_surface.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/get_primary_surface.rs#L27), `:39`). Every subsequent command op re-checks `owner_pid ==
sender_pid` after its length and resource-lookup checks and returns `E_BUSY` to anyone else
([`handlers/transfer_to_host.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/transfer_to_host.rs#L33), [`handlers/flush.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/flush.rs#L49)). A second capsule cannot transfer, scanout, or
flush a resource it does not own.

Bounds. Every rect is validated against the resource's own width and height with saturating arithmetic
before the device command is issued, so a client cannot ask the device to read outside the resource: a
zero-area rect or one whose `x + width` or `y + height` exceeds the resource is `E_INVAL`
([`handlers/transfer_to_host.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/transfer_to_host.rs#L37), [`handlers/flush.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/flush.rs#L53)). `CREATE_RESOURCE` additionally refuses any
format other than `VG_FORMAT_B8G8R8A8_UNORM` ([`handlers/create_resource.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/create_resource.rs#L45)). `ATTACH_BACKING` is the one
place a client-supplied physical address reaches a device command, and it is bounded first: the requested
address range must lie entirely inside the primary surface's own broker-granted DMA region, checked with
`checked_add` overflow guards, or the handler rejects it `E_INVAL` before touching the device
([`handlers/attach_backing.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/attach_backing.rs#L49), `:72`). The driver cannot be made to hand the device an arbitrary guest
address over IPC.

## Source map

```
  src/protocol/header.rs                   MAGIC, VERSION, HDR_LEN, the Request struct
  src/protocol/decode.rs                   parse: magic/version check and exact payload-length match
  src/protocol/limits.rs                   IPC_PAYLOAD_MAX and the per-op fixed request/response lengths
  src/protocol/errno.rs                    E_INVAL, E_NOMEM, E_BUSY, E_BAD_OP, E_DEVICE
  src/protocol/ops.rs                      the twelve opcode constants
  src/server/runner/entry.rs               the 276-byte rx/tx buffers
  src/server/runner/loop_once.rs           mk_ipc_recv_from, empty/zero-pid drop, parse, dispatch
  src/server/runner/dispatch.rs            the opcode match, the empty-body gate, E_BAD_OP/E_INVAL fallthrough
  src/server/respond.rs                    status-only and payload replies via mk_ipc_reply to the sender pid
  src/server/handlers/                     one file per op: the read-only reads and the command-op validation
  docs/userland/compositor/gpu-client.md   the compositor client that drives these ops
```

Every reference above is verified against those trees.
