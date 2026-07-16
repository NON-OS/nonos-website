---
title: "Rendering"
description: "This page mirrors the four drawing modules of the splash: vignette (the background), chrome (the panel frame), paint (the splash frame and the animated status band), and detail ..."
weight: 7
---
This page mirrors the four drawing modules of the splash: `vignette` (the background), `chrome` (the
panel frame), `paint` (the splash frame and the animated status band), and `detail` (the `D`-key view).
Everything the capsule puts on screen is composed into a single private ARGB8888 buffer and handed to the
compositor as one damaged surface; there is no partial presentation and no double buffer. For the surface
setup and the compositor wire, see the [README](/docs/userland/boot-splash/#protocol-and-ipc). To change any of this, see
[contributing.md](/docs/userland/boot-splash/contributing/).

## The drawing surface

The renderer never sees a framebuffer. `surface::setup` mmaps one anonymous private buffer of
`stride * height` bytes, registers it as an ARGB8888 surface, and shares it to get a compositor handle
([`src/surface.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/surface.rs#L24), `:25`, `:47`, `:51`). Every draw call takes the raw base pointer and a `spx` value,
the stride in pixels, computed as `stride / 4` ([`src/paint.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L31), [`src/detail.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/detail.rs#L34)). Pixels are
`0xAARRGGBB` u32 words written directly into the slice; the alpha byte is always `0xFF`.

The compositor is told about changes with a damage rectangle after each repaint
([`src/main.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L58), `:122`, `:133`). The full-frame paints damage the whole surface; the spinner repaint
damages the whole surface too, but only rewrites one band (see [the status band](#the-status-band)).

## The vignette background

`vignette::fill` clears the whole surface to a radial gradient, and `fill_band` does the same for a
horizontal strip so the spinner can redraw without a full repaint ([`src/vignette.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/vignette.rs#L20), `:24`). The
gradient is computed per pixel, no lookup table:

- The center is horizontal middle, vertically at 38 percent of the height ([`src/vignette.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/vignette.rs#L25), `:26`),
  so the glow sits a little above the middle of the screen where the wordmark lands.
- For each pixel it takes the squared distance from that center, with the vertical delta scaled by 12/10
  so the falloff is slightly taller than it is wide, normalizes it into a 0 to 256 parameter against
  `r2 = w*w / 3`, and clamps ([`src/vignette.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/vignette.rs#L27), `:31`, `:32`).
- That parameter `t` drives `lerp` from the core color `0xFF06_201C`, a very dark teal, out to pure black
  `0xFF00_0000` ([`src/vignette.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/vignette.rs#L17), `:18`, `:33`). `lerp` blends each of the three color channels
  independently by walking the byte positions 0, 8, 16 ([`src/vignette.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/vignette.rs#L38) through `:47`).

The result is a dark teal core that fades to black toward the edges, drawn once at the start of every full
frame and once per band on each spinner tick.

## The panel chrome

`chrome::panel` draws the bordered box that both the splash attestation panel and the detail view sit in
([`src/chrome.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/chrome.rs#L33)). It is three primitives:

- A one-pixel rectangle outline in the border color `0xFF13_4237`, drawn by `chrome::rect`, which writes
  the top and bottom rows then the left and right columns ([`src/chrome.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/chrome.rs#L20), `:22` through `:31`,
  `:44`).
- The panel title, drawn in the accent color `0xFF00_D4AA` eight pixels in and six pixels down from the
  top-left corner ([`src/chrome.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/chrome.rs#L19), `:45`).
- A horizontal rule in the border color 22 pixels below the panel top, separating the title from the body
  ([`src/chrome.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/chrome.rs#L46) through `:48`).

Both the splash panel and the detail panel call this same function; only the position, size, and title
differ.

## The splash frame

`paint::splash` composes the full boot frame in order ([`src/paint.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L30)):

1. Fill the vignette background ([`src/paint.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L33)).
2. The wordmark `NØNOS`, drawn at scale 5 (`TITLE_SCALE`) through the shared `nonos_toolkit` font atlas,
   centered horizontally, with a one-pixel dark drop shadow behind it in `ACCENT_DIM` `0xFF00_5544` and
   the glyphs on top in `ACCENT` `0xFF00_D4AA` ([`src/paint.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L22) through `:24`, `:27`, `:35` through
   `:40`). The `Ø` is the byte `0xD8` in the title literal ([`src/paint.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L35)). It sits 132 pixels above
   vertical center ([`src/paint.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L38)).
3. The subtitle `zero-state attestation boot`, centered under the wordmark in the dim color `0xFF5B_6B78`
   ([`src/paint.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L22), `:41` through `:43`).
4. The attestation panel (below).
5. The status band with the spinner (below), painted at frame 0 for the first draw ([`src/paint.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L45)).

### The attestation panel

`attest_panel` draws a 380-pixel-wide box titled `boot-chain attestation`, centered horizontally, 24
pixels above vertical center ([`src/paint.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L48) through `:52`). Inside it are four lines:

- `[+] bootloader  ed25519 verified` in green (`OK` `0xFF00_CC66`) ([`src/paint.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L25), `:53`).
- `[+] kernel      blake3 verified` in green ([`src/paint.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L54)).
- `[#] capsules    zk attested` in accent teal ([`src/paint.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L55)).
- The live verdict line ([`src/paint.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L56) through `:61`).

The first three lines are fixed text. The verdict line is the one security-relevant pixel, and it is
driven by the `attested: Option<bool>` the loop computed from the kernel status read
([`src/main.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L52), [`src/paint.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L56)):

| `attested` | Text | Color | Meaning |
|------------|------|-------|---------|
| `Some(true)` | `ATTESTED` | green `OK` | the kernel reported `zk_verified == 1` |
| `Some(false)` | `UNVERIFIED` | amber `WARN` `0xFFFF_AA00` | the kernel reported `zk_verified == 0` |
| `None` | `verifying` | dim | `mk_attest_status` returned nonzero, the read failed |

`None` is a failed read, not a pending state; there is no polling loop that resolves it. The badge is
computed once, before the first paint, and only changes if the loop repaints the whole splash
([`src/main.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L52), `:120`). Because the splash only displays this field, a green badge is the kernel's
claim, not the splash's proof; the [README security section](/docs/userland/boot-splash/#security) explains why that is
sound.

### The status band

The bottom-of-screen status line is the only animated element. `paint::status` draws it 132 pixels below
vertical center ([`src/paint.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L64), `:65`):

- It first clears a 16-row band with `vignette::fill_band` so the previous glyphs are erased without a
  full repaint ([`src/paint.rs:66`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L66), [`src/vignette.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/vignette.rs#L24)).
- It draws a spinner glyph from `|/-\` selected by `frame % 4` in accent teal, the label
  `initializing zero-state` in dim next to it, and a blinking cursor `_` (on even frames, a space on odd)
  in accent after the label ([`src/paint.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint.rs#L28), `:68` through `:74`).

The spinner is a time-based cycle, not a progress metric. The loop computes a frame number from elapsed
milliseconds as `el / 150` and, whenever that number changes, redraws only the status band with the next
glyph ([`src/main.rs:128`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L128), `:131`, `:132`). A spinning splash means the capsule is alive and cycling; it is
not evidence of forward progress in the boot. Because only the band is rewritten while the rest of the
buffer is untouched, the per-tick cost is one strip fill plus a few glyphs.

## The detail view

Pressing `D` (upper or lower case) toggles the detail view ([`src/main.rs:116`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L116)). `detail::detail` repaints
the whole surface ([`src/detail.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/detail.rs#L33)):

- Vignette background, then a wide panel from `(40, 60)` spanning `width - 80` by 220 pixels, titled
  `boot-chain attestation` ([`src/detail.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/detail.rs#L36) through `:38`).
- The kernel BLAKE3 hash: the label `kernel blake3` in dim, then the 32-byte `att.kernel_blake3` rendered
  as 64 lowercase hex characters by `hex32` ([`src/detail.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/detail.rs#L25) through `:31`, `:39` through `:42`).
- The ZK program hash: the label `zk program hash` in dim, then `att.program_hash` in hex
  ([`src/detail.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/detail.rs#L43) through `:45`).
- Two colored flags drawn by `flag`, green `OK` when set and amber `WARN` when not: `secure_boot` from
  `att.secure_boot == 1`, and `attested` from `att.zk_verified == 1` ([`src/detail.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/detail.rs#L46), `:47`, `:51`
  through `:53`).
- A footer `press any key to return`, 40 pixels up from the bottom ([`src/detail.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/detail.rs#L48)).

The detail view is drawn from the `AttestStatus` the loop already holds, not a fresh read; the same struct
that produced the splash badge produces these hashes and flags ([`src/main.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L51), `:118`). Any key press
with the detail open toggles it back to the splash ([`src/main.rs:116`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L116), `:120`). While the detail view is
open the handoff is suppressed, so a held detail view will not let the splash exit out from under the
reader ([`src/main.rs:108`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L108), guarded by `!show_detail`); this is covered under
[debugging.md](/docs/userland/boot-splash/debugging/#the-splash-stays-on-screen-and-never-hands-off).

## Colors

The palette is small and defined per module as `0xAARRGGBB` constants:

```
  ACCENT       0xFF00_D4AA   teal, the wordmark and spinner glyph    paint.rs:23, chrome.rs:19
  ACCENT_DIM   0xFF00_5544   wordmark drop shadow                    paint.rs:24
  DIM          0xFF5B_6B78   subtitle, labels, verifying verdict     paint.rs:22, detail.rs:21
  OK           0xFF00_CC66   green, verified lines and set flags     paint.rs:25, detail.rs:22
  WARN         0xFFFF_AA00   amber, UNVERIFIED and unset flags       paint.rs:26, detail.rs:23
  FG           0xFFE8_F0F8   near-white, the hash text               detail.rs:20
  BORDER       0xFF13_4237   panel outline and title rule            chrome.rs:20
  CORE / BG    0xFF06_201C / 0xFF00_0000   vignette core and edge    vignette.rs:17, :18
```

Back to the [README hub](/docs/userland/boot-splash/).
