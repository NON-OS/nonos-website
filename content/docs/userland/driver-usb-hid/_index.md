---
title: "The USB HID Driver Capsule"
description: "capsuledriverusbhid is the USB HID class driver in the NØNOS tree: a signed userland capsule that turns USB keyboard and mouse HID reports into InputEvents and posts them into t..."
weight: 400
---
`capsule_driver_usb_hid` is the USB HID class driver in the NØNOS tree: a signed userland capsule
that turns USB keyboard and mouse HID reports into `InputEvent`s and posts them into the kernel input
ring. It sits on top of the xHCI transport capsule (`driver.xhci0`), which owns the controller
mechanics; this capsule owns HID class parsing, boot-report normalization, and the input-post path.
Its source is organized into a small set of pillars, and this documentation mirrors that structure so
a page can be read beside the folder it describes.

## Identity

| Field | Value | Source |
|---|---|---|
| Slug | `driver-usb-hid` | `userland/capsule_driver_usb_hid/Capsule.mk:6` |
| Service handle | `driver.usb_hid0` | `Capsule.mk:7`, [`src/userspace/capsule_driver_usb_hid/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_driver_usb_hid/spawn.rs#L31) |
| Namespace | `systems.nonos.driver.usb_hid0` | `Capsule.mk:12` |
| Service endpoint | `service:4222:driver.usb_hid0` | `Capsule.mk:13`, `spawn.rs:32` |
| Reply endpoint | `reply:4223:endpoint.4294967314` | `Capsule.mk:14`, `spawn.rs:33`, `spawn.rs:34` |
| Binary name | `driver_usb_hid` | `Capsule.mk:10` |
| Capability mask | `0x200019` | `Capsule.mk:15`, `spawn.rs:51` |
| Kernel mirror | `src/userspace/capsule_driver_usb_hid` | `Capsule.mk:9` |

The mask `0x200019` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x000001  CoreExec      run as a process              1        types.rs:56
  0x000008  IPC           send/recv on its endpoints    8        types.rs:59
  0x000010  Memory        map its own heap and stack    16       types.rs:60
  0x200000  InputSource   post into the input ring      2097152  types.rs:77
  --------
  0x200019  = 1 + 8 + 16 + 2097152
```

The kernel spawn path requests exactly those four capabilities and no others, by name:
`Capability::CoreExec | IPC | Memory | InputSource`
([`src/userspace/capsule_driver_usb_hid/spawn.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_driver_usb_hid/spawn.rs#L51)). The one that matters is `InputSource`: it is
what lets this capsule post into the shared input ring. The gate is explicit.
`MkInputEventPost` is admitted only when the token satisfies `can_input_source`
([`src/syscall/contract/cap_table/mk.rs:78`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/mk.rs#L78)), and `can_input_source` grants only to a holder of
`InputSource`, `Irq`, or `Admin` ([`src/capabilities/token/types.rs:166`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/token/types.rs#L166)). This capsule holds
`InputSource` alone, so its authority to post input rests on that one bit.

There is no `Network` (4), no `FileSystem` (64), and, crucially, no `Driver` (65536), `DeviceEnum`
(32768), `Mmio` (131072), `Irq` (262144), `Dma` (524288), or `Pio` (1048576) bit in the mask
([`src/capabilities/types.rs:72`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L72)). The capsule cannot enumerate PCI devices, claim a controller
through the [hardware broker](/docs/subsystems/hardware-broker/claim/), map a register through
[MMIO](/docs/subsystems/hardware-broker/mmio/), bind an interrupt through
[IRQ](/docs/subsystems/hardware-broker/irq/), or allocate DMA. Every hardware effect it needs is an
IPC call to `driver.xhci0`, which holds those grants.

One correction. The capsule's own top-of-file `Capsule.mk` comment is accurate, but earlier prose in
the tree described the mask as `0x18` (`IPC | Memory`) and stated the capsule makes no input-post
call. That predates the input-post path. The shipping `Capsule.mk` and the kernel spawn mirror both
request `0x200019` including `InputSource`, and the code does post: `mk_input_event_post` is called
from [`src/hid/post_wire.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hid/post_wire.rs#L22). The `0x200019` mask, `InputSource`, and the post path are the shipping
truth; the `0x18`/no-post description is stale.

## The pillars

The source under `userland/capsule_driver_usb_hid/src/` has two faces that share one `State`. A live
driver face resolves the xHCI transport, enumerates HID devices over IPC, drains their interrupt IN
endpoints, and posts each parsed report into the kernel input ring. A request/reply service face
answers `driver.usb_hid0` for diagnostics and offline feeds. The report parsers and the input-post
path are shared by both.

```
  driver.xhci0  ->  orchestrator/  ->  hid/       ->  kernel input ring
  (transport)      discovery +        report parse    mk_input_event_post
                   poll loop          + input-post

  service caller ->  server/    ->  hid/    (same parsers, same post path)
  (driver.usb_hid0)  dispatch       feed
```

| Page | Mirrors | What it covers |
|---|---|---|
| [protocol.md](/docs/userland/driver-usb-hid/protocol/) | `src/protocol/`, `src/server/` | The `NUHI` service wire format, the seven ops, the dispatch, and the request handlers. |
| [enumeration.md](/docs/userland/driver-usb-hid/enumeration/) | `src/orchestrator/`, `src/descriptors/`, `src/xhci/` | Bring-up: the `driver.xhci0` client, port scan, slot and address, the config-descriptor walk and HID classification, boot-protocol binding, and the cooperative poll loop. |
| [input-post.md](/docs/userland/driver-usb-hid/input-post/) | `src/hid/` | Report normalization and the input-post path: the keyboard diff and keymap, the mouse and tablet parse, and the `post_key`/`post_mouse`/`post_wire` wire into `mk_input_event_post`. |
| [contributing.md](/docs/userland/driver-usb-hid/contributing/) | the whole tree | Where to work, adding an op or extending the parse, and the build and sign steps. |
| [debugging.md](/docs/userland/driver-usb-hid/debugging/) | runtime | The boot and input markers and the failure modes: device not enumerated, no input, wrong keycodes. |

## The operations

The service exposes seven operations, defined once in [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17) and dispatched by op
code in [`src/server/dispatch.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L22):

| Op | Code | Input | Output | Handler |
|---|---|---|---|---|
| `OP_HEALTHCHECK` | `0x0001` | empty | status word | `dispatch.rs:23`, [`handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/health.rs#L20) |
| `OP_PROBE_CONFIG` | `0x0002` | raw USB config descriptor (<= 512 B) | binding count then 8-byte records | `dispatch.rs:24`, [`handlers/probe_config.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/probe_config.rs#L24) |
| `OP_FEED_KEYBOARD_REPORT` | `0x0003` | 8-byte boot keyboard report | status word | `dispatch.rs:25`, [`handlers/feed_key.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/feed_key.rs#L21) |
| `OP_FEED_MOUSE_REPORT` | `0x0004` | 3 or 4-byte boot mouse report | status word | `dispatch.rs:26`, [`handlers/feed_mouse.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/feed_mouse.rs#L21) |
| `OP_POLL_KEYS` | `0x0005` | empty | count then 8-byte key events (<= 16) | `dispatch.rs:27`, [`handlers/poll_keys.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/poll_keys.rs#L21) |
| `OP_POLL_MOUSE` | `0x0006` | empty | count then 8-byte mouse events (<= 16) | `dispatch.rs:28`, [`handlers/poll_mouse.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/poll_mouse.rs#L21) |
| `OP_GET_STATE` | `0x0007` | empty | 48-byte counter block | `dispatch.rs:29`, [`handlers/get_state.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/get_state.rs#L21) |

These ops are a diagnostic and offline-feed surface. The event stream that reaches the desktop does
not go through `OP_POLL_KEYS` or `OP_POLL_MOUSE`; it goes through the input-post path, which is a
syscall (`mk_input_event_post`), not an IPC reply. The [protocol](/docs/userland/driver-usb-hid/protocol/) page covers the ops in
detail and the [input-post](/docs/userland/driver-usb-hid/input-post/) page covers the post path.

## Lifecycle

The driver is spawned through verified spawn: its signature, `nonos-id` cert, manifest, and
attestation trailer are checked against the baked trust anchor, its four requested capabilities are
held against its manifest ceiling, and only then is its ELF mapped
([`src/userspace/capsule_driver_usb_hid/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_driver_usb_hid/spawn.rs#L37)). `_start` initializes the heap and calls
`orchestrator::run`, which never returns ([`src/main.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L33)). That loop blocks until `driver.xhci0` is
resolvable, enumerates once, then enters the cooperative poll loop that services one request and
drains every bound endpoint each iteration. The first time any HID endpoint binds, the loop emits the
debug marker `[USB-HID-ENUM] tablet bound` exactly once ([`src/orchestrator/poll/run.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/orchestrator/poll/run.rs#L36)); the
[debugging](/docs/userland/driver-usb-hid/debugging/) page covers what that marker and the kernel-side input markers mean.

## Source map

Everything here is drawn from `userland/capsule_driver_usb_hid/` (the capsule source and its
`Capsule.mk`), `src/capabilities/` (the capability bits and the `can_input_source` gate),
[`src/syscall/contract/cap_table/mk.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/mk.rs) (the per-syscall gate), and the kernel spawn mirror under
`src/userspace/capsule_driver_usb_hid/`. Every reference above is verified against those trees.
