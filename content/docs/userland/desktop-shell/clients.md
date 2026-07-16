---
title: "The Outbound Clients and Setup"
description: "This page mirrors the outbound clients at the crate root (src/compositorclient/, src/wmclient/, src/inputrouterclient.rs, src/wallpaperclient/, src/marketclient/) and the setup ..."
weight: 3
---
This page mirrors the outbound clients at the crate root (`src/compositor_client/`, `src/wm_client/`,
[`src/input_router_client.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input_router_client.rs), `src/wallpaper_client/`, `src/market_client/`) and the setup sequence under
`src/setup/`. Everything the shell reaches outward is an IPC call to another service; its authority over
each is whatever that peer's own handler grants a caller, not anything the shell holds. For the served
side see [operations.md](/docs/userland/desktop-shell/operations/); for the state these fill see [state.md](/docs/userland/desktop-shell/state/).

## The peers

The shell coordinates six services plus the DHCP client. Each is a service lookup followed by a normal
request.

### Compositor

Service `compositor`, magic `NCMP` (`0x4E43_4D50`), version 1, 20-byte header
([`src/compositor_client/wire.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/compositor_client/wire.rs#L10), `wire.rs:11`, `wire.rs:12`):

```
  OP 0x0002   scene_submit    publish the overlay surface at z=1   compositor_client/scene_submit.rs:19
  OP 0x0003   damage_commit   present a changed rectangle          compositor_client/damage_commit.rs:19
  OP 0x0008   display_info    query width/height/stride/format     compositor_client/display_info.rs:21
  OP 0x0001   healthcheck     liveness probe                       compositor_client/wire.rs
```

`scene_submit` publishes the shared overlay handle at z-order 1 and fails if the compositor returns a
non-zero status (`scene_submit.rs:22`, `scene_submit.rs:40`). `damage_commit` sends the four-integer
rectangle to present (`damage_commit.rs:22`). `display_info` reads back width, height, stride, and format
and rejects a zero dimension or a non-ARGB8888 format (`display_info.rs:30`, `display_info.rs:40`).

### Window manager

Service `wm`, magic `NWMP` (`0x4E57_4D50`), version 1 ([`src/wm_client/mod.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wm_client/mod.rs#L32), `mod.rs:33`):

```
  OP 0x0002   window_open           open the taskbar popup window    wm_client/window_open.rs:26
  OP 0x0007   window_raise          raise the taskbar over an app    wm_client/window_raise.rs:26
  OP 0x0008   lifecycle_subscribe   subscribe to open/close events   wm_client/lifecycle_subscribe.rs:25
  OP 0x0001   healthcheck           liveness probe                   wm_client/mod.rs:36
```

Every wm call is a `mk_ipc_call_timeout` with a 250 ms reply timeout and a status check
(`window_open.rs:27`, `window_open.rs:52`, `window_open.rs:66`). The taskbar window is a popup (kind 3)
that the shell opens over the dock rectangle and can raise over an app when that app's window opens
([`src/setup/prime/open_chrome_windows.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/open_chrome_windows.rs#L22), `open_chrome_windows.rs:27`, [`src/server/wm_notify.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/wm_notify.rs#L50)).
The incoming `NWMV` lifecycle frame is the reply channel for the subscription and is handled on the
[operations](/docs/userland/desktop-shell/operations/) side, not here.

### Input router

Service `input_router`, magic `NIRS` (`0x4E49_5253`), `OP_SUBSCRIBE` = 2 with a kind mask
([`src/input_router_client.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input_router_client.rs#L21), `input_router_client.rs:26`, `input_router_client.rs:29`). The shell
subscribes to key-down, key-up, pointer-abs, wheel, button-down, button-up, and touch
([`src/setup/prime/run/input_mask.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run/input_mask.rs#L25)). Inbound input frames arrive separately as `NINP`
(`0x4E49_4E50`) and are decoded in [`src/server/input.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/input.rs#L29) (see [surface.md](/docs/userland/desktop-shell/surface/)).

### Wallpaper

Service `wallpaper`, magic `NWLP` (`0x4E57_4C50`), `OP_SET_POLICY` = 4
([`src/wallpaper_client/mod.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallpaper_client/mod.rs#L22), `mod.rs:26`). Setup pushes a policy value so the wallpaper is in place
before the chrome is submitted ([`src/setup/prime/run/apply_wallpaper_policy.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run/apply_wallpaper_policy.rs)). The wallpaper lookup is
required: if the wallpaper capsule is not up, setup fails with `wallpaper service not announced`
([`src/setup/discover/require_wallpaper.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover/require_wallpaper.rs#L19)).

### Market

Service `market.index`, magic `NMKT` (`0x4E4D_4B54`), `OP_HEALTHCHECK` = 6
([`src/market_client/mod.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/market_client/mod.rs#L22), `mod.rs:26`). The market is a best-effort peer: a zero port
short-circuits the health-check to success, and a missing market disables the probe entirely by setting
the `MARKET_DISABLED` flag ([`market_client/mod.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/market_client/mod.rs#L30), [`src/setup/discover/try_market.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover/try_market.rs#L20),
`try_market.rs:26`). Its absence never blocks setup.

### Policy and DHCP

Policy: service `policy`, `OP_GET` = 1, field `CLOCK_FORMAT24` = `0x0118`, used only to choose 12h vs 24h
in the clock ([`src/state/indicators/policy.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/indicators/policy.rs#L23), `policy.rs:24`, `clock.rs:24`). The policy port is
cached in the `Context` and re-resolved on a failed reply (`policy.rs:29`, `policy.rs:57`).

DHCP: network state is read from `net.dhcp.client`, magic `NDHC` (`0x4E44_4843`), `OP_LEASE_STATUS` = 3;
the segment is online only when the lease state is at least bound
([`src/state/indicators/net.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/indicators/net.rs#L19), `net.rs:20`, `net.rs:24`, `net.rs:56`).

## The overlay surface

The overlay itself is registered and shared through the microkernel surface calls, not a service.
`register_overlay` builds a `SurfaceDescriptor` for the ARGB8888 backing, calls `mk_surface_register`,
shares it with `mk_surface_share`, and submits the shared handle as a scene at z-order 1; on a submit
failure it releases the handle with `mk_surface_release`
([`src/setup/prime/register.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/register.rs#L41), `register.rs:45`, `register.rs:49`, `register.rs:59`). The `run/`
wrapper closes the chrome windows and unmaps the backing if registration fails
([`src/setup/prime/run/register_overlay.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run/register_overlay.rs#L24), `register_overlay.rs:26`).

## The setup sequence

`setup::run` builds the whole live context in one pass, and any error aborts the pass so
`wait_for_setup` retries it ([`src/setup/prime/run/run.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run/run.rs#L21), [`src/wait_for_setup.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L19)):

1. Resolve the peers. `peers::resolve` requires the compositor, input router, wm, and wallpaper, and
   tries the market best-effort; it health-checks the compositor as part of resolution
   ([`src/setup/prime/peers.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/peers.rs#L29), `peers.rs:30`, `peers.rs:34`). The compositor, input router, and wm
   are all required, so bring-up ordering is that those and the wallpaper register before the shell.
2. Health-check the peers, then apply the wallpaper policy (`run.rs:23`, `run.rs:24`).
3. Allocate the overlay, build the `Context`, and paint the initial chrome (`run.rs:25`, `run.rs:26`,
   `run.rs:27`).
4. Register and submit the overlay scene, then commit it (`run.rs:28`, `run.rs:29`).
5. Open the taskbar popup window, then subscribe to wm lifecycle and input-router events (`run.rs:30`,
   `run.rs:31`, `run.rs:32`).

Once the loop is running, the two subscriptions are self-healing: each second, `subscribe_input` and
`subscribe_wm` are re-armed while `input_ready` or `wm_notify_ready` is still false, and each sets its
ready flag only on a successful reply ([`src/server/runner/run.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L40), `run.rs:44`,
[`src/setup/prime/run/subscribe_input.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run/subscribe_input.rs#L19), [`src/setup/prime/run/subscribe_wm.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run/subscribe_wm.rs#L20)).

## Source map

```
  src/compositor_client/wire.rs        NCMP magic/version/header, build_request, call
  src/compositor_client/scene_submit.rs, damage_commit.rs, display_info.rs
  src/wm_client/mod.rs                 NWMP healthcheck; re-exports the ops
  src/wm_client/window_open.rs, window_raise.rs, lifecycle_subscribe.rs, window_close.rs
  src/input_router_client.rs           NIRS subscribe with the kind mask
  src/wallpaper_client/mod.rs          NWLP set_policy
  src/market_client/mod.rs             NMKT best-effort healthcheck
  src/state/indicators/policy.rs       policy OP_GET CLOCK_FORMAT24
  src/state/indicators/net.rs          NDHC lease-status probe
  src/setup/prime/register.rs          mk_surface_register/share/release + scene submit
  src/setup/prime/run/run.rs           the setup sequence
  src/setup/prime/peers.rs             required vs best-effort peer resolution
  src/setup/discover/                  require_compositor/input_router/wm/wallpaper, try_market
  src/setup/prime/run/input_mask.rs    the input kind mask
  src/setup/prime/run/subscribe_input.rs, subscribe_wm.rs  self-healing subscriptions
```

Every reference above is verified against those trees.
