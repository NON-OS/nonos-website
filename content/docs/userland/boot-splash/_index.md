---
title: "The Boot Splash Capsule"
description: "capsulebootsplash is the first thing a NØNOS user sees."
weight: 400
---
`capsule_boot_splash` is the first thing a NØNOS user sees. The loader hands off to the kernel, the
kernel brings up the display core, and before the desktop fleet finishes spawning this capsule paints a
fullscreen splash that carries the boot-chain attestation status. It registers no service of its own; it
is a pure compositor client that draws a splash, reads the kernel's attestation, holds the screen while
the desktop comes up, and exits to hand off. Its source is a small nine-module tree, and this
documentation mirrors that tree so a page can be read beside the folder it describes.

The short version of what it is lives in the [desktop overview](/docs/userland/desktop-fleet/); the real
attestation check it only displays lives under [attest](/docs/userland/attest/) and the
[proof system](/docs/subsystems/proof-system/).

## Identity

Everything the kernel and the service registry need to name the splash comes from its `Capsule.mk` and
its kernel-side spawn record.

| Field | Value | Source |
|-------|-------|--------|
| Slug | `boot-splash` | `userland/capsule_boot_splash/Capsule.mk:8` |
| Service handle | `app.boot_splash` | `Capsule.mk:9`, [`src/userspace/capsule_boot_splash/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_boot_splash/spawn.rs#L31) |
| Binary name | `boot_splash` | `Capsule.mk:12` |
| Namespace | `systems.nonos.app.boot_splash` | `Capsule.mk:14` |
| Service endpoint | `service:4796:app.boot_splash` | `Capsule.mk:15`, `spawn.rs:31`, `:32` |
| Reply endpoint | `reply:4797:endpoint.app.boot_splash.reply` | `Capsule.mk:16`, `spawn.rs:33`, `:34` |
| Capability mask | `0x1819` | `Capsule.mk:17` |
| Kernel mirror | `src/userspace/capsule_boot_splash` | `Capsule.mk:18` |

The mask `0x1819` decomposes into five bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants | Source |
|-----|-------|--------|--------|
| CoreExec | `0x0001` | run as a process | `types.rs:56` |
| IPC | `0x0008` | send and receive on its endpoints | `types.rs:59` |
| Memory | `0x0010` | map its own heap and surface buffer | `types.rs:60` |
| GraphicsDisplayQuery | `0x0800` | ask the compositor for the display geometry | `types.rs:67` |
| GraphicsSurfaceCreate | `0x1000` | register the one surface it draws into | `types.rs:68` |

`0x1819 = 0x0001 + 0x0008 + 0x0010 + 0x0800 + 0x1000`. The kernel spawn path requests exactly those five
capabilities and no others ([`src/userspace/capsule_boot_splash/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_boot_splash/spawn.rs#L50) through `:54`). This is the
same leaf-renderer mask the [wallpaper](/docs/userland/wallpaper/), [login](/docs/userland/login/), and
[setup wizard](/docs/userland/setup-wizard/) capsules carry: it can query the display, register one surface,
and speak IPC, and nothing else. There is no `GraphicsSurfaceMap` bit (`0x2000`, `types.rs:69`), no
`GraphicsPresent` bit (`0x4000`, `types.rs:70`), and no network, filesystem, crypto, hardware, driver, or
DMA bit. Compromising the splash yields the splash's mask and nothing more.

One identity quirk that the [desktop overview](/docs/userland/desktop-fleet/) flags: the `Capsule.mk` reserves
`service:4796:app.boot_splash` and a reply port on 4797, and the kernel registers the service and its
reply inbox at spawn (`spawn.rs:31` through `:34`), but the capsule code never binds or receives on 4796.
It is a pure client, so the reserved endpoint exists in the record but is never a surface anyone looks it
up on. The verification is direct: nothing in `src/` calls a bind or a receive keyed on 4796, and the only
receive the loop makes is on port 0 ([`src/main.rs:112`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L112)).

## The pages

The source under `userland/capsule_boot_splash/src/` is nine small modules. Because the capsule is a
single linear program rather than four subsystems, the documentation is one rendering page plus the
contributing and debugging pages, and the hub carries the identity, the lifecycle, and the protocol.

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [rendering.md](/docs/userland/boot-splash/rendering/) | `paint`, `detail`, `chrome`, `vignette` | What the splash draws: the vignette background, the wordmark and subtitle, the attestation panel and its verdict, the spinner band, and the `D`-key detail view. |
| [contributing.md](/docs/userland/boot-splash/contributing/) | the whole tree | Where to work, how to change the splash or its wire protocol, the build and sign make targets, and the code standards. |
| [debugging.md](/docs/userland/boot-splash/debugging/) | runtime | The boot marker, the exit codes, and where to look when the splash does not appear, does not hand off, or the `D` key does nothing. |

The protocol client modules (`proto`, `display`, `surface`, `scene`, `input`) and the main loop are
documented in the lifecycle and protocol sections below rather than a separate page, because they are thin
wrappers over two IPC services and one syscall.

## Lifecycle

The capsule is `no_std`/`no_main`. `_start` initializes the heap and runs a single linear sequence, with
no long-lived server loop ([`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31), `:38`):

```
  run():
      comp = wait_compositor()                      // lookup + healthcheck, up to 256 tries
      (w, h, stride) = display::query(comp)          // NCMP display-info
      (base, handle) = surface::setup(w, h, stride)  // mmap + register + share one surface
      badge = mk_attest_status(&att) == 0 ? Some(att.zk_verified == 1) : None
      paint::splash(base, w, h, stride, badge)
      scene::submit(comp, handle); scene::damage(comp)
      grabbed_interact(...)                          // grab keys, spin, wait for desktop_shell, D toggles detail
      scene::remove(comp); mk_surface_release(handle)
```

Step by step:

1. The kernel spawns the capsule at boot through the desktop-fleet plan, which brings up the display core
   early (input router, compositor, then the splash) and calls the idempotent `spawn_boot_splash` guarded
   by an `is_alive` check ([`src/userspace/init/spawn_plan/desktop_fleet.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L27), `:32`, `:34`, `:43`,
   `:45`). The spawn is [verified spawn](/docs/security/capsules-and-trust/): it checks the embedded ELF,
   id cert, manifest, and attestation trailer, holds the requested caps against the manifest ceiling, and
   registers `app.boot_splash` on port 4796 ([`src/userspace/capsule_boot_splash/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_boot_splash/spawn.rs#L37), `:57`). On
   success the boot path logs `[BOOT-SPLASH] capsule spawned` (`desktop_fleet.rs:48` through `:53`,
   [`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)).
2. `run` waits for the compositor, queries the display, sets up the surface, reads the attestation, paints
   the first frame, submits and damages the scene, and enters the interaction loop
   ([`src/main.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L38) through `:62`).
3. `grabbed_interact` looks up the input router; if it is present the splash subscribes to keys and takes
   an exclusive key grab for the duration, then releases it on the way out
   ([`src/main.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L65), `:70`, `:71`, `:73`). If the router is absent it interacts without a grab
   ([`src/main.rs:68`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L68)).
4. The loop animates the spinner, processes any key delivery (the `D` toggle), and watches for
   `desktop_shell` to register ([`src/main.rs:97`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L97) through `:137`).
5. When `desktop_shell` appears the splash records the time, waits a one-second settle so the desktop
   paints behind the overlay, then breaks the loop; a thirty-second dwell cap and an eight-million
   iteration ceiling are the fallbacks so the splash can never hang
   ([`src/main.rs:103`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L103), `:106`, `:108`; `SETTLE_MS`, `MAX_DWELL_MS`, `MAX_ITERS` at `:25` through `:27`).
6. On exit the scene is removed and the surface released, freeing the screen for the desktop
   ([`src/main.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L60), `:61`).

The distinctive job is the attestation badge. The splash reads the kernel's attestation status and paints
a boot-chain panel with an `ATTESTED`, `UNVERIFIED`, or `verifying` verdict; pressing `D` opens a detail
view with the kernel hash and the ZK program hash ([`src/main.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L52), [`src/paint.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L56), [`src/detail.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/detail.rs#L33)).
It **displays** the kernel's attestation; it does not verify a proof itself. See
[rendering.md](/docs/userland/boot-splash/rendering/#the-attestation-panel) for the verdict wiring and
[Security](#security) below for why that distinction matters.

## Protocol and IPC

The splash exposes no application opcodes. Everything it does that leaves the capsule is an outbound IPC
call, and it talks to exactly two services plus one syscall.

Compositor, service `compositor`, NCMP magic `0x4E43_4D50`, version 1, 20-byte header
([`src/proto.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proto.rs#L22), `:23`, `:24`, `:27`):

```
  OP_HEALTHCHECK    0x0001    liveness probe during wait_compositor   proto.rs:25
  OP_SCENE_SUBMIT   0x0002    attach the shared surface at overlay Z  scene.rs:19, :27
  OP_DAMAGE_COMMIT  0x0003    commit a damage rectangle               scene.rs:20, :39
  OP_SCENE_REMOVE   0x0007    detach the scene on exit                scene.rs:21, :48
  OP_DISPLAY_INFO   0x0008    query width, height, stride             display.rs:23, :30
```

The submit places the surface at `OVERLAY_Z = 4_000_000` so the splash sits above ordinary windows while
it holds the screen ([`src/scene.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/scene.rs#L25), `:34`). The display query rejects a zero width, height, or stride
([`src/display.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/display.rs#L43)). Every compositor call goes through `call_status`, which reads back a 24-byte
header-plus-status reply and treats a nonzero status as an error ([`src/proto.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proto.rs#L39), `:42`, `:46`).
`lookup` returns a port only if the syscall succeeds and both pid and port are nonzero
([`src/proto.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proto.rs#L53), `:57`).

Input router, service `input_router`, request magic `0x4E49_5253`, delivery magic `0x4E49_4E50`
([`src/input.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input.rs#L19), `:26`):

```
  OP_SUBSCRIBE      0x0002    subscribe to the key kinds (mask 0b11)  input.rs:22, :52
  OP_GRAB_REQUEST   0x0003    take an exclusive key grab              input.rs:23, :56
  OP_GRAB_RELEASE   0x0004    release the grab on exit                input.rs:24, :60
```

Key events are not received on the reserved service port. The subscribe-and-grab arrangement causes the
router to deliver key frames to the capsule's inbox, and the loop reads them with `mk_ipc_recv_from(0,
...)` on port 0 with a 50 ms timeout, then parses the 40-byte delivery frame for the key kind and code
([`src/main.rs:112`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L112), [`src/input.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input.rs#L27), `:64` through `:73`).

The kernel status read is a plain syscall, not IPC. `mk_attest_status` fills an `AttestStatus` with
`zk_verified`, `kernel_sig_ok`, `secure_boot`, `zk_attestation_ok`, and the two 32-byte hashes
([`userland/libc/src/attest.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/attest.rs#L21), `:30`), called once at [`src/main.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L52).

## Security

The splash is deliberately one of the least privileged capsules in the tree. Its mask `0x1819` grants
CoreExec, IPC, Memory, GraphicsDisplayQuery, and GraphicsSurfaceCreate and nothing else
(`Capsule.mk:17`, [`src/userspace/capsule_boot_splash/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_boot_splash/spawn.rs#L50) through `:54`). Beyond mmapping one
surface, drawing into it, talking to the compositor and the input router, and reading one status word, it
cannot reach anything. It holds no crypto, filesystem, network, hardware, driver, MMIO, or DMA capability,
and it holds no `GraphicsPresent`, so it never touches a framebuffer directly; the compositor owns
presentation.

- It displays, it does not verify. This is the point worth restating. The badge is `mk_attest_status`'s
  `zk_verified` field, read out of the kernel and painted verbatim ([`src/main.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L52), [`src/paint.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L56)).
  The splash has no `Crypto` capability and runs no verifier. The trust in that green `ATTESTED` line is
  the kernel's and the bootloader's attestation, not the splash's. A compromised splash could paint a
  green badge on an unverified system, but it could not make the system actually verified, and it could
  not weaken a real verification, because it is strictly downstream of the measurement. The
  [attest](/docs/userland/attest/) page and the [proof system](/docs/subsystems/proof-system/) carry
  the real check.
- The key grab is a router grant, not a splash power. The splash takes an exclusive key grab so it can
  read the `D` toggle without other windows stealing focus ([`src/main.rs:71`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L71)). That grab is only honored
  because the input router trusts the caller by name: its grabber allowlist is exactly three names,
  `app.boot_splash`, `app.setup_wizard`, and `app.input_probe`, checked against the live pid before any
  grab is granted ([`userland/capsule_input_router/src/server/handlers/grab_request.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/handlers/grab_request.rs#L25), `:33`). A
  capsule not on that list gets `E_ACCES`. The authority lives in the router, gated by identity; the
  splash merely qualifies, and it releases the grab and exits when the shell comes up ([`src/main.rs:73`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L73)).
- Isolation is the kernel's. The surface is a private anonymous mapping the splash registers and later
  releases ([`src/surface.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/surface.rs#L24), `:47`, [`src/main.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L61)); it holds no persistent state and writes no
  files. Separation from every other capsule is enforced by the kernel: the splash is a CPL 3 user binary
  verified and enrolled at spawn like every other capsule, and it only ever speaks IPC and its own
  surface.

## Source map

```
  userland/capsule_boot_splash/src/main.rs      _start, run, the interaction loop, handoff, D toggle
  userland/capsule_boot_splash/src/proto.rs     NCMP header, call_status, lookup, healthcheck
  userland/capsule_boot_splash/src/display.rs   OP_DISPLAY_INFO query, geometry validation
  userland/capsule_boot_splash/src/surface.rs   mmap + register + share the single splash surface
  userland/capsule_boot_splash/src/scene.rs     scene submit / damage / remove at overlay Z
  userland/capsule_boot_splash/src/input.rs     router subscribe / grab / release, key-frame parse
  userland/capsule_boot_splash/src/paint.rs     the splash frame and the attestation verdict
  userland/capsule_boot_splash/src/detail.rs    the D-key detail view (kernel + ZK hashes, flags)
  userland/capsule_boot_splash/src/chrome.rs    panel border, title, and title rule
  userland/capsule_boot_splash/src/vignette.rs  the radial background fill and band redraw
  userland/capsule_boot_splash/Capsule.mk       slug, handle, reserved endpoint, capability mask
  userland/libc/src/attest.rs                   AttestStatus and mk_attest_status
  src/capabilities/types.rs                     the capability bit values
  src/userspace/capsule_boot_splash/spawn.rs    the kernel-side verified spawn and requested caps
  src/userspace/init/spawn_plan/desktop_fleet.rs   the early-display fleet entry
  userland/capsule_input_router/src/server/handlers/grab_request.rs   the three-name grab allowlist
  nonos-mk/capsule.mk                           the generated nonos-mk-boot-splash[-sign|-verify] targets
```

Everything here is drawn from those trees. Every reference above is verified against them.
