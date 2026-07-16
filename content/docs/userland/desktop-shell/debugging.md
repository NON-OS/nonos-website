---
title: "Debugging capsule_desktop_shell"
description: "This page lists the log marker the shell's boot path emits and the concrete failure modes with where to look for each."
weight: 6
---
This page lists the log marker the shell's boot path emits and the concrete failure modes with where to
look for each. For the shell model see the [README](/docs/userland/desktop-shell/), the [surface](/docs/userland/desktop-shell/surface/), the
[operations](/docs/userland/desktop-shell/operations/), the [clients](/docs/userland/desktop-shell/clients/), and the [state](/docs/userland/desktop-shell/state/) pages in this folder.

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel logs
`[DESKTOP-SHELL] capsule spawned` from the capsule boot path: the `Ok` arm calls `boot_log::ok(prefix,
"capsule spawned")` with the tag `DESKTOP-SHELL` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29),
[`src/userspace/init/spawn_plan/desktop_fleet.rs:118`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L118)). If that line is absent the capsule never started,
and the `Err` arm logged an error line through `boot_log::error` instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)), which is the usual signature, manifest, capability, or
attestation failure.

## Failure modes

### The shell never appears and setup never completes

`wait_for_setup` loops on `setup::run` and only returns once every required peer resolves and
health-checks ([`src/wait_for_setup.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L19), [`src/setup/prime/peers.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/peers.rs#L28)). The compositor, input router,
and wm are all required, and the compositor is additionally health-checked during resolution
(`peers.rs:29`, `peers.rs:30`). The wallpaper lookup is also required: setup fails with `wallpaper service
not announced` if the wallpaper capsule is not up ([`src/setup/discover/require_wallpaper.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover/require_wallpaper.rs#L19),
[`src/setup/prime/run/apply_wallpaper_policy.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run/apply_wallpaper_policy.rs)). So the bring-up ordering is that the compositor, wm,
input router, and wallpaper register before the shell. The market is best-effort and its absence never
blocks setup ([`src/setup/discover/try_market.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover/try_market.rs#L20)).

### The shell is up but the dock will not draw

The dock only paints when it is visible, and it auto-hides ([`src/render/chrome.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/chrome.rs#L36)). Reveal it by
moving the pointer into the bottom 4-pixel band or clicking within 18 pixels of the dock's top edge
([`src/server/input.rs:71`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/input.rs#L71), `input.rs:54`). If it never reveals, the input subscription is the suspect:
the loop re-subscribes each second while `input_ready` is false ([`src/server/runner/run.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L40),
[`src/setup/prime/run/subscribe_input.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run/subscribe_input.rs#L19)), and `subscribe_input` sets `input_ready` only on a
successful reply (`subscribe_input.rs:20`). If the whole overlay is blank, the split is registration
versus paint: `register_overlay` submits the scene once ([`src/setup/prime/register.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/register.rs#L49)) and
`paint_initial` retries the first full-screen damage commit up to eight times
([`src/server/paint_initial.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/paint_initial.rs#L24)); a blank overlay with a live loop points at the damage-commit path,
not the paint math.

### An app will not launch from the dock

The dock focuses, it does not spawn, so the target must already be running. `launcher_request` needs a
live service registration; a missing pid makes the click a no-op
([`src/server/handlers/launcher_request.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/launcher_request.rs#L36)). The dock's open and active state also depends on the wm
lifecycle subscription, re-armed each second while `wm_notify_ready` is false
([`src/server/runner/run.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L44), [`src/setup/prime/run/subscribe_wm.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run/subscribe_wm.rs#L20)), so an app that is running but
whose dock entry never lights up usually means the wm notification never arrived or the owner pid did not
resolve back to a dock index ([`src/server/wm_notify_app_index.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/wm_notify_app_index.rs#L21)).

### The splash never leaves the screen

The [boot splash](/docs/userland/boot-splash/) polls `lookup("desktop_shell")` and hands off once it
resolves ([`userland/capsule_boot_splash/src/main.rs:103`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_boot_splash/src/main.rs#L103)), so a splash that never clears usually means
the shell never registered its service. Check for the `[DESKTOP-SHELL]` boot line above.

### Tray, notify, or spotlight errors on the wire

Every served op replies with a status word ([`src/server/respond.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L21)). A bad body length or an empty or
oversized label is `E_INVAL`, a duplicate tray id for the same owner is `E_BUSY`, a full tray table is
`E_NOMEM`, and an update or remove of an id the caller does not own is `E_NOENT`
([`src/server/handlers/tray_register.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tray_register.rs#L24), `tray_register.rs:36`, `tray_register.rs:52`,
`tray_register.rs:56`, [`src/server/handlers/tray_update.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tray_update.rs#L40)). An unknown op with an empty body is
`E_BAD_OP`, and any other malformed op is `E_INVAL` ([`src/server/dispatch.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L34), `dispatch.rs:37`).
Header-level rejections (`E_BAD_MAGIC`, `E_BAD_LEN`, `E_BAD_VERSION`) come from the parser before dispatch
([`src/protocol/decode.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L39), `decode.rs:45`, `decode.rs:51`). A market health-check failure surfaces
inside the shell as a `market call failed` error rather than a protocol error to a tray caller, because
the market is a best-effort peer ([`src/market_client/mod.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/market_client/mod.rs#L51)).

## Source map

```
  src/userspace/init/capsule_boot/run.rs           [DESKTOP-SHELL] capsule spawned / error path
  src/userspace/init/spawn_plan/desktop_fleet.rs   the DESKTOP-SHELL fleet spawn entry
  src/wait_for_setup.rs                            retry setup::run until every peer is up
  src/setup/prime/peers.rs                         required vs best-effort peer resolution
  src/setup/discover/require_wallpaper.rs          the required wallpaper lookup
  src/setup/prime/run/subscribe_input.rs, subscribe_wm.rs  the self-healing subscriptions
  src/render/chrome.rs                             dock paints only when visible
  src/server/input.rs                              reveal bands and the launch hit-test
  src/server/paint_initial.rs                      the eight-try first damage commit
  src/server/handlers/launcher_request.rs          missing-pid no-op
  src/server/dispatch.rs                           E_BAD_OP / E_INVAL
  src/protocol/decode.rs                           header-level rejections
```

Every reference above is verified against those trees.
