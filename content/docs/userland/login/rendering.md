---
title: "The overlay and its surface"
description: "Login draws one thing: a full-screen lock overlay, a solid color with a single decorative bar and no text."
weight: 4
---
Login draws one thing: a full-screen lock overlay, a solid color with a single decorative bar and no text.
This page covers the painter in [`src/render/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/mod.rs), the setup path in `src/setup/` that discovers peers and
brings up the backing surface, and the compositor client in `src/clients/compositor/` that submits the
surface and asks for it to be presented. For what triggers a repaint at runtime, see
[the unlock flow](/docs/userland/login/unlock/); for identity and the graphics capabilities login does and does not hold, see
the [README](/docs/userland/login/).

## The overlay renders no glyphs

The painter is deliberately trivial. `paint_locked` fills the surface with the locked background
`0xFF242A36` and draws one bar near the top; `paint_unlocked` fills with the unlocked background
`0xFF143A22` and draws the bar lower ([`src/render/mod.rs:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/mod.rs#L3), `:4`, `:7`, `:12`). The bar is a single color
`0xFFEDCB68` ([`src/render/mod.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/mod.rs#L5)). There is no font, no cursor, and no text anywhere in this file. This
is the visible half of the no-passphrase truth: even if login wanted to prompt for a credential, the overlay
has no glyph-drawing path to show one and no input path to read one.

`fill` walks every pixel of the surface and writes the background with a volatile store; `paint_bar` writes
an 8-pixel-tall band from x=16 to width-16 at a caller-supplied top offset, again with volatile stores
([`src/render/mod.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/mod.rs#L35), `:17`, `:25`, `:29`). `paint_bar` guards against a surface too small to hold the
bar, returning early if the width is under 32 or the height cannot fit the bar
([`src/render/mod.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/mod.rs#L18)). Both write through `pixel_mut`, which computes a byte address from the surface base,
the row stride, and 4 bytes per pixel ([`src/render/mod.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/mod.rs#L46), `:47`). The locked bar sits at y=0x20 and the
unlocked bar at y=0x38, which is the only visual difference a person sees between the two states
([`src/render/mod.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/mod.rs#L9), `:14`).

## Setup: discover, size, paint, submit

The overlay is brought up once, in `setup::run`, before the server loop starts ([`src/setup/run.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L21)). The
sequence is:

1. Discover three peers by name through `mk_service_lookup`: the keyring, the desktop shell, and the
   compositor, in that order ([`src/setup/run.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L22), `:23`, `:24`). Each lookup goes through `lookup_port`,
   which treats a negative return, a zero pid, or a zero port as a failure and returns the string
   `"service lookup failed"` ([`src/setup/discover/lookup_port.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover/lookup_port.rs#L24)). The service names are literal:
   `keyring`, `desktop_shell`, and `compositor` ([`src/setup/discover/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover/constants.rs#L17), `:18`, `:19`).
2. Health-check the compositor with request id 1; a failure aborts setup with `"compositor health failed"`
   ([`src/setup/run.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L25)).
3. Query the display dimensions through `nonos_display_dimensions`; a nonzero return or a zero width or
   height is `"display dimensions unavailable"` ([`src/setup/run.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L26), [`src/setup/display.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/display.rs#L22), `:23`).
4. Allocate a private backing surface sized to the screen. `backing::alloc` computes the stride as `width *
   4` and the byte length as `stride * height`, both checked for overflow, then maps an anonymous private
   region read-write ([`src/setup/run.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L27), [`src/setup/backing.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/backing.rs#L20), `:21`, `:22`). The map flags are the
   local `MAP_PRIVATE_ANON = 0x22` and `PROT_READ_WRITE = 0x3` ([`src/setup/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/constants.rs#L17), `:19`).
5. Build the `Context` and paint the locked overlay into the backing before anyone sees it
   ([`src/setup/run.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L28), `:37`).
6. Register and share the surface, then submit it as a scene layer.

## Registering and submitting the surface

`register::surface` fills a `SurfaceDescriptor` with the width, height, stride, `ARGB8888` format, byte
length, and the backing base address, registers it with `mk_surface_register`, and shares it with
`mk_surface_share` to get the handle the compositor references ([`src/setup/register.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/register.rs#L28), `:37`, `:41`). A
negative register id is `"surface register rejected"` and a non-positive share handle is `"surface share
rejected"` ([`src/setup/register.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/register.rs#L38), `:42`).

With the handle in hand, `setup::run` calls the compositor's scene submit at `OVERLAY_Z = 1`, covering the
whole screen from (0,0) ([`src/setup/run.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L45), [`src/setup/constants.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/constants.rs#L18)). The submit is where login's
lack of graphics privilege shows: it does not own the screen the way the compositor does, it registers a
shared backing surface and asks the compositor to composite it at z=1. That is the honest boundary of the
overlay, a policy layer the compositor presents, not a mandatory frame login draws to hardware itself.

Setup cleans up on partial failure so a half-registered overlay is never left behind. If the register fails,
`cleanup_backing` unmaps the backing before returning the error; if the scene submit fails,
`cleanup_surface` releases the surface handle and then `cleanup_backing` unmaps the backing
([`src/setup/run.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L41), `:57`, `:58`, [`src/setup/cleanup_backing.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/cleanup_backing.rs#L20), [`src/setup/cleanup_surface.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/cleanup_surface.rs#L19)).
Because `setup::run` returns an `Err` on any of these, `wait_for_setup` retries the whole sequence in a
yield loop rather than proceeding with a broken overlay ([`src/wait_for_setup.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L20), `:23`).

## The compositor client

The compositor client speaks magic `NCMP` (`0x4E43_4D50`), version 1, over a 20-byte header
([`src/clients/compositor/constants.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/constants.rs#L16), `:17`, `:18`). It uses three ops: `OP_HEALTHCHECK 0x0001`,
`OP_SCENE_SUBMIT 0x0002`, and `OP_DAMAGE_COMMIT 0x0003` ([`src/clients/compositor/constants.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/constants.rs#L19), `:20`,
`:21`). Each call builds the header, appends its op-specific body, sends a blocking `mk_ipc_call`, and checks
the reply through a shared `status::check` that maps a short reply to `-11` and returns the compositor's
status word otherwise ([`src/clients/compositor/status.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/status.rs#L19), `:22`).

- `healthcheck` sends an empty body and is the setup liveness probe
  ([`src/clients/compositor/healthcheck.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/healthcheck.rs#L24)).
- `push_scene_submit` sends a 32-byte body of surface handle, x, y, width, height, and z, and is how the
  overlay enters the scene at setup ([`src/clients/compositor/push_scene_submit.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/push_scene_submit.rs#L24), `:42`,
  [`src/clients/compositor/constants.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/constants.rs#L22)).
- `ping_damage` sends a 16-byte damage rectangle and is the "present this repaint" call. Login sends it
  after every state repaint, and after each `START_SESSION` and `END_SESSION` overlay change
  ([`src/clients/compositor/ping_damage.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/ping_damage.rs#L24), [`src/clients/compositor/constants.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/constants.rs#L23),
  [`src/server/handlers/start_session.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs#L40), [`src/server/handlers/end_session.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/end_session.rs#L23)).

There is no per-frame paint loop. Login paints only twice in the life of a session, once to unlocked on
`START_SESSION` and once back to locked on `END_SESSION`, and each is followed by a single `ping_damage` so
the compositor picks up the change ([`src/server/handlers/start_session.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs#L39), `:40`,
[`src/server/handlers/end_session.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/end_session.rs#L22), `:23`). The initial locked overlay is presented by the scene submit
at setup rather than a damage ping ([`src/setup/run.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L45)).

## Source map

```
  userland/capsule_login/src/render/mod.rs                  the locked/unlocked painter, fill + bar, no text
  userland/capsule_login/src/setup/run.rs                   discover, health, size, paint, register, submit
  userland/capsule_login/src/setup/discover/lookup_port.rs  the mk_service_lookup wrapper, "service lookup failed"
  userland/capsule_login/src/setup/discover/constants.rs    the keyring/desktop_shell/compositor names
  userland/capsule_login/src/setup/display.rs               nonos_display_dimensions
  userland/capsule_login/src/setup/backing.rs               stride/size compute and the anon mmap
  userland/capsule_login/src/setup/register.rs              SurfaceDescriptor register + share
  userland/capsule_login/src/setup/constants.rs             OVERLAY_Z = 1, map/prot flags
  userland/capsule_login/src/setup/cleanup_backing.rs       unmap the backing on partial failure
  userland/capsule_login/src/setup/cleanup_surface.rs       release the surface handle on partial failure
  userland/capsule_login/src/clients/compositor/            NCMP healthcheck, scene submit, damage ping
```

Every reference above is verified against those trees.