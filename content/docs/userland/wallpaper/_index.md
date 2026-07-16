---
title: "The Wallpaper Capsule"
description: "capsulewallpaper paints the desktop background."
weight: 400
---
`capsule_wallpaper` paints the desktop background. It is a signed userland capsule that owns one
full-screen surface at the bottom of the compositor's Z order, reads the selected wallpaper index from
the [policy store](/docs/userland/policy/), streams that image out of the
[wallpaper catalog](/docs/userland/wallpaper-catalog/) in bounded chunks, decodes and paints it into its
backing surface, and asks the compositor to composite the result. It also answers a small control
protocol for setting a flat background color, changing the fit policy, and fading the background alpha.
Its source is organized into a handful of top-level modules, and this documentation mirrors that
structure one page per pillar so a page can be read beside the folder it describes.

## Overview

The wallpaper capsule is a background painter. It is `no_std`/`no_main`; `_start` initializes the heap,
runs setup, and then enters the server loop that never returns
([`userland/capsule_wallpaper/src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/main.rs#L37)). Setup discovers the compositor, allocates a backing
surface the size of the display, registers that surface at the bottom Z layer, and primes it with an
image; the loop then drains its own control IPC, polls the policy store for a wallpaper change, and paces
any active fade against the display's vsync clock ([`src/server/runner/entry.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/entry.rs#L30)).

Everything the capsule paints goes into a private surface it owns. It never presents to the framebuffer
itself: it writes ARGB pixels into the mapped backing buffer and asks the compositor to commit the
damaged region, and the compositor composites the wallpaper under every window. That single fact is the
whole shape of its security posture. Because it lacks `GraphicsPresent`, a compromise is bounded to
painting garbage into a layer the compositor still keeps beneath every window.

## Identity

Everything the kernel and the service registry need to name and reach the wallpaper capsule comes from
its `Capsule.mk` and the kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `wallpaper` | `Capsule.mk:1` |
| Service handle | `wallpaper` | `Capsule.mk:2`, [`src/userspace/capsule_wallpaper/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_wallpaper/spawn.rs#L31) |
| Namespace | `systems.nonos.wallpaper` | `Capsule.mk:7` |
| Service endpoint | `service:4340:wallpaper` | `Capsule.mk:8`, `spawn.rs:31`, `spawn.rs:32` |
| Reply endpoint | `reply:4341:endpoint.wallpaper.reply` | `Capsule.mk:9`, `spawn.rs:33`, `spawn.rs:34` |
| Capability mask | `0x1819` | `Capsule.mk:12` |
| Binary name | `wallpaper` | `Capsule.mk:5` |
| Kernel mirror | `src/userspace/capsule_wallpaper` | `Capsule.mk:13` |

The mask `0x1819` decomposes into five bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|-----|-------|--------|
| CoreExec | `0x0001` | run as a process (`types.rs:56`) |
| IPC | `0x0008` | send and receive on its endpoints (`types.rs:59`) |
| Memory | `0x0010` | map its own heap, stack, and backing surface (`types.rs:60`) |
| GraphicsDisplayQuery | `0x0800` | ask the compositor for the display geometry (`types.rs:67`) |
| GraphicsSurfaceCreate | `0x1000` | create the one surface it draws into (`types.rs:68`) |

```
  0x1819 = 0x0001 + 0x0008 + 0x0010 + 0x0800 + 0x1000
```

The kernel spawn path requests exactly those five capabilities and no others
([`src/userspace/capsule_wallpaper/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_wallpaper/spawn.rs#L50)). There is no `Network` bit (`0x0004`, `types.rs:58`), no
`FileSystem` bit (`0x0040`, `types.rs:62`), no hardware, driver, MMIO, or DMA capability, and in
particular no `GraphicsPresent` bit (`0x4000`, `types.rs:70`). It can create a surface, ask the display
for its geometry, and speak IPC; it cannot present to the screen, which is what keeps the compositor in
the middle. Compromising the wallpaper yields the wallpaper's mask and nothing more.

## The pillars

The source under `userland/capsule_wallpaper/src/` splits cleanly into two behaviours: the control
protocol the capsule serves, and the selection-to-pixels pipeline it drives on its own. The
documentation is one page each, plus a contributing and a debugging page.

```
  a request comes in         ->  operations  ->  a reply, and maybe a repaint
  a policy change is polled   ->  pipeline    ->  fetch, decode, paint, commit damage
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [operations.md](/docs/userland/wallpaper/operations/) | `src/protocol/`, `src/server/` | The `NWLP` control protocol: the header and parser, the five ops (`HEALTHCHECK`, `SET_WALLPAPER`, `GET_WALLPAPER`, `SET_POLICY`, `FADE`), the dispatch, the reply framing, the write gate on `SET_WALLPAPER`, and the fade pacer. |
| [pipeline.md](/docs/userland/wallpaper/pipeline/) | `src/subscriber/`, `src/policy_client/`, `src/catalog_client/`, `src/paint/`, `src/decode_client/`, `src/compositor_client/` | Selection from the policy store, the 300-tick re-poll, the chunked catalog fetch, the in-process decode, the always-stretch paint, and the drive to the compositor. |
| [contributing.md](/docs/userland/wallpaper/contributing/) | the whole tree | Where to work, how to change scaling or fetching, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/wallpaper/debugging/) | runtime | The boot marker, the failure modes (blank background, wrong wallpaper, no background layer, `E_ACCES`), and where to look for each. |

## Lifecycle

The wallpaper is spawned through the desktop fleet's verified spawn: its signature and attestation are
checked, its requested capabilities are held against its manifest ceiling, and only then is its ELF
mapped ([`src/userspace/init/spawn_plan/desktop_fleet.rs:109`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L109), [`src/userspace/capsule_wallpaper/spawn.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_wallpaper/spawn.rs#L40)).

1. `_start` initializes the heap, exiting with code 1 on failure, then calls `wait_for_setup`, which
   retries `setup::run` with a yield backoff until it succeeds ([`src/main.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L38),
   [`src/wait_for_setup.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L19)).
2. Setup discovers the compositor by name, retrying up to 256 times and giving up with
   `"compositor service not announced"` if the lookup never resolves ([`src/setup/discover.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover.rs#L32)). It then
   healthchecks the compositor, queries the display geometry, and `mmap`s a backing buffer sized
   `stride * height` ([`src/setup/prime/run.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run.rs#L31), [`src/setup/prime/backing.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/backing.rs#L34)).
3. It fills the buffer with the default color `0xFF0080FF`, decodes and paints the embedded boot JPEG,
   then registers the surface with `mk_surface_register`, `mk_surface_share`, and a `scene_submit` at Z 0
   ([`src/setup/prime/run.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run.rs#L33), [`src/setup/prime/run.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run.rs#L51), [`src/setup/prime/register.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/register.rs#L41)). The
   policy and catalog ports are looked up here, tolerating absence.
4. Setup applies the policy-selected wallpaper synchronously if the policy port resolved, marking it
   applied so the subscriber will not repeat the work ([`src/setup/prime/run.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/prime/run.rs#L62)).
5. The server loop drains control IPC non-blocking, runs the subscriber poll, and then either paces an
   active fade or waits for vsync when idle ([`src/server/runner/entry.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/entry.rs#L30)).

A successful spawn prints `[WALLPAPER] capsule spawned` on the boot log; the [debugging](/docs/userland/wallpaper/debugging/)
page covers what an absent line means.

## Source map

```
  userland/capsule_wallpaper/src/main.rs             heap init, wait_for_setup, server::run
  userland/capsule_wallpaper/src/setup/              compositor wait, backing mmap, register, apply policy
  userland/capsule_wallpaper/src/protocol/           NWLP header, ops, errnos, limits, parse/encode
  userland/capsule_wallpaper/src/server/             drain IPC, dispatch, handlers, respond, fade pacer
  userland/capsule_wallpaper/src/subscriber/         policy poll and the fetch/decode/paint/commit apply
  userland/capsule_wallpaper/src/policy_client/      OP_GET Field::Wallpaper
  userland/capsule_wallpaper/src/catalog_client/     OP_GET_SIZE / OP_GET_CHUNK image streaming
  userland/capsule_wallpaper/src/paint/              fill_argb, decode_jpeg, blit_argb, paint_image
  userland/capsule_wallpaper/src/decode_client/      inline image decode (png/bmp/lz4/jpeg, in-process)
  userland/capsule_wallpaper/src/compositor_client/  health, display_info, scene_submit, damage_commit
  userland/capsule_wallpaper/src/state/              color, alpha, policy, fade, ports, applied index
  userland/capsule_wallpaper/Capsule.mk              slug, handle, ports 4340/4341, caps 0x1819
  src/capabilities/types.rs                          the capability bits
  src/userspace/capsule_wallpaper/spawn.rs           the kernel-side verified spawn, requested caps
  src/userspace/init/spawn_plan/desktop_fleet.rs     the desktop-fleet spawn entry
```

Every reference above is verified against those trees.
