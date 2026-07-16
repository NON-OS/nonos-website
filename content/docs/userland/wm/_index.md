---
title: "The Window Manager Capsule"
description: "capsulewm is the window manager for the NØNOS desktop."
weight: 400
---
`capsule_wm` is the window manager for the NØNOS desktop. It owns the window model, placement, z-order,
focus, and the lifecycle notifications the shell relies on. It does not own pixels: an app registers its
own surface with the compositor and shares the handle directly, and it tells the wm only its
`(window_id, geometry, kind)` so the wm can answer authoritative questions like which window owns the
point under the cursor and who currently holds focus. The source is a small set of top-level modules, and
this documentation mirrors that structure one page per pillar so a page can be read beside the folder it
describes.

## Identity

Everything the kernel and the service registry need to name and reach the wm comes from its `Capsule.mk`
and its kernel-side spawn record. The two agree exactly.

| Field | Value | Source |
|---|---|---|
| Slug | `wm` | `userland/capsule_wm/Capsule.mk:7` |
| Service handle | `wm` | `Capsule.mk:8`, [`src/userspace/capsule_wm/spawn.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_wm/spawn.rs#L28) |
| Namespace | `systems.nonos.wm` | `Capsule.mk:13` |
| Service endpoint | `service:4330:wm` | `Capsule.mk:14`, `spawn.rs:29` |
| Reply endpoint | `reply:4331:endpoint.wm.reply` | `Capsule.mk:15`, `spawn.rs:30` |
| Capability mask | `0x19` | `Capsule.mk:19`, `spawn.rs:47` |
| Binary name | `wm` | `Capsule.mk:11` |
| Kernel mirror | `src/userspace/capsule_wm` | `Capsule.mk:20` |

The mask `0x19` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|-----|-------|--------|
| CoreExec | `0x0001` | run as a process |
| IPC | `0x0008` | send and receive on its endpoints |
| Memory | `0x0010` | map its own heap and stack |

That is the whole mask: `0x0001 + 0x0008 + 0x0010 = 0x0019`. The kernel spawn path requests exactly those
three capabilities and no others ([`src/userspace/capsule_wm/spawn.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_wm/spawn.rs#L47)). There is no `Debug` bit (256),
no `Network`, no `FileSystem`, no graphics capability, and nothing from the driver family. The `Capsule.mk`
comment is explicit that Debug is deliberately absent because the wm emits no serial markers in steady
state (`Capsule.mk:17`). The wm holds no display, surface, network, filesystem, or driver right, so it
cannot read a framebuffer, open a socket, or touch a device. Its whole authority is to receive IPC, keep a
table of window metadata, and make two kinds of outbound call: a `FOCUS_SET` to the compositor and a
lifecycle notification to subscribers. Compromising the wm yields that mask and nothing more.

## The four pillars

The source under `userland/capsule_wm/src/` is nine top-level modules, and the documentation groups them
into four code pillars plus the crate-wide contributing and debugging pages. An inbound request arrives on
one inbox, the server decodes and dispatches it, a handler mutates the state through the layout rules, and
a focus change flows back out to the compositor client.

```
  request  ->  operations  ->  state      ->  clients
  on IPC       decode and      windows,       FOCUS_SET out,
  inbox        dispatch,       focus, z,       notify subscribers,
               per-op          placement       display size in
               handlers        (layout)
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/wm/operations/) | `src/protocol/`, `src/server/` | The `NWMP` wire, the fourteen opcodes with lengths and handlers, the run loop and dispatch, the per-op behaviour, and the reply and notification encoders. |
| [layout.md](/docs/userland/wm/layout/) | `src/geometry/`, `src/focus/`, `src/z_order/`, `src/server/handlers/window_open/` | The rectangle and display clamp, the collide-and-step placement policy, the focus model, the hit test, and the monotonic z counter. |
| [clients.md](/docs/userland/wm/clients/) | `src/compositor_client/`, `src/setup/`, [`src/wait_for_setup.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs), the `route_focus` gate | The `NCMP` compositor client, setup and bring-up, the display-size query, the `FOCUS_SET` push, and the `input_router` gate that guards privileged focus routing. |
| [state.md](/docs/userland/wm/state/) | `src/state/`, `src/window/` | The `Context`, the 256-entry window table, the `Window` record with kind and visibility, owner-scoped lookups, and the 16-entry subscriber list. |
| [contributing.md](/docs/userland/wm/contributing/) | the whole tree | Where to work, how to add an operation, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/wm/debugging/) | runtime | The boot marker, the failure modes, and where to look when a window, focus, or a resize misbehaves. |

## Lifecycle

The wm is a `no_std`/`no_main` capsule that is, in steady state, a single request loop over one IPC inbox.

1. The kernel spawns the capsule at boot through the desktop fleet plan, which verifies the embedded ELF,
   certificate, manifest, and attestation, registers `wm` on port 4330, and logs `[WM] capsule spawned`
   ([`src/userspace/init/spawn_plan/desktop_fleet.rs:100`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L100), [`src/userspace/capsule_wm/spawn.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_wm/spawn.rs#L34),
   [`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)).
2. `_start` initializes the heap, then blocks in `wait_for_setup` until `setup::run` succeeds: it resolves
   the `compositor` service, probes it, and reads the display width and height, yielding between attempts
   so a not-yet-ready compositor does not spin ([`src/main.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L36), [`src/wait_for_setup.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L19),
   [`src/setup/run.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L36)). The resulting `Context` starts its request-id counter at 3 because ids 1 and 2
   were spent probing the compositor ([`src/setup/run.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L48)).
3. The server loop blocks on the service inbox with a 250 ms receive timeout so it can run the dead sweep
   every fourth wakeup ([`src/server/runner/run.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L28), [`src/server/runner/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/constants.rs#L17)). Window verbs
   from apps and topmost and route-focus queries from the input router all arrive on that inbox.
4. On each sweep tick the wm purges dead subscribers, then removes one dead window at a time, clearing
   focus and pushing `FOCUS_SET(0)` if the dead window held focus and broadcasting a `CLOSED` notification
   for each ([`src/server/runner/sweep_dead.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/sweep_dead.rs#L21)).

The wm carries metadata, not framebuffers. The only pixels it influences are indirect: when focus changes
it pushes a `FOCUS_SET` to the compositor so the compositor can restyle the focused window's chrome
([`src/compositor_client/focus_set.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/focus_set.rs#L22)).

## Source map

```
  userland/capsule_wm/src/main.rs             _start -> wait_for_setup -> server::run
  userland/capsule_wm/src/protocol/           the NWMP wire, opcodes, limits, errno, NWMV notify
  userland/capsule_wm/src/server/             run loop, dispatch, per-op handlers, reply and notify
  userland/capsule_wm/src/geometry/           Rect, overlaps/contains, clamp_to_display
  userland/capsule_wm/src/focus/              the focus reference and topmost_hit_at
  userland/capsule_wm/src/z_order/            the monotonic z counter
  userland/capsule_wm/src/state/              Context and the 16-entry subscriber list
  userland/capsule_wm/src/window/             the Window record, Kind/Visibility, the 256-entry table
  userland/capsule_wm/src/compositor_client/  NCMP client: display_info, focus_set, wire
  userland/capsule_wm/src/setup/              resolve + probe compositor, read display size
  userland/capsule_wm/Capsule.mk              slug, handle, ports, capability mask, kernel mirror
  src/userspace/capsule_wm/spawn.rs           the kernel-side embed and verified spawn
  src/capabilities/types.rs                   the capability bit table (0x19 decomposition)
```

Every reference above is verified against those trees.
</content>
</invoke>
