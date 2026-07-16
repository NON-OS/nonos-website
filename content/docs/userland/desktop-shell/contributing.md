---
title: "Contributing to capsule_desktop_shell"
description: "This page is for a contributor who wants to change the shell."
weight: 5
---
This page is for a contributor who wants to change the shell. It covers where the source lives, which
folder owns which behaviour, the exact steps to add a dock app or a status indicator, how to build and
sign the capsule, and the code standards a change has to meet. For what the shell does and how it is put
together, read the [README](/docs/userland/desktop-shell/), the [surface](/docs/userland/desktop-shell/surface/), the [operations](/docs/userland/desktop-shell/operations/), the
[clients](/docs/userland/desktop-shell/clients/), and the [state](/docs/userland/desktop-shell/state/) pages in this folder.

## Where the source lives

The capsule is at `userland/capsule_desktop_shell/`. It is a `no_std`/`no_main` capsule that supplies its
own frame protocol and its own paint routines: `_start` initializes the heap, blocks in `wait_for_setup`,
then runs the server loop ([`src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L37), [`src/main.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L41)). The top-level modules are declared there
([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/render/` | the overlay paint: menu bar, dock entries, status, icons, spotlight, toasts | you change how any chrome is drawn |
| `src/server/` | the served side: the loop, dispatch, the six handlers, launcher focus, wm lifecycle | you change what a served op does or add one |
| `src/protocol/` | the `NDSH` frame: header, ops, limits, parse, respond, errno | you change the wire format or a body length |
| `src/state/` | the live model: `Context`, the app list, taskbar, tray, toasts, spotlight, indicators | you change what is remembered or an indicator source |
| `src/setup/` | bring-up: peer discovery, overlay registration, subscriptions | you change the startup sequence |
| crate root clients | the outbound wires (`compositor_client`, `wm_client`, `input_router_client`, `wallpaper_client`, `market_client`) | you change how the shell talks to a peer |

## Adding a dock app

The dock sizes itself from the app array, so most of the work is one array entry plus an icon.

1. Add a `LauncherApp` to the `LAUNCHER_APPS` array with a `LauncherIcon`, a label, and the `app.*`
   service handle it should focus ([`src/state/apps.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/apps.rs#L36)). Add the matching `LauncherIcon` variant
   (`apps.rs:18`).
2. Add the icon bitmap. Create one file per icon under `src/render/icons/`, next to the existing ones,
   declare it as a module, and add a match arm in `draw_app_icon` for the new `LauncherIcon` variant
   ([`src/render/icons.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/icons.rs#L35), `icons.rs:47`).
3. Nothing else needs a constant change. The taskbar open and pulse arrays, the dock width, the hit-test,
   and the wm-index resolver all derive from `LAUNCHER_APPS.len()` ([`src/state/taskbar/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/taskbar/types.rs#L17),
   [`src/render/layout.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/layout.rs#L21), [`src/server/handlers/launcher_focus.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/launcher_focus.rs#L27),
   [`src/server/wm_notify_app_index.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/wm_notify_app_index.rs#L22)). Confirm the new column still fits: `bottom_dock_rect` clamps
   the dock to the display width ([`src/render/layout.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/layout.rs#L39)).

## Adding or changing a status indicator

The status area is a fixed ordered set of segments in `paint_status` ([`src/render/status.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/status.rs#L38)). To
change the set or order, edit that segment array and the glyph accounting around it (`status.rs:38`,
`status.rs:41`). Each segment's value comes from a data source under `src/state/indicators/`
(`battery.rs`, `net.rs`, `clock.rs`, `policy.rs`); add a new file there for a new source, keep it live
(read on demand rather than cached), and format it into a small fixed buffer the way the existing ones
do. There are no click targets in the status area, so a new indicator is display-only unless you also
extend the input path in [`src/server/input.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/input.rs).

## Adding a served operation

A new op is one op code, one handler, and one dispatch arm.

1. Add the op constant to [`src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs) and any fixed body length to [`src/protocol/limits.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs).
2. Write the handler as one file under `src/server/handlers/`, following the shape of the tray and notify
   handlers: validate the body length first, validate each field, mutate state, repaint the affected
   rectangle, commit damage, and reply with `respond::status` ([`src/server/handlers/notify.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/notify.rs#L26),
   `notify.rs:49`, `notify.rs:54`).
3. Add a match arm in `dispatch` for the new op; require an empty body with an `if body.is_empty()` guard
   if the op takes no arguments, the way healthcheck and spotlight do ([`src/server/dispatch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L26),
   `dispatch.rs:31`).

## Build and sign

The per-slug make targets are generated from the `NONOS_CAPSULE_RULES` template in
`nonos-mk/capsule.mk:156` and instantiated at `capsule.mk:272`, pulled in through
`userland/capsule_desktop_shell/Capsule.mk:19`.

```
  make nonos-mk-desktop-shell              build the capsule ELF                       capsule.mk:182
  make nonos-mk-desktop-shell-sign         produce the id cert, manifest, attestation  capsule.mk:261
  make nonos-mk-desktop-shell-verify       verify the artifacts vs the trust anchor    capsule.mk:263
  make nonos-mk-check-desktop-shell-keys   assert the per-capsule signing keys exist   capsule.mk:184
```

For a running desktop that includes the shell:

```
  make nonos-mk-desktop-gui-prod   attested desktop GUI image (bundles desktop-shell)   Makefile:1067, 1079
  make nonos-mk-full-gui-prod      full GUI feature profile (bundles desktop-shell)     Makefile:1093, 1109
```

Both image targets pull in `$(desktop-shell_ARTIFACTS)` (`Makefile:1079`, `Makefile:1109`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every handler reports an error as a
  status word, never a panic, and the workspace release profile is `panic = "abort"` (`Cargo.toml:826`).
- One unit per file, and `mod.rs` used only for re-exports, matching the existing tree ([`src/state/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/mod.rs),
  [`src/server/handlers/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_desktop_shell/src/main.rs        _start -> heap, wait_for_setup, server::run; the modules
  userland/capsule_desktop_shell/src/render/        the overlay paint (chrome, dock, status, icons)
  userland/capsule_desktop_shell/src/server/        the loop, dispatch, handlers, launcher, wm lifecycle
  userland/capsule_desktop_shell/src/protocol/      the NDSH header, ops, limits, parse, respond, errno
  userland/capsule_desktop_shell/src/state/         Context, apps, taskbar, tray, toasts, spotlight, indicators
  userland/capsule_desktop_shell/src/setup/         peer discovery, overlay registration, subscriptions
  userland/capsule_desktop_shell/Capsule.mk         slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                               the nonos-mk-desktop-shell[-sign|-verify|-keys] templates
  Makefile                                          the desktop-gui-prod and full-gui-prod image targets
```

Every reference above is verified against those trees.
