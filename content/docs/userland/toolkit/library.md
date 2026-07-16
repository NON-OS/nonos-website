---
title: "The toolkit library"
description: "This is the real product. nonostoolkit is a #![nostd] library (src/lib.rs:17) that a GUI capsule compiles into its own binary and calls in-process. The library never opens a sur..."
weight: 1
---
This is the real product. `nonos_toolkit` is a `#![no_std]` library ([`src/lib.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/lib.rs#L17)) that a GUI capsule
compiles into its own binary and calls in-process. The library never opens a surface, never presents, and
never crosses a capability boundary; it fills bytes in a framebuffer the caller already owns. This page
follows the eight library modules [`src/lib.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/lib.rs#L21) declares: `font`, `design`, `components`, `decorations`,
`image`, `qr`, `animation`, and `theme`. The three service-only modules are on the [service](/docs/userland/toolkit/service/)
page. For the crate identity and the mask, see the [README](/docs/userland/toolkit/).

## The shared drawing interface

Every drawing helper in the library sits on the same flat interface: an ARGB8888 pixel buffer the caller
already has, plus its geometry. The shape is stable across the crate, seen in `draw_glyph`
([`src/font/render/draw_glyph.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/font/render/draw_glyph.rs#L18)), `draw_text` ([`src/font/render/draw_text.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/font/render/draw_text.rs#L20)), `render_button`
([`src/components/button.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/button.rs#L45)), and `render_matrix_argb8888` ([`src/qr/render.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/qr/render.rs#L1)):

```
  buf: &mut [u32]   the caller's framebuffer, one ARGB8888 pixel per u32
  stride: usize     pixels per row, not bytes
  w, h: u32         clip bounds; nothing is written past them
  x, y: u32         where to draw
  ...               glyph, color, label, style, or matrix
```

The helpers never allocate a surface and never present. They compute a pixel index `py * stride + px`,
bound it against `buf.len()`, and write a `u32`. `draw_glyph` ([`src/font/render/draw_glyph.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/font/render/draw_glyph.rs#L37)) skips
any pixel that lands outside `w`/`h` or past the slice; the `fill_rect` inside `render_button`
([`src/components/button.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/button.rs#L27)) clamps its rectangle to `w`/`h` and to the slice with saturating
arithmetic. So a wrong stride or an out-of-range coordinate loses pixels rather than corrupting memory
outside the buffer the caller handed in. The capsule that owns the surface maps it, paints into it with
these helpers, and presents it; the library just fills the bytes.

## The font (`src/font/`)

`font` is a fixed 8x8 bitmap font, not a glyph shaper. `FontAtlas` ([`src/font/atlas.rs:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/font/atlas.rs#L4)) defaults to
`glyph_width = 8`, `glyph_height = 8`, `letter_spacing = 1` ([`src/font/atlas.rs:12`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/font/atlas.rs#L12)), and `text_width`
returns `len * 8 + (len - 1) * spacing` ([`src/font/atlas.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/font/atlas.rs#L21)). `GlyphBitmap` ([`src/font/glyph.rs:2`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/font/glyph.rs#L2)) is
`width`, `height`, and `rows: [u8; 8]`, one bit per pixel, MSB first. `glyph_for_ascii`
([`src/font/glyph.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/font/glyph.rs#L52)) maps a byte to a glyph: space, the digits `0`-`9`, ASCII upper
([`src/font/upper.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/font/upper.rs)) and lower ([`src/font/lower.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/font/lower.rs)) cases, punctuation ([`src/font/punct.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/font/punct.rs)), plus a few
control bytes reused as icons (`0xD8` a slashed O, `0x10` a chevron, `0x11` a check, `0x12` a cross,
[`src/font/glyph.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/font/glyph.rs#L56)), and everything else falls back to `GLYPH_UNKNOWN` ([`src/font/glyph.rs:80`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/font/glyph.rs#L80)).
`draw_text` ([`src/font/render/draw_text.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/font/render/draw_text.rs#L20)) walks the bytes, drawing each glyph and advancing the pen
by `glyph_width + letter_spacing` ([`src/font/render/draw_text.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/font/render/draw_text.rs#L35)). `font::render` also exports
`draw_glyph_scaled` and `draw_text_scaled` for integer-scaled text ([`src/font/render/mod.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/font/render/mod.rs#L22)).

## The design vocabulary (`src/design/`)

`design` is plain value types with no drawing of their own. `Argb` ([`src/design/color.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/design/color.rs#L1)) wraps a `u32`
with `from_channels`, `with_alpha`, `alpha`, `as_u32`, and the constants `BLACK`, `WHITE`, `TRANSPARENT`
([`src/design/color.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/design/color.rs#L5)). `Palette` ([`src/design/color.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/design/color.rs#L26)) is `background`/`foreground`/`accent`/
`danger` with a dark default ([`src/design/color.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/design/color.rs#L34)). `TextStyle` ([`src/design/typography.rs:8`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/design/typography.rs#L8)) carries
`px`, `FontWeight` (`Regular`/`Medium`/`Bold`, [`src/design/typography.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/design/typography.rs#L1)), `letter_spacing`, and
`line_height`, with `caption`/`body`/`title`/`headline` presets ([`src/design/typography.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/design/typography.rs#L16)).
`SpacingScale` ([`src/design/spacing.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/design/spacing.rs#L19)) is a `4/8/12/16/24` step scale ([`src/design/spacing.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/design/spacing.rs#L28)) and
`Insets` ([`src/design/spacing.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/design/spacing.rs#L1)) is four-sided padding. `Border` and `Radius`
([`src/design/border.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/design/border.rs#L17), `:3`) describe a border width, color, and per-corner radius. `Shadow`
([`src/design/shadow.rs:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/design/shadow.rs#L3)) is offset, blur, spread, and color with `none`/`sm`/`md` presets
([`src/design/shadow.rs:12`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/design/shadow.rs#L12)). These are the tokens a capsule reads to stay visually consistent; nothing in
`design` writes a pixel.

## The widgets (`src/components/`)

`components` ([`src/components/mod.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/mod.rs#L1)) is a set of small, mostly stateless helpers, twenty modules in
all. They fall into two shapes. Some render directly into the surface buffer: `render_button`
([`src/components/button.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/button.rs#L45)) with `ButtonStyle { bg, fg }` ([`src/components/button.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/button.rs#L5)), `render_label`
([`src/components/label.rs:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/label.rs#L15)) with `LabelStyle { color }` ([`src/components/label.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/label.rs#L5)), `render_slider`
([`src/components/slider.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/slider.rs)), `render_input` ([`src/components/input.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/input.rs)), and `render_list_item`
([`src/components/list.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/list.rs)). Others are pure state or style logic the capsule uses to decide colors and
positions: `checkbox_color` ([`src/components/checkbox.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/checkbox.rs#L18)), `radio_color` ([`src/components/radio.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/radio.rs)),
`toggle_track` ([`src/components/toggle.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/toggle.rs)), `progress_pct` ([`src/components/progress.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/progress.rs)),
`gradient_color` ([`src/components/colorpicker.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/colorpicker.rs)), `is_valid_date` over `CalendarDate`
([`src/components/datepicker.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/datepicker.rs)), `first_enabled` over `MenuItem` ([`src/components/menu.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/menu.rs)), and the small
state types `ScrollState` with its `clamp` ([`src/components/scroll.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/scroll.rs#L1)), `TabBarState`
([`src/components/tabbar.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/tabbar.rs)), and `StatusFlags` ([`src/components/statusbar.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/statusbar.rs)). `dropdown`
([`src/components/dropdown/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/dropdown/mod.rs)), `card` ([`src/components/card.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/card.rs)), `badge` ([`src/components/badge.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/badge.rs)),
`tooltip` ([`src/components/tooltip.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/tooltip.rs)), and `glass_panel` ([`src/components/glass_panel.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/glass_panel.rs)) round out the
set. Each style struct derives `Default`, so a capsule can take the defaults or override a field
([`src/components/button.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/button.rs#L10), [`src/components/checkbox.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/components/checkbox.rs#L9)).

## Window decorations (`src/decorations/`)

`decorations` ([`src/decorations/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decorations/mod.rs#L17)) draws window chrome and answers hit tests, so every window
frame looks the same. It exports `draw_titlebar` ([`src/decorations/titlebar.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decorations/titlebar.rs)), `draw_border`
([`src/decorations/border.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decorations/border.rs)), the three window buttons `draw_close_button`/`draw_minimize_button`/
`draw_maximize_button` with their `*_rect` geometry helpers ([`src/decorations/mod.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decorations/mod.rs#L24)), and `hit_test`
returning `DecorationHit` ([`src/decorations/hit_test.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decorations/hit_test.rs#L29)), which is `None`, `Titlebar`, `CloseButton`,
`MinimizeButton`, or `MaximizeButton` ([`src/decorations/hit_test.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decorations/hit_test.rs#L20)). The chrome metrics are fixed
constants ([`src/decorations/metrics.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decorations/metrics.rs#L17)): `BORDER_PX = 1`, `TITLEBAR_HEIGHT = 26`,
`TITLEBAR_PADDING = 10`, `TITLE_TEXT_Y = 9`, `CLOSE_BUTTON_SIZE = 18`, `BUTTON_GAP = 6`. `hit_test` reads
those same button rects ([`src/decorations/hit_test.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/decorations/hit_test.rs#L33)), so a click is classified against exactly the
chrome that was drawn. `app_skeleton` uses this directly for its own window frame
([`userland/app_skeleton/src/runner/decorations.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/decorations.rs#L19)).

## Image decoders (`src/image/`)

`image` ([`src/image/mod.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/image/mod.rs#L1)) decodes to ARGB8888 in the caller's buffer. Every entry point shares the
signature `(input: &[u8], out: &mut [u32]) -> Result<ImageSize, DecodeError>`: `decode_bmp_argb8888`
([`src/image/bmp.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/image/bmp.rs#L13)), `decode_png_argb8888` ([`src/image/png/decoder.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/image/png/decoder.rs#L11)), `decode_jpeg_argb8888`
([`src/image/jpeg/decode/decode_jpeg_argb8888.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/image/jpeg/decode/decode_jpeg_argb8888.rs#L30)), and `decode_lz4_raw_argb8888`
([`src/image/lz4_raw.rs:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/image/lz4_raw.rs#L3)). `ImageSize` ([`src/image/types.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/image/types.rs#L11)) is `width`/`height` and refuses zero
dimensions ([`src/image/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/image/types.rs#L17)); `DecodeError` ([`src/image/types.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/image/types.rs#L1)) is `BadMagic`, `Unsupported`,
`BadDimensions`, `OutputTooSmall`, or `Truncated`. The PNG path is a full inflate
([`src/image/png/inflate/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/image/png/inflate/mod.rs)) plus scanline defilter ([`src/image/png/scanline.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/image/png/scanline.rs)); the JPEG path is a
baseline decoder with its own Huffman tables, dequant, IDCT, and YCbCr conversion (`src/image/jpeg/`).
These decoders are the part of the library that parses hostile bytes: `capsule_image_codec` feeds
attacker-controllable input into exactly these entry points
([`userland/capsule_image_codec/src/server/handlers/decode.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_image_codec/src/server/handlers/decode.rs#L18)), and because they run in that capsule's
address space, a decoder flaw is contained there.

## QR rendering (`src/qr/`)

`qr` ([`src/qr/mod.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/qr/mod.rs#L1)) builds a QR matrix (`ecc`, `format`, `mask`, `place`) and paints it.
`render_matrix_argb8888` ([`src/qr/render.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/qr/render.rs#L1)) takes the matrix, its `size`, an integer `scale`, an `on`
and an `off` color, and the usual `buf`/`stride`/`w`/`h`. It clamps `scale` to at least 1
([`src/qr/render.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/qr/render.rs#L13)), returns `false` if the matrix is shorter than `size * size`
([`src/qr/render.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/qr/render.rs#L14)) or the buffer is too small for `size * scale`
([`src/qr/render.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/qr/render.rs#L19)), and otherwise blits scaled modules, bounding each write against `buf.len()`
([`src/qr/render.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/qr/render.rs#L34)).

## The animation store (`src/animation/`)

`animation` ([`src/animation/mod.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/animation/mod.rs#L1)) carries easing, timing, and transition helpers plus a shared tick
counter. `advance` ([`src/animation/store/advance.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/animation/store/advance.rs#L20)) is a single `AtomicU64` `TICK` bumped with
`AcqRel`: a zero delta advances by one, any other delta advances by that amount
([`src/animation/store/advance.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/animation/store/advance.rs#L21)). Because the counter is one global, concurrent callers race on it by
design. A linking capsule can read and advance it in-process; the service also exposes it over IPC as
`ANIMATION_TICK` (see the [service](/docs/userland/toolkit/service/) page).

## The theme snapshot (`src/theme/`)

`theme` ([`src/theme/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/theme/mod.rs#L17)) is a global palette held as six atomics with a default dark palette
([`src/theme/store/state.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/theme/store/state.rs#L18)): background `0xFF101620`, surface `0xFF1A2030`, accent `0xFF66FFFF`, text
`0xFFF4F4F4`, border `0xFF2E5C5C`, and a revision starting at 1 ([`src/theme/store/state.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/theme/store/state.rs#L23)).
`snapshot` ([`src/theme/store/snapshot.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/theme/store/snapshot.rs#L21)) reads all six with `Acquire` into a `Theme`. `apply`
([`src/theme/apply/apply.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/theme/apply/apply.rs#L21)) replaces the palette from a payload; it is reached over IPC by the service
and is documented on the [service](/docs/userland/toolkit/service/) page. A linking capsule reads the current theme with
`snapshot` to color its own drawing.

## Source map

Every claim above is traced to the eight library module trees under `userland/toolkit/src/`: `font/`
(atlas, glyph tables, text and glyph drawing), `design/` (color, spacing, border, shadow, typography
tokens), `components/` (widget render and state helpers), `decorations/` (titlebar, window buttons,
borders, hit test), `image/` (bmp, png, jpeg, lz4 decoders to ARGB8888), `qr/` (matrix build and render),
`animation/` (the shared tick counter), and `theme/` (the global palette store and snapshot), with the
module declarations in [`userland/toolkit/src/lib.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/toolkit/src/lib.rs) and the linking calls in
`userland/app_skeleton/` and `userland/capsule_image_codec/`. Every reference above is verified against
those trees.
