---
title: "The PS/2 Input Driver Capsule"
description: "capsuledriverps2input is the userland owner of the legacy i8042 PS/2 controller."
weight: 400
---
`capsule_driver_ps2_input` is the userland owner of the legacy i8042 PS/2 controller. It drives the
keyboard on IRQ1 and the AUX mouse on IRQ12 from a single CPL 3 capsule, because both devices share the
data and command ports at `0x60` and `0x64` and one controller must have one owner. It reaches those
ports only through the hardware broker's port-IO grant, decodes Scan Code Set 1 and the 3-byte mouse
packet into kernel input events, and exposes bounded event rings and diagnostics over its IPC service.
Its source is organized into three pillars, and this documentation mirrors that structure one page per
pillar so a page can be read beside the folder it describes. The system-wide input path is in
[../../subsystems/input/path.md](/docs/subsystems/input/path/).

## Identity

Everything the kernel and the service registry need to name and reach the driver comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `driver-ps2-input` | `userland/capsule_driver_ps2_input/Capsule.mk:6` |
| Service handle | `driver.ps2_kbd0` | `Capsule.mk:7`, [`src/hardware/ps2_kbd_capsule/spawn.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/ps2_kbd_capsule/spawn.rs#L32) |
| Binary name | `driver_ps2_input` | `Capsule.mk:10` |
| Namespace | `systems.nonos.driver.ps2_kbd0` | `Capsule.mk:12` |
| Service endpoint | `service:4208:driver.ps2_kbd0` | `Capsule.mk:13`, `spawn.rs:33` |
| Reply endpoint | `reply:4209:endpoint.4294967306` | `Capsule.mk:14`, `spawn.rs:34` |
| Capability mask | `0x358019` | `Capsule.mk:17` |
| Kernel mirror | `src/hardware/ps2_kbd_capsule` | `Capsule.mk:18` |

The service name stays `driver.ps2_kbd0` for callers written before the mouse existed, even though the
endpoint now serves both keyboard and mouse. The mask `0x358019` decomposes bit by bit against
[`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs), and the `Capsule.mk` comment spells the same sum out
(`Capsule.mk:15`):

| Bit | Value | Capability | Grants | Source |
|-----|-------|------------|--------|--------|
| `0x000001` | 1 | CoreExec | run as a process | `types.rs:56` |
| `0x000008` | 8 | IPC | send and receive on its endpoints | `types.rs:59` |
| `0x000010` | 16 | Memory | map its own heap and stack | `types.rs:60` |
| `0x008000` | 32768 | DeviceEnum | list the platform records | `types.rs:71` |
| `0x010000` | 65536 | Driver | claim and release a device | `types.rs:72` |
| `0x040000` | 262144 | Irq | bind and acknowledge IRQ1 and IRQ12 | `types.rs:74` |
| `0x100000` | 1048576 | Pio | mint the i8042 port-IO grant | `types.rs:76` |
| `0x200000` | 2097152 | InputSource | post decoded events into the kernel input ring | `types.rs:77` |

```
  0x358019 = 1 + 8 + 16 + 32768 + 65536 + 262144 + 1048576 + 2097152
```

The kernel spawn path requests exactly those eight capabilities and no others
([`src/hardware/ps2_kbd_capsule/spawn.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/ps2_kbd_capsule/spawn.rs#L51)). There is no `Mmio` bit (`0x20000`, `types.rs:73`) and no
`Dma` bit (`0x80000`, `types.rs:75`), so the capsule cannot map a device BAR into its address space or
receive a DMA buffer; its only hardware reach is the i8042 port window through kernel-mediated `in`/`out`.
There is no FileSystem, Network, Admin, or Debug authority in the mask, which is the basis of the
security analysis on the [bring-up](/docs/userland/driver-ps2-input/bring-up/) page. `Pio` is the distinguishing bit: this is the only
driver in the verified set that holds it, and only for the 8042's two ports (`Capsule.mk:1`,
[../../subsystems/hardware-broker/pio.md](/docs/subsystems/hardware-broker/pio/)).

## The three pillars

The source under `userland/capsule_driver_ps2_input/src/` decomposes into a data plane and a bring-up
plane. A raw byte comes off the controller in `poll/`, is decoded by `keymap/` or `mouse/` into a kernel
input event, and is also parked on a bounded ring behind `protocol/` for the diagnostic poll path. None
of that runs until `setup/` and `init/` have claimed the device and brought the controller up.

```
  setup/ + init/   ->   poll/   ->   keymap/ | mouse/   ->   mk_input_event_post
  claim, grant,         drain a       decode a byte           the live path into
  bring the             byte from     into a keycode          the input router
  controller up         the ports     or a mouse event
                                            |
                                            v
                                       ring/ + mouse ring  ->  protocol/ ops
                                       bounded diagnostics     the IPC service
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [protocol.md](/docs/userland/driver-ps2-input/protocol/) | `src/protocol/`, `src/ring/`, [`src/mouse/ring.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/ring.rs) | The `NKBD` wire header, the five ops, the reply records, the reply endpoint, and the two bounded rings with their opposite drop disciplines. |
| [bring-up.md](/docs/userland/driver-ps2-input/bring-up/) | `src/setup/`, `src/init/`, [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs), `src/constants/` | Discovery over ACPI records, the PIO and IRQ grants and their rollback, the i8042 config-byte sequence and its flush fix, and the interrupt pump with its double drain. |
| [decode.md](/docs/userland/driver-ps2-input/decode/) | `src/poll/`, `src/keymap/`, `src/mouse/` | The per-byte drain, the Set 1 scancode tables and modifier tracking, the 3-byte mouse packet assembler, and the two input-post paths into the kernel ring. |
| [contributing.md](/docs/userland/driver-ps2-input/contributing/) | the whole tree | Where to work, how to extend the keymap or add an op, the build and sign steps, and the code standards the CI enforces. |
| [debugging.md](/docs/userland/driver-ps2-input/debugging/) | runtime | The boot marker, the diagnostic counters, and where to look for a dead keyboard, a missing mouse, stuck keys, or a desyncing pointer. |

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initialises the heap, then loops calling `setup::run` until
the broker bring-up succeeds, yielding 64 times between attempts, and finally hands the resulting
`Driver` to the server loop ([`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31)). `setup::run` discovers and claims the i8042 platform
records, mints the PIO grant, binds IRQ1 and IRQ12, brings the controller up, and returns the grant ids
and a mouse-enabled flag ([`src/setup/sequence.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L26)).

Once running, the server does two things in one loop ([`src/server/runner.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L49)). It drains the
controller's output buffer into two bounded rings, translating each byte as it arrives and posting a
kernel input event as it decodes it; and it answers IPC requests on the driver endpoint with liveness,
drained events, diagnostic counters, or a controller snapshot. The IPC event rings and the kernel input
ring are two separate delivery paths from the same decoded stream: the rings are pollable diagnostics,
and the input post is the live path into the window system.

The capsule is spawned through verified spawn: its signature and attestation are checked against the
baked trust anchor, its requested capabilities are held against its manifest, and only then is its ELF
mapped ([`src/hardware/ps2_kbd_capsule/spawn.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/ps2_kbd_capsule/spawn.rs#L39)). On a successful bring-up it prints
`[driver_ps2] endpoint driver.ps2_kbd0 ready` through `mk_debug` ([`src/setup/sequence.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L43)); the
[debugging](/docs/userland/driver-ps2-input/debugging/) page covers what that marker and its absence mean.

## Source map

```
  userland/capsule_driver_ps2_input/src/main.rs   _start: heap init, retry setup, run server
  userland/capsule_driver_ps2_input/src/setup/    the ordered bring-up and its rollbacks
  userland/capsule_driver_ps2_input/src/init/     the i8042 keyboard and mouse enable sequences
  userland/capsule_driver_ps2_input/src/discover.rs   find_ps2_kbd / find_ps2_aux over ACPI records
  userland/capsule_driver_ps2_input/src/constants/    ports, status bits, PnP ids, ring capacity
  userland/capsule_driver_ps2_input/src/poll/     the per-byte drain and the scancode absorber
  userland/capsule_driver_ps2_input/src/keymap/   the Set 1 tables, translate, modifier tracking, post
  userland/capsule_driver_ps2_input/src/mouse/    the 3-byte packet parser, ring, and input post
  userland/capsule_driver_ps2_input/src/ring/     the bounded keyboard event ring and counters
  userland/capsule_driver_ps2_input/src/protocol/ the NKBD header, ops, limits, encode/decode, endpoint
  userland/capsule_driver_ps2_input/src/server/   the recv/dispatch loop, the pump, and the handlers
  userland/capsule_driver_ps2_input/Capsule.mk    slug, handle, ports, capability mask, kernel mirror
  src/capabilities/types.rs                       the capability bit values
  src/hardware/ps2_kbd_capsule/                   the kernel-side embed and verified spawn
```

Every reference above is verified against those trees.
