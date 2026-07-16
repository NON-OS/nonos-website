---
title: "Desktop and GUI Service Capsules"
description: "The desktop is not one program. It is a fleet of small capsules that cooperate over IPC: a compositor that owns the screen, a window manager that owns placement, an input router..."
weight: 500
---
The desktop is not one program. It is a fleet of small capsules that cooperate over IPC: a compositor
that owns the screen, a window manager that owns placement, an input router that fans the kernel input
ring out to windows, the shell chrome, and a handful of supporting services (wallpaper, clipboard,
login, image decode, toolkit). Each capsule has its own service loop, its own wire protocol, and its
own minimal capability set. This page is the index for the fleet: it names every capsule, its endpoint,
its capability mask, and the boundary it sits on. Each row links to a dedicated deep page that covers
the server loop, per-operation logic, state, and honest gaps.

## The fleet

| Capsule | Service endpoint | Reply endpoint | Caps | What it is |
|---------|------------------|----------------|------|-----------|
| [compositor](/docs/userland/compositor/) | `compositor` :4310 | :4311 | `0x7919` | Owns the screen: scene layers, damage-driven compositing, vsync present. |
| [wm](/docs/userland/wm/) | `wm` :4330 | :4331 | `0x19` | Window lifecycle, z-order, focus, and the hit-test/focus queries the input router uses. |
| [input-router](/docs/userland/input-router/) | `input_router` :4320 | :4321 | `0x19` | Drains the kernel input ring and routes to windows by hit-test and focus, with trusted-only grabs. |
| [desktop-shell](/docs/userland/desktop-shell/) | `desktop_shell` :4410 | :4411 | `0x1819` | The taskbar, tray, toasts, and spotlight; coordinates the desktop services. |
| [wallpaper](/docs/userland/wallpaper/) | `wallpaper` :4340 | :4341 | `0x1819` | The background: color or catalog image, with a fade timeline. |
| [wallpaper-catalog](/docs/userland/wallpaper-catalog/) | `wallpaper_catalog` :4110 | :4111 | `0x19` | Serves built-in wallpaper metadata and chunked image bytes. |
| [image-codec](/docs/userland/image-codec/) | `image_codec` :4412 | :4413 | `0x1819` | Decodes PNG/BMP/JPEG/LZ4 to ARGB with real toolkit decoders; isolated because images are untrusted. |
| [clipboard](/docs/userland/clipboard/) | `clipboard` :4414 | :4415 | `0x19` | Bounded copy history that wipes itself on idle. |
| [login](/docs/userland/login/) | `login` :4416 | :4417 | `0x19` | Session gate: unlocks the keyring (which is authoritative), owner-pid enforced. |
| [toolkit](/docs/userland/toolkit/) | `toolkit` :4610 | :4611 | `0x19` | Stateless theme, animation, and component-render RPC. |
| [boot-splash](/docs/userland/boot-splash/) | `app.boot_splash` (reserved :4796, never bound) | :4797 | `0x1819` | Boot screen that displays the kernel's attestation badge; it displays, it does not verify. It is a pure compositor client. |
| [setup-wizard](/docs/userland/setup-wizard/) | `app.setup_wizard` :4794 | :4795 | `0x1819` | First-run config wizard that commits choices to policy. |

Endpoints and capability masks are taken directly from each capsule's `Capsule.mk`
(`CAPSULE_SERVICE_ENDPOINT`, `CAPSULE_REPLY_ENDPOINT`, `CAPSULE_REQUIRED_CAPS`). The reply endpoint is
always the service port plus one. The `boot_splash` row is the one exception to the "binds its service"
rule: `Capsule.mk` reserves `service:4796:app.boot_splash`, but `main.rs` never calls
`mk_service_register`; it only registers a surface with the compositor
([`capsule_boot_splash/src/surface.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_boot_splash/src/surface.rs#L47)) and looks the compositor up as a client
([`capsule_boot_splash/src/main.rs:78`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_boot_splash/src/main.rs#L78)).

## Capability masks, decoded

Every capability bit is defined in [`userland/nonos_cap/src/bits.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/nonos_cap/src/bits.rs). The three masks the fleet uses:

| Bit | Value | Name (`bits.rs`) |
|-----|-------|------------------|
| 0 | `0x0001` | `CAP_CORE_EXEC` |
| 3 | `0x0008` | `CAP_IPC` |
| 4 | `0x0010` | `CAP_MEMORY` |
| 8 | `0x0100` | `CAP_DEBUG` |
| 10 | `0x0400` | `CAP_REGISTER_SERVICE` |
| 12 | `0x1000` | `CAP_GRAPHICS_SURFACE_CREATE` |
| 13 | `0x2000` | `CAP_GRAPHICS_SURFACE_MAP` |
| 14 | `0x4000` | `CAP_GRAPHICS_PRESENT` |

- `0x19` = `CAP_CORE_EXEC | CAP_IPC | CAP_MEMORY`. The plain service set: run, talk, own memory. This is
  wm, input-router, wallpaper-catalog, clipboard, login, and toolkit. None of them touch the framebuffer
  directly; they answer queries and hand work to the compositor.
- `0x1819` = `0x19 | CAP_REGISTER_SERVICE | CAP_GRAPHICS_SURFACE_CREATE`. Adds the right to register a
  named service and to create a surface the compositor can composite. This is desktop-shell, wallpaper,
  image-codec, boot-splash, and setup-wizard: capsules that own a visible surface.
- `0x7919` = `0x1819 | CAP_DEBUG | CAP_GRAPHICS_SURFACE_MAP | CAP_GRAPHICS_PRESENT`. Only the compositor
  holds this. `CAP_GRAPHICS_SURFACE_MAP` and `CAP_GRAPHICS_PRESENT` are the two rights that let a capsule
  map every client surface into its own address space and drive the present path. That is the whole point
  of the design: exactly one capsule can read all pixels and push a frame, and it is the passive one.

Note that no desktop capsule holds `CAP_IO`, `CAP_NETWORK`, `CAP_FILESYSTEM`, `CAP_HARDWARE`,
`CAP_DRIVER`, `CAP_MMIO`, `CAP_IRQ`, `CAP_DMA`, or `CAP_PIO`. The GUI is entirely IPC-and-memory. It
reaches hardware only by asking a driver capsule that does hold those bits.

## How the fleet fits together

The topology is a small star with the compositor at the center and everything else as a client of it:

```
   kernel input ring
          |
          v
   [input_router] --hit-test/focus query--> [wm]
          |                                    |
          | key/pointer events                 | window opened/closed/moved
          v                                    v
     focused window  <----- placement -----  [compositor] :4310
          ^                                    ^   ^
          |                                    |   |
   [desktop_shell] ---- surface + shell ------/    |
          |                                         |
   [wallpaper] --- background surface --------------/
          |
   [wallpaper_catalog] (image bytes)   [image_codec] (decode)   [toolkit] (theme/render)
```

The three rules that make this safe:

1. The compositor is passive. It owns the frame ([`compositor/src/frame_pacer/vsync.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/compositor/src/frame_pacer/vsync.rs),
   [`compositor/src/frame_pacer/composite.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/compositor/src/frame_pacer/composite.rs)) and the scene table
   ([`compositor/src/state/scene/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/compositor/src/state/scene/mod.rs)), but it never decides placement or focus. Clients submit
   surfaces and damage; the compositor composites and presents.
2. The window manager owns placement, z-order, and focus, and it is the one that answers the input
   router's hit-test and focus queries. Windows do not talk to the input router directly.
3. The input router is the single consumer of the kernel input ring. It drains the ring
   ([`capsule_input_router/src/server/drain_ipc.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_input_router/src/server/drain_ipc.rs)) and fans events out to the focused window, so no
   other capsule ever sees raw input.

The desktop-shell is the coordinator. It looks up and drives the compositor, input_router, wallpaper,
and wm services, plus `market.index` and the net/policy indicators, from
`capsule_desktop_shell/src/setup/discover/constants.rs:19-23` and
`capsule_desktop_shell/src/state/indicators/`. It is a client of the fleet, not its owner.

The bring-up order (who registers before whom, and why the boot-splash lingers until the shell appears)
is the [lifecycle](/docs/userland/lifecycle/) page. The surface and input mechanisms the fleet rides on are the
[graphics](https://github.com/NON-OS/nonos-micro-kernel/blob/main/subsystems/graphics/README.md) and [input](https://github.com/NON-OS/nonos-micro-kernel/blob/main/subsystems/input/README.md)
subsystems, and the raw event source is the [input ring](https://github.com/NON-OS/nonos-micro-kernel/blob/main/subsystems/input/README.md).

## Security analysis

The desktop fleet sits entirely on the IPC boundary. Its whole trusted-path story is that no GUI capsule
can reach a device, a file, or the network on its own, and only one capsule can see all pixels.

- Pixel isolation. `CAP_GRAPHICS_SURFACE_MAP` and `CAP_GRAPHICS_PRESENT` live only in the compositor's
  `0x7919` mask. Every other capsule can create a surface (`CAP_GRAPHICS_SURFACE_CREATE`, in the `0x1819`
  set) but cannot map another capsule's surface or present a frame. A malicious shell or wallpaper cannot
  scrape the framebuffer.
- Input isolation. Only the input router reads the kernel input ring. Grabs (taking exclusive input) are
  gated: [`capsule_input_router/src/server/handlers/grab_request.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_input_router/src/server/handlers/grab_request.rs#L25) hardcodes the only three capsules
  allowed to grab, `app.boot_splash`, `app.setup_wizard`, and `app.input_probe`, and checks the caller by
  resolving each trusted name to a pid and matching the sender
  (`grab_request.rs:27` `is_trusted_grabber`). Any other caller gets `E_ACCES`. This is a name-to-pid
  check at the router, not a capability bit, so it is only as strong as service-name registration.
- No ambient authority. None of these capsules hold `CAP_HARDWARE`, `CAP_DRIVER`, `CAP_MMIO`,
  `CAP_IRQ`, `CAP_DMA`, `CAP_PIO`, `CAP_IO`, `CAP_NETWORK`, or `CAP_FILESYSTEM`. The GUI reaches hardware
  only through driver capsules that do.
- Untrusted-data isolation. Images are attacker-controlled bytes, so decode is its own capsule
  ([image-codec](/docs/userland/image-codec/)) with only `0x1819`. A decoder bug is contained to a capsule that cannot
  touch input, the keyring, or a device.
- Secret handling. The [login](/docs/userland/login/) capsule is a gate, not a vault: it unlocks the
  [keyring](/docs/userland/keyring/) ([`capsule_login/src/clients/keyring.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_login/src/clients/keyring.rs), `OP_UNLOCK = 5`), and the keyring stays
  authoritative. The [clipboard](/docs/userland/clipboard/) bounds its history and wipes on idle
  ([`capsule_clipboard/src/protocol/limits.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_clipboard/src/protocol/limits.rs#L22) `DEFAULT_IDLE_TIMEOUT_MS = 600_000`;
  [`capsule_clipboard/src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_clipboard/src/server/runner.rs#L33) `expire_if_idle`), so copied secrets do not linger forever.
- Attestation is display-only. The boot-splash shows the kernel's attestation badge
  (`capsule_boot_splash` calls `mk_attest_status`) but does not verify anything. It reserves a service
  endpoint it never binds, so it presents no attack surface as a server; it is a pure client.

For per-operation access checks, opcode validation, and payload bounds, see each capsule's own page. This
index only states the boundary; the deep pages prove it.

## Debugging

Every capsule in the fleet registers a named service, so the first check for any desktop problem is
whether the service is up. In the kernel service registry, look for the twelve names in the table
above (`compositor`, `wm`, `input_router`, `desktop_shell`, `wallpaper`, `wallpaper_catalog`,
`image_codec`, `clipboard`, `login`, `toolkit`, `app.setup_wizard`; `app.boot_splash` will not appear
because it never registers). A missing name means that capsule failed to start or failed
`mk_service_register` (register returns negative on failure, and the capsule exits, for example
[`compositor/src/main.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/compositor/src/main.rs#L42)).

Concrete symptoms and where to look:

- Black screen, nothing composites. The compositor did not come up or has no surfaces. Check that
  `compositor` :4310 is registered and that at least the wallpaper surface submitted. The compositor is
  passive, so a black screen usually means no client submitted a surface, not a compositor crash.
- Splash never leaves. The boot-splash lingers until the desktop shell registers, then settles, with a
  hard cap so it never hangs ([`capsule_boot_splash/src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_boot_splash/src/main.rs): `SETTLE_MS = 1000`,
  `MAX_DWELL_MS = 30_000`, `MAX_ITERS = 8_000_000`). If it hangs past 30 seconds the cap fires; if it
  leaves too early the shell registered but has not painted yet.
- Clicks or keys go nowhere. The input router routes by the wm's hit-test and focus. Confirm `wm` :4330
  and `input_router` :4320 are both up and that the wm is answering focus queries. If a modal grab is
  stuck, only one of the three trusted grabbers (`grab_request.rs:25`) can hold it; a released grabber
  frees it ([`capsule_input_router/src/server/handlers/grab_release.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_input_router/src/server/handlers/grab_release.rs)).
- A window is placed off-screen or overlaps wrongly. That is the wm's placement path
  ([`capsule_wm/src/server/handlers/window_open/place.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_wm/src/server/handlers/window_open/place.rs)), not the compositor.
- An image will not display. Decode failures come back from image-codec as a negative errno
  ([`capsule_image_codec/src/protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_image_codec/src/protocol/errno.rs): `E_UNSUPPORTED = -95`, plus `E_INVAL` and `E_BAD_LEN`
  from [`capsule_image_codec/src/server/handlers/decode.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_image_codec/src/server/handlers/decode.rs#L57) for bad magic, bad dimensions, too-small
  output, or truncation).
- Copied text vanished. The clipboard wipes on idle after `DEFAULT_IDLE_TIMEOUT_MS` (ten minutes) unless
  a client raised it with the set-idle-timeout op
  ([`capsule_clipboard/src/server/handlers/set_idle_timeout.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_clipboard/src/server/handlers/set_idle_timeout.rs), bounded by `MIN_IDLE_TIMEOUT_MS` and
  `MAX_IDLE_TIMEOUT_MS`). This is expected behavior, not a bug.

For the exact opcodes, reply layouts, and per-handler error codes, use the linked deep page for the
capsule in question.

## Source map

- `userland/compositor/` (main.rs, `frame_pacer/`, `state/scene/`, [`state/damage.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/state/damage.rs), `Capsule.mk`)
- `userland/capsule_wm/` (main.rs, `server/handlers/`, `Capsule.mk`)
- `userland/capsule_input_router/` (main.rs, [`server/drain_ipc.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/drain_ipc.rs), [`server/handlers/grab_request.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/grab_request.rs),
  [`server/handlers/grab_release.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/grab_release.rs), [`protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/protocol/errno.rs), `Capsule.mk`)
- `userland/capsule_desktop_shell/` ([`setup/discover/constants.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/setup/discover/constants.rs), `state/indicators/`, `Capsule.mk`)
- `userland/capsule_wallpaper/` and `userland/capsule_wallpaper_catalog/` (`Capsule.mk`, `bootstrap/`)
- `userland/capsule_image_codec/` ([`protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/protocol/errno.rs), [`server/handlers/decode.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/decode.rs), `Capsule.mk`)
- `userland/capsule_clipboard/` ([`protocol/limits.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/protocol/limits.rs), [`server/runner.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/runner.rs),
  [`server/handlers/set_idle_timeout.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handlers/set_idle_timeout.rs), `Capsule.mk`)
- `userland/capsule_login/` ([`clients/keyring.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/clients/keyring.rs), `setup/discover/`, `Capsule.mk`)
- `userland/toolkit/` ([`protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/protocol/ops.rs), `Capsule.mk`)
- `userland/capsule_boot_splash/` (main.rs, `surface.rs`, `proto.rs`, `Capsule.mk`)
- `userland/capsule_setup_wizard/` (`Capsule.mk`)
- [`userland/nonos_cap/src/bits.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/nonos_cap/src/bits.rs) (capability bit definitions)

Every reference above is verified against those trees.
