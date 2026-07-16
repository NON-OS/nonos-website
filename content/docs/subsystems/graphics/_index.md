---
title: "Graphics"
description: "How pixels get to the screen. NØNOS does no drawing in the kernel. A capsule owns a framebuffer surface, shares it with a compositor by having the kernel map the same physical f..."
weight: 13
---
How pixels get to the screen. NØNOS does no drawing in the kernel. A capsule owns a framebuffer
surface, shares it with a compositor by having the kernel map the same physical frames into both
address spaces, presents it, and paces its animation to the display's vertical blank. The kernel
owns the surface registry, the frame sharing, and the vsync clock; the compositing policy lives in
capsules.

| Page | What it covers |
|------|----------------|
| [surfaces.md](/docs/subsystems/graphics/surfaces/) | The `SurfaceDescriptor` and slot, `register_surface` with its geometry validation, and the epoch-guarded handle. |
| [sharing.md](/docs/subsystems/graphics/sharing/) | `share` and `attach`: the refcount, the zero-copy cross-address-space frame mapping, the attach map, and release on exit. |
| [presentation.md](/docs/subsystems/graphics/presentation/) | The `MkSurface*` / `MkDisplay*` syscalls, present, and the phase-grid vsync (and the serialization bug it fixed). |

The design mirrors the rest of the kernel: the kernel holds the minimal shared mechanism, a
registry of surfaces, a way to map one surface's frames into another capsule, and a vblank clock,
and everything above it (which surface is on top, how windows compose, what the cursor looks like)
is a capsule's job over [IPC](/docs/subsystems/ipc/). Sharing is zero-copy because the same physical
frames are mapped into each participant, and it is safe because the handle carries an epoch,
ownership is checked on every operation, and the frames are refcounted and released on exit. The
surface registry also houses the [input ring](/docs/subsystems/input/), since input and display share the
same window-system boundary.

## Sources

The subsystem lives under `src/kernel_core/surface_registry/`: `table.rs` and `types.rs` (the slot
table and descriptor), `share/` (share and attach), `attach_map/` (per-receiver VA records),
`release/` (reference and exit release), and `vsync.rs` (the vblank clock). The syscalls are
[`src/syscall/dispatch/router/surface_ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/surface_ops.rs) and `surface_handlers.rs`. Every page is verified
against those trees with `file:line` references.
