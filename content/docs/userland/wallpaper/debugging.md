---
title: "Debugging capsule_wallpaper"
description: "This page lists the log marker the wallpaper capsule's boot path emits and the concrete failure modes with where to look for each."
weight: 6
---
This page lists the log marker the wallpaper capsule's boot path emits and the concrete failure modes with
where to look for each. For the request protocol see the [operations](/docs/userland/wallpaper/operations/) page, for the
selection and paint pipeline see the [pipeline](/docs/userland/wallpaper/pipeline/) page, and for identity and the capability
mask see the [README](/docs/userland/wallpaper/).

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel prints
`[WALLPAPER] capsule spawned` from the desktop-fleet spawn: the fleet calls `boot::capsule` with the tag
`"WALLPAPER"` and the slug `"wallpaper"` ([`src/userspace/init/spawn_plan/desktop_fleet.rs:109`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L109)), and the
capsule boot path's `Ok` arm logs `boot_log::ok(prefix, "capsule spawned")`
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29), [`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). If that line is absent the
capsule never started, and the `Err` arm logged an error line instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)), which is the usual signature, manifest, or capability
failure. The kernel spawn requests exactly `caps=0x1819` ([`src/userspace/capsule_wallpaper/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_wallpaper/spawn.rs#L50)).

## Failure modes

### Blank or default-colored background, no image

The default fill color `0xFF0080FF` is painted first at setup, so a solid blue-ish background means the
embedded and policy-selected images never landed ([`src/setup/prime/run.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run.rs#L25), [`src/setup/prime/run.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run.rs#L33)).
The usual cause is the catalog or policy port not resolving: both are looked up tolerantly at setup and
left `None` on failure, so the subscriber degrades to leaving the color rather than failing setup
([`src/setup/prime/run.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run.rs#L45), [`src/subscriber/tick.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/subscriber/tick.rs#L30), [`src/subscriber/tick.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/subscriber/tick.rs#L36)). Confirm
`wallpaper_catalog` and `policy` are registered. Note the subscriber only polls every 300 ticks, so a
service that comes up late is picked up on the next poll, not immediately ([`src/subscriber/tick.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/subscriber/tick.rs#L23)).

### Wrong wallpaper

The index comes only from the policy `wallpaper` field ([`src/policy_client/get_wallpaper.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/policy_client/get_wallpaper.rs#L22)); a wrong
image means a wrong stored index, not a wallpaper bug. The capsule validates that the policy reply echoes
the op, kind, and field before trusting the byte, so a garbled reply is dropped rather than misapplied
([`src/policy_client/get_wallpaper.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/policy_client/get_wallpaper.rs#L44)). Cross-check the stored value against the catalog's slug for that
index, described on the [wallpaper catalog](/docs/userland/wallpaper-catalog/) page.

### The wrong shape, letterboxing expected but not seen

Every fit policy renders as a stretch today. `SET_POLICY` records the style and `GET_WALLPAPER` reports it,
but both paint paths always nearest-neighbor stretch the image to the full surface and neither reads the
stored policy ([`src/paint/blit_argb.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/blit_argb.rs#L31), [`src/decode_client/seq.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decode_client/seq.rs#L51), [`src/state/policy.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/policy.rs#L19)). So an
image that looks distorted rather than fitted, centered, or tiled is the documented gap, not a fault. The
[pipeline](/docs/userland/wallpaper/pipeline/) page has the detail and the [contributing](/docs/userland/wallpaper/contributing/) page points at the two
functions to fix.

### No background layer at all

Setup blocks on the compositor, retrying the lookup and giving up with `"compositor service not announced"`
only after 256 tries ([`src/setup/discover.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover.rs#L32)). A surface register or share rejection surfaces as
`"surface register rejected"` or `"surface share rejected"`, and a rejected scene submit releases the
shared handle and returns the submit error ([`src/setup/prime/register.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/register.rs#L43), [`src/setup/prime/register.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/register.rs#L47),
[`src/setup/prime/register.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/register.rs#L49)). Because `wait_for_setup` retries `setup::run` on any error
([`src/wait_for_setup.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L19)), a capsule that is alive but shows no background layer is stuck failing one of
those setup steps rather than crashed.

### A wallpaper that snaps instead of dissolving

A `FADE` with a zero duration is defined to snap to the target alpha rather than animate
([`src/state/fade.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/fade.rs#L36), [`src/server/handlers/fade.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/fade.rs#L46)), so that is a zero-duration request, not a
fault. A ramp that never advances points at the pacer: the fade tick only repaints when the sampled alpha
changes and only runs while a fade is active, and it reads the vsync clock each step
([`src/server/tick.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tick.rs#L25), [`src/server/tick.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tick.rs#L33)).

### A SET_WALLPAPER that is ignored with E_ACCES

The caller is not `desktop_shell` or `policy`; the write gate is doing its job
([`src/server/handlers/set_wallpaper.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_wallpaper.rs#L44)). The gate resolves those two service names to pids and compares
against the sender, so a caller whose service is not registered under one of those names, or is registered
under a different pid, is refused ([`src/server/handlers/set_wallpaper.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_wallpaper.rs#L26),
[`src/server/handlers/set_wallpaper.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_wallpaper.rs#L39)). The read-only `GET_WALLPAPER`, `SET_POLICY`, `FADE`, and
`HEALTHCHECK` are open to any caller with IPC rights.

## Source map

```
  src/userspace/init/spawn_plan/desktop_fleet.rs    the [WALLPAPER] fleet spawn entry
  src/userspace/init/capsule_boot/run.rs            capsule spawned / error boot path
  src/sys/boot_log/output.rs                        the ok/error marker printer
  src/userspace/capsule_wallpaper/spawn.rs          requested caps=0x1819
  userland/capsule_wallpaper/src/setup/discover.rs  compositor wait, "compositor service not announced"
  userland/capsule_wallpaper/src/setup/prime/run.rs default color, embedded image, apply policy
  userland/capsule_wallpaper/src/setup/prime/register.rs  surface register/share/scene_submit rejections
  userland/capsule_wallpaper/src/subscriber/tick.rs 300-tick poll, tolerant port lookup
  userland/capsule_wallpaper/src/policy_client/get_wallpaper.rs  the selection read and its validation
  userland/capsule_wallpaper/src/paint/blit_argb.rs the always-stretch paint
  userland/capsule_wallpaper/src/decode_client/seq.rs  the inline always-stretch paint
  userland/capsule_wallpaper/src/state/policy.rs    the stored-but-unread fit-style enum
  userland/capsule_wallpaper/src/state/fade.rs      the zero-duration snap and the ramp
  userland/capsule_wallpaper/src/server/tick.rs     the fade pacer
  userland/capsule_wallpaper/src/server/handlers/set_wallpaper.rs  the E_ACCES write gate
  userland/capsule_wallpaper/src/wait_for_setup.rs  the retry-until-setup-succeeds loop
```

Every reference above is verified against those trees.
