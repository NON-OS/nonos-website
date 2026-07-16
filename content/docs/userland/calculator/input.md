---
title: "Calculator input handling"
description: "The calculator takes two kinds of input, and both funnel into one action set so a button and its keyboard shortcut are the exact same code path."
weight: 3
---
The calculator takes two kinds of input, and both funnel into one action set so a button and its keyboard
shortcut are the exact same code path. A pointer click is hit-tested to a grid cell and runs that button's
action; a key is classified to an action or ignored. Every action then runs through one dispatcher. This
page mirrors `src/calc/event/` (the router and the two classifiers), `src/calc/buttons/` (the keypad grid),
and [`src/calc/layout.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/layout.rs) (the hit-test geometry). For the arithmetic each action drives, see the
[engine](/docs/userland/calculator/engine/) page; for the wider capsule see the [calculator overview](/docs/userland/calculator/).

## Event gate

The app skeleton hands every decoded event to `on_event`, which routes by kind. A `ButtonDown` goes to the
pointer handler; anything that is not a key-down after that is dropped as `Idle`; everything else is a
key-down and goes to the key handler ([`src/calc/event/router.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/event/router.rs#L23)).

| Kind | Where it goes | Source |
|---|---|---|
| `ButtonDown` | `on_pointer_button(state, x, y)` | `router.rs:24` |
| not a key-down | ignored, returns `Idle` | `router.rs:27` |
| key-down | `on_key(state, code)` | `router.rs:30` |

## The keypad

The keypad is a fixed 6-row by 5-column grid of `Button` values, assembled row by row into one static
`GRID` ([`src/calc/buttons/mod.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/buttons/mod.rs#L27)). Each `Button` carries a label drawn on screen, a visual `Role` that
picks its colour, and the `Action` it runs ([`src/calc/buttons/kinds.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/buttons/kinds.rs#L48)). This is the complete grid,
top to bottom and left to right, with the label as it is painted:

| Row | Cells | Source |
|---|---|---|
| Memory | `MC`  `MR`  `M+`  `M-`  `MS` | [`src/calc/buttons/row_memory.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/buttons/row_memory.rs#L19) |
| Function | `AC`  `+/-`  `%`  `sqrt`  `/` | [`src/calc/buttons/row_function.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/buttons/row_function.rs#L20) |
| Seven | `7`  `8`  `9`  `x^2`  `*` | [`src/calc/buttons/row_seven.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/buttons/row_seven.rs#L20) |
| Four | `4`  `5`  `6`  `1/x`  `-` | [`src/calc/buttons/row_four.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/buttons/row_four.rs#L20) |
| One | `1`  `2`  `3`  `.`  `+` | [`src/calc/buttons/row_one.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/buttons/row_one.rs#L20) |
| Zero | `0`  `00`  `00`  `=`  `=` | [`src/calc/buttons/row_zero.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/buttons/row_zero.rs#L19) |

Two facts about the bottom row, both from source. The two `00` cells and the `0` cell all carry
`Action::Digit(0)`, so clicking `00` inserts a single `0`, not two (`row_zero.rs:20`). The two `=` cells
are both `Action::Equals`, so equals spans the bottom-right two columns as one wide button
(`row_zero.rs:23`). The five roles are `Number`, `Operator`, `Equals`, `Function`, and `Memory`, and the
[rendering](/docs/userland/calculator/rendering/) page shows the colour each maps to ([`src/calc/buttons/kinds.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/buttons/kinds.rs#L19)).

## Pointer hit-testing

A pointer click enters `on_pointer_button`. A negative coordinate is rejected first, then the click is
hit-tested to a `(row, col)` cell; a miss returns `Idle`; a hit reads the button out of `GRID` and
dispatches its action ([`src/calc/event/on_pointer_button.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/event/on_pointer_button.rs#L24)). The bounds against `GRID.len()` and
`GRID[0].len()` are a second guard so an out-of-range cell can never index the static
(`on_pointer_button.rs:32`).

| Step | What it does | Source |
|---|---|---|
| Negative x or y | ignored, returns `Idle` | `on_pointer_button.rs:25` |
| `hit_test` miss | ignored, returns `Idle` | `on_pointer_button.rs:28` |
| Row or column out of range | ignored, returns `Idle` | `on_pointer_button.rs:32` |
| Hit | run `GRID[row][col].action`, return `Repaint` | `on_pointer_button.rs:35` |

`hit_test` is the geometry, in [`src/calc/layout.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/layout.rs#L38). The grid sits below the display panel, so a click
above `GRID_TOP` or left of `PADDING` returns `None` at once (`layout.rs:39`). Inside the grid it divides
the local coordinate by the cell-plus-gap stride to get the row and column, and crucially it rejects a
click that lands in the gap between cells: if the remainder past the cell edge falls in the `GAP` band it
returns `None` rather than snapping to a neighbour (`layout.rs:52`). A row or column past the grid bounds
is also `None` (`layout.rs:57`). The geometry constants (padding, display height, gap, and the derived
`GRID_TOP`) are all defined at the top of the same file ([`src/calc/layout.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/layout.rs#L19)), and `cell_size` and
`cell_origin` are the shared functions the [renderer](/docs/userland/calculator/rendering/) uses to draw the same grid the
hit-test reads (`layout.rs:26`, `layout.rs:32`).

## Keyboard input

Keys are classified in `key_classifier.rs`. Esc (`0x1B`) closes the window; any code above `0x7F` is
ignored; everything else maps by its ASCII byte to an `Action` or falls to the ignore arm
([`src/calc/event/key_classifier.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/event/key_classifier.rs#L26)). The classifier returns one of three outcomes, `Close`, `Action`,
or `Ignored`, and `on_key` turns those into `EventOutcome::Close`, a dispatch plus `Repaint`, or `Idle`
([`src/calc/event/on_key.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/event/on_key.rs#L23)). The full map:

| Key | Action | Source |
|---|---|---|
| `0`..`9` | insert that digit | `key_classifier.rs:34` |
| `.` | begin the fractional part | `key_classifier.rs:35` |
| `+` | set pending operator to add | `key_classifier.rs:36` |
| `-` | set pending operator to subtract | `key_classifier.rs:37` |
| `*`, `x`, `X` | set pending operator to multiply | `key_classifier.rs:38` |
| `/` | set pending operator to divide | `key_classifier.rs:39` |
| `=` or Enter (`0x0D`) | evaluate the pending operation | `key_classifier.rs:40` |
| `c`, `C`, or Backspace (`0x08`) | all-clear | `key_classifier.rs:41` |
| `n`, `N` | negate (sign flip) | `key_classifier.rs:42` |
| `%` | percent (divide display by 100) | `key_classifier.rs:43` |
| `r`, `R` | square root | `key_classifier.rs:44` |
| `q`, `Q` | square (x squared) | `key_classifier.rs:45` |
| `i`, `I` | reciprocal (1/x) | `key_classifier.rs:46` |
| `m` | memory recall | `key_classifier.rs:47` |
| `M` | memory store | `key_classifier.rs:48` |
| `a`, `A` | memory add (M+) | `key_classifier.rs:49` |
| `s`, `S` | memory subtract (M-) | `key_classifier.rs:50` |
| `l`, `L` | memory clear | `key_classifier.rs:51` |
| Esc (`0x1B`) | close the window | `key_classifier.rs:27` |
| anything else | ignored | `key_classifier.rs:52` |

Two shortcuts are case-split on purpose: lower-case `m` recalls memory while upper-case `M` stores it, so
Shift decides recall against store (`key_classifier.rs:47`, `key_classifier.rs:48`). Every other letter
accepts both cases. Note that Backspace is not a single-digit delete; it maps to `Action::Clear`, the full
all-clear, the same as `AC` or `c` (`key_classifier.rs:41`). There is no delete-one-digit operation in the
current build.

## One dispatch for both inputs

Both paths converge on `dispatch::run`, a single match from `Action` to the operation module that owns it
([`src/calc/actions/dispatch.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/actions/dispatch.rs#L24)). A pointer click reads the cell's `action` and calls it
(`on_pointer_button.rs:35`); a key builds the same `Action` and calls it (`on_key.rs:27`). So the `7`
button and the `7` key, or the `sqrt` button and the `r` key, run byte-for-byte the same handler. What
each handler does to the arithmetic engine is the subject of the [engine](/docs/userland/calculator/engine/) page.

## Source map

```
  src/calc/event/mod.rs                the event module tree; re-exports on_event
  src/calc/event/router.rs             on_event: route by kind (button / key / idle)
  src/calc/event/on_pointer_button.rs  hit-test a click and run the cell's action
  src/calc/event/on_key.rs             classify a key and dispatch or close
  src/calc/event/key_classifier.rs     the byte-to-Action keymap
  src/calc/buttons/mod.rs              the 6x5 GRID assembled from the row files
  src/calc/buttons/kinds.rs            Action, Button, Role, and the const constructor
  src/calc/buttons/row_*.rs            one file per keypad row
  src/calc/layout.rs                   grid geometry, cell_size, cell_origin, hit_test
  src/calc/actions/dispatch.rs         Action -> handler dispatch (shared by both inputs)
```

Every reference above is verified against those trees.
