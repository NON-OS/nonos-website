---
title: "The Settings Capsule"
description: "Settings is the system control panel for NØNOS: a signed userland capsule that draws its own window, reads the keyboard and pointer, and edits the machine's policy store through..."
weight: 400
---
Settings is the system control panel for NØNOS: a signed userland capsule that draws its own window,
reads the keyboard and pointer, and edits the machine's policy store through capability-checked IPC. It
presents three tabs of controls (Display, Network, Security), and every row is a live field backed by the
`policy` service. Settings holds no policy of its own; it is a viewer and editor for the store, and the
store, not the capsule, decides whether any write is allowed. Its source is organized into a small set of
pillars, and this documentation mirrors that structure one page per pillar so a page can be read beside
the folder it describes.

## Identity

| Field | Value | Source |
|-------|-------|--------|
| Slug | `settings` | `userland/capsule_settings/Capsule.mk:1` |
| Service handle | `app.settings` | `Capsule.mk:2` |
| Namespace | `systems.nonos.app.settings` | `Capsule.mk:7` |
| Service endpoint | `service:4728:app.settings` | `Capsule.mk:8` |
| Reply endpoint | `reply:4729:endpoint.app.settings.reply` | `Capsule.mk:9` |
| Capability mask | `0x1819` | `Capsule.mk:11` |
| Binary name | `settings` | `Capsule.mk:5` |
| Kernel mirror | `src/userspace/capsule_settings` | `Capsule.mk:12` |

The mask decomposes into five bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|-----|-------|--------|
| CoreExec | `0x0001` | run as a process |
| IPC | `0x0008` | send and receive on its endpoints |
| Memory | `0x0010` | map its own heap and stack |
| GraphicsDisplayQuery | `0x0800` | ask the compositor for the display geometry |
| GraphicsSurfaceCreate | `0x1000` | create the window surface it draws into |

So `0x1819 = 0x0001 + 0x0008 + 0x0010 + 0x0800 + 0x1000`. The kernel spawn path requests exactly those
five capabilities and no others ([`src/userspace/capsule_settings/spawn.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_settings/spawn.rs#L49)). There is no Network bit
(`0x0004`), no FileSystem bit (`0x0040`), and no hardware, driver, MMIO, or DMA capability. Settings can
create a surface, ask the display for its size, and speak IPC, and nothing else. Its power to change
system policy is not a capability it holds; it comes entirely from the policy service recognising its
service name, which is the whole basis of the [policy client and write gate](/docs/userland/settings/policy/) page.

## The pillars

The source under `userland/capsule_settings/src/settings/` is a set of modules declared in
[`src/settings/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/mod.rs#L17), and the documentation is one page each. A key or click comes in through
`event`, which reads and mutates the `state` model and, on a change, sends a write through `ipc` to the
policy service; `paint` turns the current `state` into pixels. The `schema` module is the shared spine:
it lists the fields and assigns each to a tab.

```
  event/   ->   ipc/   ->   policy service
  input        the        (owns the store,
  handling     client      gates the write)
    |            |
    v            v
  state/  <->  schema/   ->   paint/
  the model    fields+tabs    the frame
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [panels.md](/docs/userland/settings/panels/) | `src/settings/schema/`, `src/settings/state/` | The three tabs and every control: field, kind, range, and what each row writes; the field list, the tab grouping, and the in-memory model behind the rows. |
| [policy.md](/docs/userland/settings/policy/) | `src/settings/ipc/` | The policy client: service lookup, the read burst, the four `OP_SET` writers, the framed `call`, the trusted-setter gate on the server, and the best-effort shell toast. |
| [rendering.md](/docs/userland/settings/rendering/) | `src/settings/paint/` | How a frame is produced: clear, header, tabs, the visible rows, per-kind value rendering, the scroll indicator, and the status bar. |
| [input.md](/docs/userland/settings/input/) | `src/settings/event/` | Every keybinding and pointer action, the browsing and editing split, the adjust and toggle paths, the string editor filter, and the status messages. |
| [contributing.md](/docs/userland/settings/contributing/) | the whole tree | Where to work, how to add a setting, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/settings/debugging/) | runtime | The boot marker, the failure modes, and where to look when hydration, a write, or the display misbehaves. |

The Wi-Fi auto-connect row lives on the Network tab and is documented with the other controls in
[panels.md](/docs/userland/settings/panels/), but it is a single policy boolean and nothing more. The scanning, association, and
credential handling belong to the network capsule; for how a Wi-Fi link is brought up, see the
[networking subsystem](https://github.com/NON-OS/nonos-micro-kernel/blob/main/subsystems/networking/README.md).

## Lifecycle

Settings is spawned through [verified spawn](https://github.com/NON-OS/nonos-micro-kernel/blob/main/security/capsules-and-trust.md): its signature and
attestation are checked, its requested capabilities are held against its manifest ceiling, and only then
is its ELF mapped and `app.settings` registered on port 4728. A successful spawn prints `[APP-SETTINGS]
capsule spawned` on the boot log ([`src/userspace/init/spawn_plan/boot.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/boot.rs#L26)).

1. `_start` hands `Settings::new` to the app-skeleton's `run`, which owns the surface, window, input
   subscription, and paint loop ([`src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L28)).
2. `Settings::new` looks up the `policy` service and, if found, records its port and marks policy ready
   ([`src/settings/app.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/app.rs#L31)). The skeleton then creates a 760x520 Normal window titled `NØNOS Settings`,
   subscribed to key-down input ([`src/settings/manifest.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/manifest.rs#L24)).
3. On the first event or paint after the port is known, `ensure_ready` hydrates the cache once by reading
   every field with `OP_GET`, then never runs again ([`src/settings/app.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/app.rs#L42)).
4. Each key-down or click flows through `on_event` to the browsing, editing, or pointer handler, which may
   send an `OP_SET` and update the cache and status on success ([`src/settings/event/on_event.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/on_event.rs#L25)).
5. `paint` projects the current `State` into the surface ([`src/settings/paint/paint.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/paint/paint.rs#L31)).

## Source map

Everything here is drawn from `userland/capsule_settings/` (the capsule source and its `Capsule.mk`),
[`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bits), the kernel spawn mirror under
`src/userspace/capsule_settings/`, and the shared `userland/policy_proto/` crate (the `Field` enum,
labels, kinds, ranges, enum tables, and wire header). Every reference above is verified against those
trees.
