---
title: "The state machine, bring-up, and render"
description: "This page covers how the wizard is put together: the Context model, the service bring-up that puts a surface on screen, the key-driven loop, the step counter and its clamps, the..."
weight: 6
---
This page covers how the wizard is put together: the `Context` model, the service bring-up that puts a
surface on screen, the key-driven loop, the step counter and its clamps, the global keys shared by every
step, and how a screen becomes pixels. It mirrors `src/server/`, `src/setup/`, `src/render/` (the frame and
panel, not the per-step screens), and [`src/protocol.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol.rs). For the individual steps see
[steps.md](/docs/userland/setup-wizard/steps/); for the final policy write see [policy-writes.md](/docs/userland/setup-wizard/policy-writes/).

## The model

The capsule is `no_std`/`no_main`. Its top-level modules are `clients` (the compositor, input-router,
display-info, and policy IPC clients), `protocol` (the input-router request and delivery wire), `render`
(the panel, screens, widgets, and theme), `server` (the key loop and step machine), `setup` (service
discovery and surface bring-up), and `state` (the `Context`) ([`src/main.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L6)).

`Context` is the whole model and there is no second thread and no other persistent state: the surface base
pointer, width, height, and stride; the three discovered service ports; the current step; and one field per
selection, plus the passphrase, admin, and hostname byte buffers and the keygen stage ([`src/state.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L1)).
`Context::new` starts the step at `0`, every selection index at `0`, and `ctx.privacy` at `0b0000_0011`
([`src/state.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L39), [`src/state.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L59)).

## Bring-up

`_start` initialises the heap, then calls `setup::run`; a heap failure exits with code 1 and a bring-up
failure exits with code 2 ([`src/main.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L17), [`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)). `setup::run` does the following, in order,
each step returning its own error string on failure ([`src/setup/mod.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mod.rs#L18)):

1. Look up the `compositor` and `input_router` ports, both required, and the `policy` port, optional; a
   missing required service aborts, a missing policy leaves `policy_port = 0`
   ([`src/setup/discover.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover.rs#L22), `discover.rs:26`, `discover.rs:30`, `discover.rs:12`).
2. Health-check the compositor (`mod.rs:22`, [`src/clients/compositor/healthcheck.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/compositor/healthcheck.rs#L21)).
3. Query the display geometry; a zero width, height, or stride in the reply is rejected
   (`mod.rs:23`, [`src/clients/display_info.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/display_info.rs#L34), `display_info.rs:48`).
4. Map a backing buffer of `stride * height` bytes, guarding the multiply against overflow
   (`mod.rs:28`, `mod.rs:29`).
5. Register a `SurfaceDescriptor` for that buffer and share the surface handle (`mod.rs:44`, `mod.rs:48`).
6. Fill the backdrop, submit the surface to the compositor at overlay Z, and commit the first damage
   rectangle; a submit or damage failure releases the surface and aborts (`mod.rs:52`, `mod.rs:53`,
   `mod.rs:67`, [`src/setup/fill.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/fill.rs#L17)).

On success it returns a `Context` carrying the surface and the three ports (`mod.rs:71`).

## The key loop

`server::runner::run` takes the `Context` and never returns ([`src/server/runner.rs:12`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L12)). It subscribes to
key events and grabs the keyboard, both fire-and-forget, then draws the first screen and enters the loop
(`runner.rs:13`, `runner.rs:14`, `runner.rs:15`). Each iteration blocks on `mk_ipc_recv_from`, ignores an
empty read, parses the delivery, ignores anything that is not a key-down, feeds the key code to
`screens::on_key`, applies the outcome to the step counter, and redraws (`runner.rs:19`, `runner.rs:23`,
`runner.rs:26`, `runner.rs:29`, `runner.rs:30`, `runner.rs:35`). A redraw paints the current screen into
the shared surface and commits a full-window damage rectangle (`runner.rs:39`, `runner.rs:41`).

When the step counter reaches `DONE`, the runner removes the scene from the compositor and calls
`mk_exit(0)` (`runner.rs:31`, `runner.rs:33`). The review step has already run its policy commit by the
time the counter crosses `DONE`, so the exit is clean.

## The step counter

The step machine is deliberately small. `step::apply` maps an `Outcome` of `Advance`, `Back`, or `Stay`
onto the counter, clamping the advance at `DONE = 10` and saturating the back at `0`, so the machine never
underflows or overshoots ([`src/server/step.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/step.rs#L14), `step.rs:1`). `default_key` turns Enter (`0x0D` or
`0x0A`) into `Advance` and Escape (`0x1B`) into `Back`, and everything else into `Stay` (`step.rs:22`).
`list_nav` turns `k` (`0x6B`) into up, `j` (`0x6A`) into down bounded by the list length, and a digit
`1`..`9` (`0x31`..`0x39`) into a direct index bounded by the length, each returning `Stay` (`step.rs:30`).

Each screen's `on_key` first tries its own keys and falls back to `default_key` for Enter and Escape. A
list screen calls `list_nav` first ([`src/render/screens/language.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/language.rs#L16)); a masked-field screen matches
Backspace and the printable range itself before falling back ([`src/render/screens/passphrase.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/passphrase.rs#L28)); the
progress and toggle screens handle Enter or Space specially ([`src/render/screens/keygen.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/keygen.rs#L24),
[`src/render/screens/privacy.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/privacy.rs#L28)).

The global keys, valid on every step:

| Key | Code | Effect | Source |
|-----|------|--------|--------|
| Enter | `0x0D` / `0x0A` | advance one step (clamped at `DONE`) | `step.rs:24` |
| Escape | `0x1B` | back one step (saturates at `0`) | `step.rs:25` |
| `k` | `0x6B` | list selection up | `step.rs:32` |
| `j` | `0x6A` | list selection down | `step.rs:36` |
| `1`..`9` | `0x31`..`0x39` | jump to that list item | `step.rs:42` |

## Render

A screen paints through `render::frame`, which clears to the backdrop, fills the right-hand card, draws the
left rail through `chrome::panel`, and draws the title, subtitle, and footer at the content column
([`src/render/mod.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/mod.rs#L22), `mod.rs:31`, `mod.rs:32`). The content column and the card start at 38 percent of
the display width ([`src/render/mod.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/mod.rs#L18), `mod.rs:29`). `chrome::panel` draws the wordmark, the
`FIRST-BOOT SETUP` label, and the step list, marking each row done, current, or pending against `ctx.step`
([`src/render/chrome.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/chrome.rs#L11), `chrome.rs:18`, `chrome.rs:26`). The palette and the `STEP_LABELS` list live in
the theme ([`src/render/theme.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/theme.rs#L1), `theme.rs:15`).

Below the frame each screen draws its own widget at the content column: a single-select list
([`src/render/widgets/rows.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/widgets/rows.rs#L6)), a toggle list ([`src/render/widgets/toggles.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/widgets/toggles.rs#L6)), a masked field with a
strength bar ([`src/render/widgets/field.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/widgets/field.rs#L6)), or a task-and-progress bar
([`src/render/widgets/progress.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/widgets/progress.rs#L6)). The primitives underneath are `fill_rect` and a vertical gradient
built by lerping ARGB per row ([`src/render/paint.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/paint.rs#L1), `paint.rs:33`).

## The wire

The input-router wire is defined in [`src/protocol.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol.rs). A request carries a 20-byte header with magic
`0x4E49_5253` ("NIRS") and version 1, followed by the body ([`src/protocol.rs:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol.rs#L3), `protocol.rs:15`). A key
delivery carries an 8-byte header with magic `0x4E49_4E50` ("NINP") and version 1, followed by an
`InputEvent`; `parse_delivery` rejects a short buffer, a wrong magic, or a wrong version, then decodes the
event fields ([`src/protocol.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol.rs#L10), `protocol.rs:27`, `protocol.rs:32`, `protocol.rs:36`). The
compositor and policy wires belong to their own clients and are covered on the
[policy writes page](/docs/userland/setup-wizard/policy-writes/) and in the source map below.

## Source map

```
  src/main.rs                    _start: heap, setup::run (exit 2 on failure), server::runner::run
  src/state.rs                   Context and its defaults (privacy = 0b0000_0011)
  src/setup/mod.rs               discover, health-check, query, mmap, register, share, submit, damage
  src/setup/discover.rs          compositor/input_router required, policy optional
  src/setup/fill.rs              backdrop fill of the backing buffer
  src/server/runner.rs           subscribe, grab, the recv/parse/on_key/apply/redraw loop, mk_exit
  src/server/step.rs             Outcome, apply, DONE, default_key, list_nav
  src/render/mod.rs              frame: backdrop, card, panel, title/subtitle/footer, content_x
  src/render/chrome.rs           the left rail: wordmark and step marks
  src/render/theme.rs            palette and STEP_LABELS
  src/render/paint.rs            fill_rect and the vertical gradient
  src/render/widgets/            rows, toggles, masked field, progress
  src/protocol.rs                the input-router request and key-delivery wire
  src/clients/input_router.rs    subscribe and grab_keyboard
  src/clients/compositor/        health, submit, damage, remove
  src/clients/display_info.rs    the display geometry query
```

Every reference above is verified against those trees.
</content>
