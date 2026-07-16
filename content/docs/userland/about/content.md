---
title: "About content"
description: "The about window carries exactly five sections, always in the same order: Identity, Authority, Display, Uptime, and License (src/about/section.rs:26)."
weight: 1
---
The about window carries exactly five sections, always in the same order: Identity, Authority, Display,
Uptime, and License ([`src/about/section.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section.rs#L26)). Every value they show comes from one place: the baked
facts under `src/about/data/`, or one of two live syscalls. This page walks the facts and then each
section row by row. For how those rows reach the screen see [rendering](/docs/userland/about/rendering/); for the wider
capsule see the [about overview](/docs/userland/about/).

## Where the facts come from

`src/about/data/` is the app's fact table. Most of it is compile-time constants; two modules read the
kernel live at paint time.

| Module | Holds | Source |
|---|---|---|
| [`data/product.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/product.rs) | product name, tagline, copyright, homepage | [`data/product.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/product.rs#L17) |
| [`data/build.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/build.rs) | crate version, git SHA, toolchain, target arch | [`data/build.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/build.rs#L17) |
| [`data/abi.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/abi.rs) | the ABI name `Mk` | [`data/abi.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/abi.rs#L17) |
| [`data/caps.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/caps.rs) | the full capability table and the app's mask | [`data/caps.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/caps.rs#L23), [`data/caps.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/caps.rs#L47) |
| [`data/trust.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/trust.rs) | the trust-chain, scheme, manifest, cert, and status strings | [`data/trust.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/trust.rs#L17) |
| [`data/display.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/display.rs) | the live primary-display size read | [`data/display.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/display.rs#L19) |
| [`data/uptime.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/uptime.rs) | the live wall-clock read and its day/hour/minute/second split | [`data/uptime.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/uptime.rs#L19) |
| [`data/license.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/license.rs) | the license name, version, URL, and the embedded `LICENSE` text | [`data/license.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/license.rs#L17) |

The version and commit are stamped at build time: `VERSION` is the crate's `CARGO_PKG_VERSION`
([`data/build.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/build.rs#L17)) and `GIT_SHA` is `ABOUT_GIT_SHA`, resolved by the build script from
`NONOS_BUILD_SHA`, then `GITHUB_SHA`, then `git rev-parse --short=12 HEAD`, falling back to `unknown`
([`data/build.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/build.rs#L18), `build.rs:30`). The architecture is a `cfg`-selected string: `x86_64`, `aarch64`,
`riscv64`, or `unknown` ([`data/build.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/build.rs#L21)). The license body is the repository `LICENSE` file embedded
with `include_str!` ([`data/license.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/license.rs#L21)).

## Identity section

Nine label/value rows ([`src/about/section_render/identity.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/identity.rs#L25)). Its `LINE_COUNT` is a fixed `9`
(`identity.rs:22`):

| Row | Value | Source |
|---|---|---|
| Product | `NØNOS` | `identity.rs:26`, [`data/product.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/product.rs#L17) |
| Tagline | `Capability-based RAM-resident microkernel` | `identity.rs:27`, [`data/product.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/product.rs#L18) |
| Homepage | `https://nonos.systems` | `identity.rs:28`, [`data/product.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/product.rs#L20) |
| Copyright | `(c) 2026 NØNOS Contributors` | `identity.rs:29`, [`data/product.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/product.rs#L19) |
| Version | the crate's `CARGO_PKG_VERSION` (currently `0.1.0`) | `identity.rs:30`, [`data/build.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/build.rs#L17), `Cargo.toml:11` |
| Commit | the 12-char git SHA baked at build time | `identity.rs:31`, [`data/build.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/build.rs#L18), `build.rs:22` |
| Toolchain | `nightly-2026-01-16` | `identity.rs:32`, [`data/build.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/build.rs#L19) |
| Architecture | `x86_64`, `aarch64`, or `riscv64` per the build target | `identity.rs:33`, [`data/build.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/build.rs#L21) |
| ABI | `Mk` | `identity.rs:34`, [`data/abi.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/abi.rs#L17) |

## Authority section

The capsule's own capability report, and the reason the app exists to be read. It opens with six fixed
rows describing the trust chain, then lists every granted capability with its role, then a `Denied:`
header and the name of every capability the mask does not grant ([`src/about/section_render/authority.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/authority.rs#L31)).
Its line count is computed at runtime from the capability table, so it needs no hand-maintained constant
(`authority.rs:25`).

The six fixed rows (`authority.rs:37`):

| Row | Value | Source |
|---|---|---|
| Chain | `trust-anchor -> publisher -> capsule` | `authority.rs:38`, [`data/trust.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/trust.rs#L20) |
| Scheme | `Ed25519 + ML-DSA-65 (hybrid)` | `authority.rs:39`, [`data/trust.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/trust.rs#L17) |
| Manifest | `capsule_manifest v3` | `authority.rs:40`, [`data/trust.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/trust.rs#L18) |
| Cert | `NØNOS-ID cert hybrid` | `authority.rs:41`, [`data/trust.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/trust.rs#L19) |
| Status | `reached _start, which means capsule_spawn::spawn_verified accepted the cert + manifest` | `authority.rs:42`, [`data/trust.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/trust.rs#L21) |
| Cap mask | the decimal value of the mask (`6169` for `0x1819`) | `authority.rs:43`, [`data/caps.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/caps.rs#L47) |

After the fixed rows it prints the granted capabilities, one per row as `name` plus a one-line role,
filtered by `is_granted` (`authority.rs:52`, [`data/caps.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/caps.rs#L49)):

```
  CoreExec               run user code
  IPC                    toolkit calls + event recv
  Memory                 mmap the paint buffer
  GraphicsDisplayQuery   learn display dimensions
  GraphicsSurfaceCreate  register the paint surface
```

Then a `Denied:` header (`authority.rs:60`), and the name of every capability the mask does not hold, so a
reader can see the full table of what the app is not allowed to do: IO, Network, Crypto, FileSystem,
Hardware, Debug, Admin, RegisterService, GraphicsSurfaceMap, GraphicsPresent, DeviceEnum, Driver, Mmio,
Irq, Dma, and Pio (`authority.rs:64`, [`data/caps.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/caps.rs#L23)). The row count grows with the table, so adding a
capability descriptor automatically lengthens the section (`authority.rs:26`).

`GraphicsPresent` and `GraphicsSurfaceMap` land in the Denied list even though the app clearly paints to
the screen. The app registers a surface and the runtime and compositor do the mapping and the scanout
flush on its behalf; the about app itself never holds the present or map capability ([`data/caps.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/caps.rs#L47)).

## Display section

Four rows ([`src/about/section_render/display.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/display.rs#L33)). Its `LINE_COUNT` is a fixed `4`
(`display.rs:23`). The first two are constants; the last two are read live from the kernel:

| Row | Value | Source |
|---|---|---|
| Backend | `compositor + driver.virtio_gpu` | `display.rs:34` |
| Format | `ARGB8888` | `display.rs:35` |
| Width (px) | the primary display width, or `unavailable` | `display.rs:36`, [`data/display.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/display.rs#L19) |
| Height (px) | the primary display height, or `unavailable` | `display.rs:37`, [`data/display.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/display.rs#L19) |

Width and height come from `nonos_display_dimensions(0, ...)`, the `GraphicsDisplayQuery` syscall that
reads the primary display's size ([`userland/libc/src/graphics/display_dimensions.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/graphics/display_dimensions.rs#L20)). If the call
returns a negative status or a zero dimension, `primary_dimensions` returns `None` and both fields render
as `unavailable` ([`data/display.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/display.rs#L23), `display.rs:31`).

## Uptime section

Five rows derived from a single wall-clock read ([`src/about/section_render/uptime.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/uptime.rs#L40)). Its
`LINE_COUNT` is a fixed `5` (`uptime.rs:23`):

| Row | Value | Source |
|---|---|---|
| Wall ms | the raw milliseconds, or `unavailable` | `uptime.rs:41`, [`data/uptime.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/uptime.rs#L19) |
| Days | milliseconds split into whole days | `uptime.rs:42`, [`data/uptime.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/uptime.rs#L29) |
| Hours | remaining whole hours | `uptime.rs:43`, [`data/uptime.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/uptime.rs#L30) |
| Minutes | remaining whole minutes | `uptime.rs:44`, [`data/uptime.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/uptime.rs#L31) |
| Seconds | remaining whole seconds | `uptime.rs:45`, [`data/uptime.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/uptime.rs#L32) |

The raw value is `mk_time_millis()` ([`userland/libc/src/time/wall.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/time/wall.rs#L19)); a negative return means the
clock is unreadable, in which case `read_millis` returns `None`, Wall ms shows `unavailable`, and the
split fields fall back to zero ([`data/uptime.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/uptime.rs#L19), `uptime.rs:32`). `split_dhms` divides the raw
milliseconds into days, hours, minutes, and seconds ([`data/uptime.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/uptime.rs#L27)). Each paint reads the clock
fresh, so the numbers advance as the section is repainted (`uptime.rs:31`).

## License section

The full license: three header rows, a blank line, then the AGPL-3 text line by line. `HEADER_ROWS` is
`4`, counting the three header pairs plus the blank spacer line, and the line count is that plus one row
per line of the embedded text ([`src/about/section_render/license.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/license.rs#L22), `license.rs:24`):

| Row | Value | Source |
|---|---|---|
| Name | `GNU Affero General Public License` | `license.rs:33`, [`data/license.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/license.rs#L17) |
| Version | `v3 or later (AGPL-3.0)` | `license.rs:33`, [`data/license.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/license.rs#L18) |
| URL | `https://www.gnu.org/licenses/agpl-3.0.html` | `license.rs:33`, [`data/license.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/license.rs#L19) |
| (blank) | one spacer line | `license.rs:42` |
| (license body) | every line of the repository `LICENSE` file | `license.rs:46`, [`data/license.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/license.rs#L21) |

The body is the actual `LICENSE` file from the repository root, embedded at compile time with
`include_str!` and split into one row per line, so this is by far the longest section and the reason the
scrollbar exists ([`data/license.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/license.rs#L21), `license.rs:46`).

## Header and status bar

Above the sections, the header shows the product identity and a breadcrumb, and the status bar shows a
fixed hint. Both are drawn by the paint layer but their text is content, so they are listed here.

| Field | Value | Source |
|---|---|---|
| Product name | `NØNOS` | [`src/about/paint/header.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/paint/header.rs#L30), [`data/product.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/product.rs#L17) |
| Tagline | `Capability-based RAM-resident microkernel` | `header.rs:31`, [`data/product.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/data/product.rs#L18) |
| Breadcrumb | `<index+1> / 5`, right-aligned | `header.rs:34`, `section.rs:26` |
| Status hint | `Tab/Shift-Tab cycle sections   Up/Down scroll line   PgUp/PgDn scroll page   Esc close` | [`src/about/paint/status_bar.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/paint/status_bar.rs#L21) |

## Source map

```
  src/about/section.rs                 the five sections and their order
  src/about/section_render/identity.rs the nine identity rows, LINE_COUNT = 9
  src/about/section_render/authority.rs the capability report, runtime line_count()
  src/about/section_render/display.rs  four rows, two live, LINE_COUNT = 4
  src/about/section_render/uptime.rs   five rows from one clock read, LINE_COUNT = 5
  src/about/section_render/license.rs  header rows + embedded LICENSE text, runtime line_count()
  src/about/data/product.rs            name, tagline, copyright, homepage
  src/about/data/build.rs              version, git SHA, toolchain, arch
  src/about/data/abi.rs                the ABI name
  src/about/data/caps.rs               the capability table and the mask
  src/about/data/trust.rs              trust-chain and status strings
  src/about/data/display.rs            the display-size live read
  src/about/data/uptime.rs             the wall-clock live read and the d/h/m/s split
  src/about/data/license.rs            the license header and the embedded LICENSE
  userland/libc/src/graphics/display_dimensions.rs the display-size syscall
  userland/libc/src/time/wall.rs       the wall-clock syscall
```

Every reference above is verified against those trees.
