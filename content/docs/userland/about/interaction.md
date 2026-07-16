---
title: "About interaction"
description: "Input in capsuleabout is a small set of handlers under src/about/event/, all of them driving one selection and scroll model in src/about/state.rs."
weight: 2
---
Input in `capsule_about` is a small set of handlers under `src/about/event/`, all of them driving one
selection and scroll model in [`src/about/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/state.rs). The window subscribes to key-down, button-down, and
absolute-pointer events, the router dispatches each to a one-file handler, and every handler either
mutates the state and asks for a repaint or reports that nothing changed. This page walks the subscription,
the router, every binding, and the state behind them. For what the sections show see
[content](/docs/userland/about/content/); for the wider capsule see the [about overview](/docs/userland/about/).

## What the window listens for

The manifest declares a Normal window and an input mask of key-down, button-down, and absolute-pointer
notifications ([`src/about/manifest.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/manifest.rs#L28)). The mask is the OR of three bits:

| Bit | Constant | Value | Source |
|---|---|---|---|
| Key down | `INPUT_KEY_DOWN_BIT` | `1 << 0` | `manifest.rs:22` |
| Pointer absolute | `INPUT_POINTER_ABS_BIT` | `1 << 3` | `manifest.rs:24` |
| Button down | `INPUT_BUTTON_DOWN_BIT` | `1 << 5` | `manifest.rs:23` |

Anything outside that mask never reaches the app. The window is titled `About NØNOS`, is `WindowKind::Normal`,
and opens at 560 by 400 pixels at the theme's initial position (`manifest.rs:26`, `manifest.rs:32`,
[`src/about/theme.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/theme.rs#L27)).

## The router

`on_event` is the single entry point the skeleton calls ([`src/about/app.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/app.rs#L38)). It routes a button-down
to the pointer handler, drops anything that is not a key-down, and otherwise matches the key code
([`src/about/event/router.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/event/router.rs#L34)):

| Event | Action | Source |
|---|---|---|
| Button down | route to the tab-strip pointer handler | `router.rs:35` |
| Not key-down | ignored, returns Idle | `router.rs:38` |
| Key down | matched against the binding table below | `router.rs:41` |

## Keybindings

Each key is one handler file, wired in the router's match ([`src/about/event/router.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/event/router.rs#L41)):

| Key | Action | Source |
|---|---|---|
| Esc | close the window | `router.rs:42`, `on_esc.rs:19` |
| Shift+Tab | select the previous section (wraps), reset scroll | `router.rs:43`, `on_shift_tab.rs:21`, `state.rs:41` |
| Tab | select the next section (wraps), reset scroll | `router.rs:44`, `on_tab.rs:21`, `state.rs:36` |
| Up | scroll the body up one line | `router.rs:45`, `on_arrow_up.rs:21`, `state.rs:46` |
| Down | scroll the body down one line (clamped to the last page) | `router.rs:46`, `on_arrow_down.rs:22`, `state.rs:49` |
| Page Up | scroll up by a visible page | `router.rs:47`, `on_page_up.rs:21`, `state.rs:55` |
| Page Down | scroll down by a visible page (clamped) | `router.rs:48`, `on_page_down.rs:22`, `state.rs:58` |
| Home | jump to the top of the section | `router.rs:49`, `on_home.rs:21` |
| End | jump to the last page of the section | `router.rs:50`, `on_end.rs:22` |
| Anything else | ignored, returns Idle | `router.rs:51` |

Tab and Shift+Tab wrap around the five-section array and reset the scroll to zero on a switch
(`state.rs:37`, `state.rs:42`). The arrow, page, home, and end handlers only move the scroll offset; the
section itself does not change.

## Pointer

A button-down inside the tab strip selects the tab under the cursor. `on_pointer_button` rejects negative
coordinates, rejects a click outside the tab strip's vertical band, then walks the same tab layout the
painter uses (14px horizontal padding, an 8px cell per label character) and switches to the tab the x
coordinate lands on ([`src/about/event/on_pointer_button.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/event/on_pointer_button.rs#L27)). A click on the tab already selected, or
outside every tab, returns Idle (`on_pointer_button.rs:44`, `on_pointer_button.rs:53`). The 14px padding
and 8px cell match the tab painter, so the hit test tracks what is drawn ([`src/about/paint/tabs.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/paint/tabs.rs#L25),
`tabs.rs:29`).

## The state model

`State` is the whole model: the selected section, the scroll offset in lines, a painted flag, and the last
computed count of visible body lines ([`src/about/state.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/state.rs#L22)). It starts on Identity with zero scroll and
the default visible-line count (`state.rs:30`).

| Field | Meaning | Source |
|---|---|---|
| `section` | which of the five sections is shown | `state.rs:23` |
| `scroll` | the first visible body line | `state.rs:24` |
| `painted` | set true after the first frame | `state.rs:25` |
| `last_visible_lines` | body lines that fit, recomputed each paint | `state.rs:26` |

Scrolling is clamped against the section's total line count. `scroll_line_down` and `scroll_page_down`
compute the maximum offset as `total - last_visible_lines` and never advance past it, and `scroll_line_up`
and `scroll_page_up` saturate at zero (`state.rs:49`, `state.rs:58`, `state.rs:47`, `state.rs:56`). The
total is the current section's line count, which the down and page handlers read fresh so the clamp always
matches what is on screen ([`src/about/event/on_arrow_down.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/event/on_arrow_down.rs#L23), `on_page_down.rs:23`).

`last_visible_lines` is recomputed from the window height on every paint, before any handler runs against
it, so scrolling stays correct if the window is resized ([`src/about/paint/frame.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/paint/frame.rs#L28),
`state.rs:64`). `visible_lines_for` subtracts the header, tab bar, top padding, and status bar from the
window height and divides the remainder by the line height, with a floor of one line (`state.rs:64`).

## Idle versus repaint

Every handler that changes something returns `Repaint`; the ones that would be no-ops return `Idle` so the
runtime does not repaint needlessly. Home returns Idle when already at the top, End returns Idle when
already at the last page, and a pointer click on the current tab or outside the strip returns Idle
([`src/about/event/on_home.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/about/event/on_home.rs#L22), `on_end.rs:25`, `on_pointer_button.rs:44`). Esc returns `Close`, which
tears the window down (`on_esc.rs:19`).

## Source map

```
  src/about/manifest.rs              the window descriptor and the input mask
  src/about/event/router.rs          the on_event dispatch: pointer, key-down gate, key match
  src/about/event/on_esc.rs          Esc -> Close
  src/about/event/on_tab.rs          Tab -> next section
  src/about/event/on_shift_tab.rs    Shift+Tab -> previous section
  src/about/event/on_arrow_up.rs     Up -> scroll one line up
  src/about/event/on_arrow_down.rs   Down -> scroll one line down, clamped
  src/about/event/on_page_up.rs      Page Up -> scroll one page up
  src/about/event/on_page_down.rs    Page Down -> scroll one page down, clamped
  src/about/event/on_home.rs         Home -> top, Idle if already there
  src/about/event/on_end.rs          End -> last page, Idle if already there
  src/about/event/on_pointer_button.rs  tab-strip hit test
  src/about/state.rs                 the selection and scroll model
```

Every reference above is verified against those trees.
