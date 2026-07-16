---
title: "Debugging capsule_about"
description: "This page lists the log marker the about capsule's boot path emits and the concrete failure modes with where to look for each."
weight: 5
---
This page lists the log marker the about capsule's boot path emits and the concrete failure modes with
where to look for each. For the model see the [README](/docs/userland/about/), the [content reference](/docs/userland/about/content/),
the [interaction model](/docs/userland/about/interaction/), and the [rendering](/docs/userland/about/rendering/) pages in this folder.

## Log marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel logs
`[APP-ABOUT] capsule spawned` from the capsule boot path: the `Ok` arm calls
`boot_log::ok(prefix, "capsule spawned")` with the prefix `APP-ABOUT`
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29), [`src/userspace/init/spawn_plan/apps.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L45),
[`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). If that line is absent the capsule never started, and the `Err` arm
logged an error line through `boot_log::error` instead ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)),
which is the usual signature, manifest, or capability failure. The about app has no serial markers of its
own; the boot line is its only kernel-visible sign of life, after which everything is on-screen.

## Failure modes

### Window opens but the tabs and scrolling do nothing

The window subscribes to key-down, button-down, and absolute-pointer events and ignores everything else
([`src/about/manifest.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/manifest.rs#L25), [`src/about/event/router.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/event/router.rs#L38)). If keys and clicks do nothing at all, the
app never sees the events, so the suspect is the input path into the app (compositor, wm, input_router),
not the router or the handlers.

### The Display section reads `unavailable`

`nonos_display_dimensions` returned a negative status or a zero dimension, so `primary_dimensions`
returned `None` and both Width and Height render as `unavailable` ([`src/about/data/display.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/data/display.rs#L23),
[`src/about/section_render/display.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/display.rs#L31)). This happens before the display is up or if the query
capability is missing. Confirm the Authority section lists `GraphicsDisplayQuery` as granted; a mask
without it (`0x0800`) would deny the query at the boundary (`README.md`, [`src/about/data/caps.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/data/caps.rs#L47)).

### The Uptime section reads `unavailable` or stays at zero

`mk_time_millis` returned negative, so `read_millis` returned `None`; Wall ms then shows `unavailable` and
the day/hour/minute/second split falls back to zero ([`src/about/data/uptime.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/data/uptime.rs#L19),
[`src/about/section_render/uptime.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/uptime.rs#L32)). The clock is read fresh on every paint, so if it later becomes
readable the next repaint shows real numbers (`uptime.rs:31`).

### Scrolling stops short or overshoots

The visible line count is recomputed from the window height each paint, and the fixed-count sections carry
a hand-maintained `LINE_COUNT` ([`src/about/state.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/state.rs#L64), [`src/about/section_render/identity.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/section_render/identity.rs#L22)). A
`LINE_COUNT` that does not match the number of rows a renderer actually draws is the usual cause of a
scrollbar that does not reach the end or an End key that lands short. The Authority and License sections
compute their count at runtime, so they are not subject to this (`authority.rs:25`, `license.rs:24`).

### The window shows a stale or blank body

The renderer clears and redraws the whole frame on every repaint, and a handler only asks for a repaint
when it changed something ([`src/about/paint/frame.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/paint/frame.rs#L29), [`src/about/event/on_home.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/event/on_home.rs#L22)). If the section
changed (the breadcrumb or the highlighted tab moved) but the body did not, the split is between the model
and a section renderer, not the paint loop; check the renderer for the selected section. If nothing on
screen moves in response to input, that is the input case above, not a render bug.

## Source map

```
  src/userspace/init/capsule_boot/run.rs   [APP-ABOUT] capsule spawned / error path
  src/userspace/init/spawn_plan/apps.rs    the APP-ABOUT spawn entry
  src/sys/boot_log/output.rs               the boot-log ok/error writers
  src/about/manifest.rs                    the subscribed input mask
  src/about/event/router.rs                the key-down gate; Idle for everything else
  src/about/data/display.rs                the display live read and its None fallback
  src/about/data/uptime.rs                 the wall-clock live read and its None fallback
  src/about/section_render/identity.rs     a fixed-count section's LINE_COUNT
  src/about/state.rs                       the visible-line recompute and the scroll clamp
  src/about/paint/frame.rs                 the clear-and-redraw paint order
```

Every reference above is verified against those trees.
