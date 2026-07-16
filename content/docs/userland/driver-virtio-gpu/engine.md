---
title: "Engine: the virtqueue, the control commands, and the runtime tables"
description: "This page mirrors the machinery the handlers stand on: src/device/ is the split virtqueue and the six virtio-gpu control commands, src/regs/ is the register accessor, src/state/..."
weight: 2
---
This page mirrors the machinery the handlers stand on: `src/device/` is the split virtqueue and the six
virtio-gpu control commands, `src/regs/` is the register accessor, `src/state/` holds the resource,
scanout, and fence tables, and [`src/driver.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/driver.rs) is the struct that ties them together. The
[bring-up](/docs/userland/driver-virtio-gpu/bring-up/) page builds all of this; the [client/protocol](/docs/userland/driver-virtio-gpu/client-protocol/) page calls into
it. For identity and the capability mask see the [README](/docs/userland/driver-virtio-gpu/).

## The Driver struct

`Driver` is the single owned value the setup path returns and the server loop borrows for every request. It
carries the grant ids (mmio, irq, queue), the queue addresses and negotiated size, the host feature word,
the register accessor, the live `ControlQueue`, the three runtime tables, and the `Option<Primary>` for the
primary surface ([`src/driver.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/driver.rs#L21)). Its `config()` re-reads the three device config words
(`GPU_CFG_EVENTS_READ 0x14`, `GPU_CFG_NUM_SCANOUTS 0x1C`, `GPU_CFG_NUM_CAPSETS 0x20`) straight from MMIO,
and `display_info()` is an alias of it ([`src/driver.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/driver.rs#L40), `:49`, [`src/constants/mod.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L34)). That is why
the `DISPLAY_INFO` and `QUERY_CAPS` ops report live device state rather than a cached copy.

## The split virtqueue

The control queue is a standard split virtqueue driven synchronously over broker-owned DMA. It lives in the
16 KiB queue region at fixed offsets: the descriptor table at 0, the available ring at 4096, the used ring
at 8192, and a 4 KiB staging area at 12288 ([`src/constants/mod.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L22)). `QueueLayout` computes the virtual
and device addresses of each region from the queue's base and size ([`src/device/virtqueue/layout.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/virtqueue/layout.rs)), and
`ControlQueue` wraps that layout with the register accessor ([`src/device/virtqueue/control_queue.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/virtqueue/control_queue.rs#L18)).

`submit_sync` is the whole transaction ([`src/device/virtqueue/submit.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/virtqueue/submit.rs#L23)):

1. Reject an empty request or response, and reject a request plus response that overflows the staging area
   ([`src/device/virtqueue/submit.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/virtqueue/submit.rs#L30)).
2. Write the request bytes into staging, then zero the response tail behind it
   ([`src/device/virtqueue/submit.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/virtqueue/submit.rs#L38)).
3. Read the current used index, take the available head modulo the queue size, and build a two-descriptor
   chain: a read segment with `VRING_DESC_F_NEXT` and a device-writable response segment with
   `VRING_DESC_F_WRITE` ([`src/device/virtqueue/desc.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/virtqueue/desc.rs), [`src/constants/mod.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L57)).
4. Publish the head in the available ring, notify the device on queue index 0, and wait for the used ring
   to advance ([`src/device/virtqueue/avail.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/virtqueue/avail.rs), [`src/device/virtqueue/wait.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/virtqueue/wait.rs),
   [`src/device/virtqueue/submit.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/virtqueue/submit.rs#L52)).
5. Verify the used entry's id matches the head, rejecting a mismatch with `virtio-gpu: used id mismatch`,
   and return the used length ([`src/device/virtqueue/submit.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/virtqueue/submit.rs#L57)).

The response is read back out of staging with `read_response`, byte by byte from just past the request
([`src/device/virtqueue/control_queue.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/virtqueue/control_queue.rs#L34), [`src/device/virtqueue/submit.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/virtqueue/submit.rs#L62)). The queue is driven
synchronously: every command submits, waits, and reads its own response before returning, so there is no
in-flight concurrency to reason about.

## The register accessor

`src/regs/` is the volatile MMIO/PIO accessor the negotiation and the notify path use. `Regs` exposes
width-typed reads and writes (`r8`/`w8` through `r64`/`w64`), a `config_r32` for the device config window,
and a `notify` that kicks the queue ([`src/regs/read.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/read.rs), [`src/regs/write.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/write.rs), [`src/regs/notify.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/notify.rs)). It
carries a per-path state so the same interface serves both the modern MMIO layout and the legacy PIO layout
(`src/regs/state/`), and `with_queue_notify` folds in the modern notify offset the negotiation reads from
the queue ([`src/regs/state/with_queue_notify.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/state/with_queue_notify.rs)). Every access is `unsafe` volatile against a broker-mapped
region; nothing here touches memory the broker did not grant.

## The six control commands

Each file under `src/device/cmd/` builds one virtio-gpu control command, submits it, and checks the
response type. Every command starts with a 24-byte control header (`type, flags, fence_id, ctx_id`), written
by `Hdr::write` and parsed back by `Hdr::parse` ([`src/device/cmd/hdr.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/cmd/hdr.rs#L16), `:29`, `:36`). The type
constants are in [`src/constants/mod.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L60).

| Command | Type | Response accepted | Source |
|---|---|---|---|
| `get_display_info` | `0x0100` | `RESP_OK_DISPLAY_INFO 0x1101` | [`cmd/get_display_info.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/cmd/get_display_info.rs#L45), [`constants/mod.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/constants/mod.rs#L60), `:67` |
| `create_resource_2d` | `0x0101` | `RESP_OK_NODATA 0x1100` | [`cmd/create_resource_2d.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/cmd/create_resource_2d.rs#L42), [`constants/mod.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/constants/mod.rs#L61) |
| `set_scanout` | `0x0103` | `RESP_OK_NODATA 0x1100` | [`cmd/set_scanout.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/cmd/set_scanout.rs#L44), [`constants/mod.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/constants/mod.rs#L62) |
| `resource_flush` | `0x0104` | `RESP_OK_NODATA 0x1100` | [`cmd/flush.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/cmd/flush.rs), [`constants/mod.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/constants/mod.rs#L63) |
| `transfer_to_host_2d` | `0x0105` | `RESP_OK_NODATA 0x1100` | [`cmd/transfer_to_host_2d.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/cmd/transfer_to_host_2d.rs), [`constants/mod.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/constants/mod.rs#L64) |
| `attach_backing` | `0x0106` | `RESP_OK_NODATA 0x1100` | [`cmd/attach_backing.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/cmd/attach_backing.rs), [`constants/mod.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/constants/mod.rs#L65) |

`create_resource_2d` rejects a zero id or zero dimension before it touches the queue
([`src/device/cmd/create_resource_2d.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/cmd/create_resource_2d.rs#L29)) and returns `virtio-gpu: create_resource_2d rejected` if the
device does not answer `RESP_OK_NODATA` (`:42`). `set_scanout` rejects a scanout id past `VG_MAX_SCANOUTS`
or a zero-area rect and lays out its body as `rect(16), scanout_id(4), resource_id(4)` before the fixed
header ([`src/device/cmd/set_scanout.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/cmd/set_scanout.rs#L29), `:33`). `get_display_info` is the only command that decodes a
body: it reads up to `VG_MAX_SCANOUTS` per-scanout entries out of the response ([`src/device/cmd/get_display_info.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/cmd/get_display_info.rs#L45)).
These six are the entire device-facing vocabulary. There is no VirGL context command, no 3D submit, and no
capset transfer anywhere under `cmd/`.

## The runtime tables

Three tables in `src/state/` hold everything the handlers mutate, all built with interior `Cell` mutability
so the borrowed `&Driver` can update them without a lock:

- The resource table is a fixed array of `MAX_RESOURCES` slots. `alloc_id` hands out monotonically
  increasing ids that skip 0, `insert` takes the first free slot or fails, `lookup` finds an in-use slot by
  id, and `update` mutates a slot in place; a full table is a real failure the create handler surfaces as
  `E_NOMEM` ([`src/state/resources/table.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/resources/table.rs#L41), `:46`, `:55`, `:64`). Each `Resource` carries its id, owner
  pid, geometry, format, and backing range ([`src/state/resources/resource.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/resources/resource.rs)).
- The scanout table is a fixed array of `VG_MAX_SCANOUTS` (16) slots indexed by scanout id, seeded at
  bring-up and read by the mode-list op ([`src/state/scanouts.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/scanouts.rs#L27), `:42`, `:50`).
- The fence counter issues a monotonic fence id per command, stamped into every control header
  ([`src/state/fences.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/fences.rs)).

The `owner_pid` field is the isolation primitive: the [client/protocol](/docs/userland/driver-virtio-gpu/client-protocol/) layer sets it
on the first `GET_PRIMARY_SURFACE` caller and checks it on every subsequent command op. The engine itself
enforces no policy; it faithfully carries whatever the handlers write and rejects only what the device
rejects.

## Source map

```
  src/driver.rs                            the Driver struct: grants, queue addrs, live config reads
  src/device/virtqueue/layout.rs           the 16 KiB queue region and its fixed sub-offsets
  src/device/virtqueue/control_queue.rs    submit + read_response over the layout and regs
  src/device/virtqueue/submit.rs           submit_sync: staging, two-descriptor chain, notify, wait, used check
  src/device/virtqueue/{desc,avail,used,wait}.rs   the descriptor chain and ring bookkeeping
  src/device/cmd/hdr.rs                     the 24-byte control header
  src/device/cmd/                           the six control commands and their response-type checks
  src/regs/                                 the volatile MMIO/PIO accessor, config reads, and queue notify
  src/state/resources/                      the resource table: alloc_id, insert, lookup, update, owner_pid
  src/state/scanouts.rs                     the 16-slot scanout table
  src/state/fences.rs                       the monotonic fence counter
  src/constants/mod.rs                      queue offsets, descriptor flags, control-command and response types
```

Every reference above is verified against those trees.
