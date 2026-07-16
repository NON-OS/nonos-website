---
title: "The toolkit service binary"
description: "The same crate that ships the library also builds a toolkit service binary ([[bin]] name = \"toolkit\", userland/toolkit/Cargo.toml:15)."
weight: 2
---
The same crate that ships the [library](/docs/userland/toolkit/library/) also builds a `toolkit` service binary
(`[[bin]] name = "toolkit"`, [`userland/toolkit/Cargo.toml:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/Cargo.toml#L15)). It is a thin leaf: it holds a global theme
and an animation counter that any capsule can read over IPC, and it exposes the component paint path as an
RPC. This page follows the three service-only modules [`src/lib.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/lib.rs) declares, `server`, `protocol`, and
`component_dispatch`, plus the `main.rs` entry, and it is honest about the one thing the service cannot do:
its `COMPONENT_RENDER` op cannot draw, because the mask it is admitted with lacks the graphics-surface-map
right. For the crate identity and the full mask decomposition, see the [README](/docs/userland/toolkit/).

## Entry and receive loop ([`src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs), `src/server/`)

`_start` initializes the heap, tolerating an already-initialized heap, and exits `1` on any other heap
error, then calls `server::runner::run` ([`src/main.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L26)). The runner is an endless loop
([`src/server/runner.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L29)): it allocates a receive and a transmit buffer of `HDR_LEN + IPC_PAYLOAD_MAX`
each, then on each pass receives on `TOOLKIT_ENDPOINT` with `mk_ipc_recv_from`
([`src/server/runner.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L34)), decodes the header, dispatches, and replies with `mk_ipc_reply`
([`src/server/runner.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L50)). A receive of `ENOTSUP` (`-95`) exits the process with code 95
([`src/server/runner.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L35)), which is the signature of a kernel without the receive syscall. A
non-positive length or a zero sender pid is skipped ([`src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L38)), and a payload whose
header fails to decode is skipped ([`src/server/runner.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L42)).

## The NOTK wire protocol (`src/protocol/`)

The wire frame is `NOTK` (magic `0x4E4F544B`, [`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17)) with a fixed 16-byte header
(`HDR_LEN`, [`src/protocol/header.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L18)) carrying a `u16` op, a `u16` status, a `u32` request id, and a
`u32` payload length ([`src/protocol/header.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L49)). `decode` rejects any frame shorter than the header or
with the wrong magic ([`src/protocol/header.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L27)). The endpoint is `4610` ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)) and
`IPC_PAYLOAD_MAX` is 256 bytes ([`src/protocol/ops.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L25)). The error codes are `STATUS_OK = 0`,
`E_BAD_OP = 1`, `E_INVAL = 2`, `E_SURFACE = 3`, and `E_SHORT = 4` ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)).

## The five operations ([`src/server/dispatch.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs))

Five ops are defined ([`src/protocol/ops.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L19)):

```
  HEALTHCHECK = 0x0000   THEME_APPLY = 0x0001   ANIMATION_TICK = 0x0002
  COMPONENT_RENDER = 0x0003   THEME_GET = 0x0004
```

`dispatch` ([`src/server/dispatch.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L25)) routes each and returns a `(status, reply_len)` pair:

- `HEALTHCHECK` replies `STATUS_OK` with an empty body ([`src/server/dispatch.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L27)).
- `THEME_APPLY` calls `theme::apply` ([`src/theme/apply/apply.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/theme/apply/apply.rs#L21)), which requires at least 20 bytes
  (five little-endian ARGB colors) or returns `E_SHORT` ([`src/theme/apply/apply.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/theme/apply/apply.rs#L22)), then replaces the
  global palette ([`src/theme/store/replace.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/theme/store/replace.rs)). The stored revision is set by the store, not taken from
  the payload ([`src/theme/apply/apply.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/theme/apply/apply.rs#L31)).
- `ANIMATION_TICK` calls `animation::tick` ([`src/animation/tick.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/animation/tick.rs#L21)), reads an optional 8-byte delta,
  advances the shared `TICK` counter ([`src/animation/store/advance.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/animation/store/advance.rs#L20); a zero delta advances by one),
  and returns the new counter as 8 little-endian bytes when the reply buffer has room
  ([`src/animation/tick.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/animation/tick.rs#L30)).
- `COMPONENT_RENDER` calls `component_dispatch::render` ([`src/component_dispatch/render/render.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/component_dispatch/render/render.rs#L23)),
  covered below.
- `THEME_GET` returns a 24-byte snapshot ([`src/server/dispatch.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L36)): background, surface, accent, text,
  border, and a `u32` revision, all little-endian ([`src/server/dispatch.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L41)). A reply buffer shorter
  than `THEME_PAYLOAD_LEN` (24, [`src/protocol/ops.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L26)) comes back `E_BAD_OP`
  ([`src/server/dispatch.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L37)).
- Any other op is `E_BAD_OP` ([`src/server/dispatch.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L32)).

The theme store is atomics read with `Acquire` ([`src/theme/store/snapshot.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/theme/store/snapshot.rs#L21)), and the animation
`advance` uses `AcqRel` on the one shared counter ([`src/animation/store/advance.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/animation/store/advance.rs#L21)), so concurrent
ticks from different callers race on that counter by design.

## COMPONENT_RENDER: the surface it cannot map

`COMPONENT_RENDER` is where the service tries to draw, and the capability model decides the outcome.
`render` ([`src/component_dispatch/render/render.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/component_dispatch/render/render.rs#L23)) parses a 28-byte header (`HEADER_LEN`,
[`src/component_dispatch/render/constants.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/component_dispatch/render/constants.rs#L16)): a `u64` surface handle, then `x`/`y`/`w`/`h`, a `u16`
kind, and a `u16` label length, followed by the label bytes ([`src/component_dispatch/render/render.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/component_dispatch/render/render.rs#L27)).
It rejects a short payload with `E_SHORT` ([`src/component_dispatch/render/render.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/component_dispatch/render/render.rs#L24)), a zero
width/height/handle with `E_INVAL` ([`src/component_dispatch/render/render.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/component_dispatch/render/render.rs#L37)), and a label that runs
past the payload with `E_SHORT` ([`src/component_dispatch/render/render.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/component_dispatch/render/render.rs#L42)). It then calls
`attached_surface(handle)` ([`src/component_dispatch/render/attached_surface.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/component_dispatch/render/attached_surface.rs#L23)), which caches one
attachment and otherwise calls `mk_surface_attach` from `nonos_libc`
([`src/component_dispatch/render/attached_surface.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/component_dispatch/render/attached_surface.rs#L31)). If that returns `<= 0` it yields `None` and the
op answers `E_SURFACE` ([`src/component_dispatch/render/render.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/component_dispatch/render/render.rs#L46)); on success it paints into the mapped
surface via `paint` ([`src/component_dispatch/paint/paint.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/component_dispatch/paint/paint.rs#L26)), building the `buf` slice from the
descriptor `base_va`, `stride`, and `height` ([`src/component_dispatch/paint/paint.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/component_dispatch/paint/paint.rs#L35)) and drawing a
panel, a themed button, or a label by `ComponentKind::from_raw` ([`src/component_dispatch/kind.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/component_dispatch/kind.rs#L24)).

The point is that `mk_surface_attach` is gated. In the kernel, `MkSurfaceAttach` requires
`caps.can_surface_map()` ([`src/syscall/contract/cap_table/mk.rs:75`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/mk.rs#L75)), which is
`grants(Capability::GraphicsSurfaceMap)` ([`src/syscall/caps/checks/graphics.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/caps/checks/graphics.rs#L29)), bit `8192`
([`src/capabilities/types.rs:69`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L69)). The toolkit capsule is admitted with `CAPSULE_REQUIRED_CAPS = 0x19`
(`userland/toolkit/Capsule.mk:11`), which is `CoreExec | IPC | Memory` (`1 | 8 | 16`,
[`src/capabilities/types.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L56), `:59`, `:60`) and holds no graphics bit. So the service, as configured,
cannot attach any surface: `mk_surface_attach` fails the capability check, `attached_surface` returns
`None`, and `COMPONENT_RENDER` always answers `E_SURFACE`. The paint path is present in the code but
unreachable from the service's own token. Capsules that actually draw do so through the [library](/docs/userland/toolkit/library/),
in their own address space, using surfaces they own; they do not go through the service's
`COMPONENT_RENDER`.

## The service as a trust boundary

The service is a leaf that cannot paint. Every op is answered from the global theme atoms and the animation
counter ([`src/server/dispatch.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L25)); it calls no other service. Its one drawing op, `COMPONENT_RENDER`,
returns `E_SURFACE` under mask `0x19`, and it holds neither `GraphicsSurfaceCreate`
([`src/capabilities/types.rs:68`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L68)) nor `GraphicsPresent` ([`src/capabilities/types.rs:70`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L70)), so it can neither
create a surface nor present one. That bounds a compromise of the service to the cosmetic state it holds.

The honest gap is caller authentication. The service does not check who is calling. Any capsule that can
reach endpoint 4610 can `THEME_APPLY` and change the palette every reader gets back from `THEME_GET`, and
any caller can tick the shared animation counter. `THEME_APPLY` validates length (at least 20 bytes,
[`src/theme/apply/apply.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/theme/apply/apply.rs#L22)) but not identity. The model treats the theme as cosmetic: a stray theme is
ugly, not a boundary crossing, because the service cannot draw it anywhere itself. The shared animation
counter means concurrent ticks race by design.

## Source map

Every claim above is traced to [`userland/toolkit/src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/main.rs) (the entry), `userland/toolkit/src/server/`
(the receive loop and dispatch), `userland/toolkit/src/protocol/` (the NOTK header, ops, and error codes),
and `userland/toolkit/src/component_dispatch/` (the render parse, surface attach, and paint), with the
capability gate in [`src/syscall/contract/cap_table/mk.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/mk.rs), [`src/syscall/caps/checks/graphics.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/caps/checks/graphics.rs), and
[`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs), the mask in `userland/toolkit/Capsule.mk`, and the theme and animation stores
under `userland/toolkit/src/theme/` and `userland/toolkit/src/animation/`. Every reference above is
verified against those trees.
