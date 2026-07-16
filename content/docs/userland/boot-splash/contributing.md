---
title: "Contributing"
description: "This page covers where to work in the splash, how to change what it draws or how it talks to the system, and how to build and sign it."
weight: 8
---
This page covers where to work in the splash, how to change what it draws or how it talks to the system,
and how to build and sign it. The identity and capability mask are on the [README](/docs/userland/boot-splash/#identity);
what each module draws is on [rendering.md](/docs/userland/boot-splash/rendering/); runtime failure modes are on
[debugging.md](/docs/userland/boot-splash/debugging/).

## Module map

The source lives at `userland/capsule_boot_splash/src/`. It is nine small single-purpose modules declared
in `main.rs` ([`src/main.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L6) through `:14`):

| Module | Responsibility | File |
|--------|----------------|------|
| `main` | `_start`, `run`, the interaction loop, the `D` toggle, the handoff and dwell timing | [`src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs) |
| `proto` | the NCMP header builder, `call_status`, service `lookup`, compositor `healthcheck` | [`src/proto.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proto.rs) |
| `display` | the `OP_DISPLAY_INFO` query and geometry validation | [`src/display.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/display.rs) |
| `surface` | mmap, register, and share the one splash surface | [`src/surface.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/surface.rs) |
| `scene` | scene submit, damage commit, and remove at overlay Z | [`src/scene.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/scene.rs) |
| `input` | router subscribe, grab, release, and the key-frame parse | [`src/input.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input.rs) |
| `paint` | the splash frame, the attestation panel, the animated status band | [`src/paint.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs) |
| `detail` | the `D`-key detail view with the kernel and ZK hashes and flags | [`src/detail.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/detail.rs) |
| `chrome` | the panel border, title, and title rule | [`src/chrome.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/chrome.rs) |
| `vignette` | the radial background fill and the band redraw | [`src/vignette.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/vignette.rs) |

There is no app-skeleton and no `App` trait here. Unlike the [terminal](/docs/userland/terminal/), the splash
drives its own surface and its own loop directly, because it is an overlay that predates the window
manager rather than a normal window.

## How to change the splash

Match the change to the module:

- Layout and text (wordmark, subtitle, attestation panel, verdict wording, status line): [`src/paint.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs).
  The three fixed panel lines are at [`src/paint.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L53) through `:55`; the verdict strings and their colors
  are the `match attested` in `attest_panel` ([`src/paint.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L56) through `:61`).
- The detail view (which hashes and flags it shows): [`src/detail.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/detail.rs). The two flags are wired at
  [`src/detail.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/detail.rs#L46), `:47`.
- The background gradient: [`src/vignette.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/vignette.rs) (the center, falloff, and `CORE`/`BG` colors at `:17`, `:18`,
  `:25` through `:33`). The panel border and title chrome: [`src/chrome.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/chrome.rs).
- The animation cadence: the `el / 150` frame divisor in [`src/main.rs:128`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L128) and the `SPIN` glyph set in
  [`src/paint.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L28). The dwell and settle timing are the constants at the top of [`src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs)
  (`SETTLE_MS`, `MAX_DWELL_MS`, `MAX_ITERS`, `READY_ATTEMPTS` at `:25` through `:28`).
- The palette: the per-module `0xAARRGGBB` constants, listed in
  [rendering.md](/docs/userland/boot-splash/rendering/#colors).

Keep the renderer allocation-free per frame. The paint modules write directly into the shared surface
slice and allocate nothing on the draw path; the only allocations in the capsule are the IPC transmit and
receive buffers built in `proto`, `display`, and `scene` ([`src/proto.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proto.rs#L28), `:40`, [`src/display.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/display.rs#L32),
[`src/scene.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/scene.rs#L28)).

## How to change the wire protocol

If you add or change a compositor or router opcode, edit the module that owns that service and keep the
header builder in [`src/proto.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proto.rs) as the single source of the NCMP header ([`src/proto.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proto.rs#L27)). The
compositor ops live in [`src/scene.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/scene.rs) and [`src/display.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/display.rs); the input-router request and delivery formats
live in [`src/input.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input.rs). The magics and versions are constants at the top of `proto.rs` and `input.rs`
([`src/proto.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proto.rs#L22), `:23`, [`src/input.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input.rs#L19), `:20`, `:26`).

Two invariants to preserve:

- `call_status` expects a 24-byte reply (20-byte header plus a 4-byte status) and treats a nonzero status
  as an error ([`src/proto.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proto.rs#L40), `:42`, `:46`). A new compositor op that returns a longer body needs its
  own reader, as `display::query` already does for the display-info response ([`src/display.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/display.rs#L24), `:30`).
- Any new capability the change would require must be added in three places that must agree: the
  `CAPSULE_REQUIRED_CAPS` mask in `Capsule.mk:17`, the `requested_caps` in the kernel spawn
  ([`src/userspace/capsule_boot_splash/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_boot_splash/spawn.rs#L50) through `:54`), and the capsule's signed manifest
  ceiling. The spawn holds the requested caps against the manifest at verified spawn, so a mask that
  exceeds the manifest is rejected, not silently granted.

## Build and sign

The build, sign, and verify rules are generated from the slug `boot-splash` by `nonos-mk/capsule.mk`,
included through `userland/capsule_boot_splash/Capsule.mk:20`. The generated `.PHONY` names are at
`nonos-mk/capsule.mk:158` and the recipes at `:182`, `:184`, `:261`, `:263`:

```
  make nonos-mk-boot-splash              build the capsule ELF
  make nonos-mk-boot-splash-sign         produce the id cert, manifest, and attestation trailer
  make nonos-mk-boot-splash-verify       verify the signed artifacts against the trust anchor
  make nonos-mk-check-boot-splash-keys   check the per-capsule signing keys exist
```

There is no `boot-splash`-specific prod image target. The splash ships as a component of the desktop
images: `make nonos-mk-desktop-gui-prod` (`Makefile:1067`) and `make nonos-mk-full-gui-prod`
(`Makefile:1093`) both pull in `$(boot-splash_ARTIFACTS)` (`Makefile:1082`, `Makefile:1112`,
`Makefile:1134`).

## Code standards

- `cargo fmt` and a clean `cargo clippy`.
- No panics, `unwrap`, or `expect` on the capsule path. Every fallible step returns a `Result` or an
  `Option`, and `run` turns a failure into a numeric exit code rather than a panic (the `match` arms in
  [`src/main.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L38) through `:57`). The IPC readers guard their slice conversions with `map_err(|_| -11)`
  and `.ok()?` rather than unwrapping ([`src/proto.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/proto.rs#L45), [`src/input.rs:68`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/input.rs#L68)).
- Modular files, one unit per file, the arrangement already in place.
- The AGPL header at the top of every source file, matching the header already on every module here
  ([`src/paint.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L1) through `:15`).

Back to the [README hub](/docs/userland/boot-splash/).
