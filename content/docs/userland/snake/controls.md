---
title: "Snake controls"
description: "Every control in capsulesnake lives in one file, src/snake/input.rs."
weight: 3
---
Every control in `capsule_snake` lives in one file, [`src/snake/input.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs). The window subscribes to three
input kinds but the game acts only on key-down, so a key arrives, is filtered to key-down, is matched
first as a steering direction and then as a game control, and each match either mutates the owned `Game`
or is a deliberate no-op. This page is the complete control set; there is nothing steered anywhere else.
For the model those controls mutate see the [game loop](/docs/userland/snake/game-loop/), and for the wider capsule see the
[overview](/docs/userland/snake/).

## Event gate

`on_event` is the single entry point the skeleton calls with each `InputEvent`. It drops anything that is
not a key-down and returns `EventOutcome::Idle`, so pointer motion and button clicks never reach the game
logic ([`src/snake/input.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L23)). The window still requests absolute-pointer and button-down events in its
manifest ([`src/snake/manifest.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/manifest.rs#L26)), but those are for the skeleton's own window dragging and title-bar
buttons, not for the game. A surviving key-down is offered first to `direction`; if that returns a
direction the event is a steer, otherwise it falls through to the game-control match
([`src/snake/input.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L27)).

## Steering

`direction` maps a key code to a `Dir`, and each direction accepts the arrow key and both letter cases of
its WASD key ([`src/snake/input.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L37)). The arrow constants are the skeleton's navigation codes, mirrored
from the PS/2 keycode table ([`userland/app_skeleton/src/input/keys.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/input/keys.rs#L24)).

| Input | Key codes | Direction | Source |
|---|---|---|---|
| Up arrow / `w` / `W` | `KEY_UP` (0x1201), 0x77, 0x57 | `Dir::Up` | [`src/snake/input.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L39) |
| Down arrow / `s` / `S` | `KEY_DOWN` (0x1202), 0x73, 0x53 | `Dir::Down` | [`src/snake/input.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L40) |
| Left arrow / `a` / `A` | `KEY_LEFT` (0x1203), 0x61, 0x41 | `Dir::Left` | [`src/snake/input.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L41) |
| Right arrow / `d` / `D` | `KEY_RIGHT` (0x1204), 0x64, 0x44 | `Dir::Right` | [`src/snake/input.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L42) |

`steer` takes the resolved direction and applies it against the current phase ([`src/snake/input.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L47)):

- A reversal is rejected. A direction equal to the opposite of the current direction is ignored, so the
  snake cannot turn back into its own neck. The opposite is computed by `Dir::opposite`
  ([`src/snake/input.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L48), [`src/snake/state.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L37)).
- From `Ready`, the first accepted direction key sets both `dir` and `pending` and flips the phase to
  `Running`, which is what starts the game. It returns `Repaint` ([`src/snake/input.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L52)).
- While `Running`, a direction key sets `pending`, the direction the next tick will adopt, and returns
  `Idle`. It does not turn the snake mid-cell ([`src/snake/input.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L59)).
- While `Paused` or after `GameOver`, direction keys do nothing and return `Idle`
  ([`src/snake/input.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L62)).

Buffering exactly one turn into `pending` is what stops a fast double tap from folding the snake back on
itself between two ticks: only the last direction set before a tick is adopted, and the tick still runs
its own anti-reversal-safe motion. The `pending` field is adopted at the top of `step`
([`src/snake/step.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/step.rs#L25)); see the [game loop](/docs/userland/snake/game-loop/).

## Game controls

Anything that is not a direction is matched against the two game controls ([`src/snake/input.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L30)).

| Input | Key codes | Action | Source |
|---|---|---|---|
| Enter | `KEY_ENTER` (0x0D) | restart, only from `GameOver` | [`src/snake/input.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L31), `input.rs:66` |
| Space / `p` / `P` | 0x20, 0x70, 0x50 | toggle pause between `Running` and `Paused` | [`src/snake/input.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L32), `input.rs:74` |

Restart is gated. `restart` honours Enter only in `GameOver`; in any other phase it returns `Idle`, so a
stray Enter mid-run cannot wipe the board ([`src/snake/input.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L67)). When it does fire it calls
`Game::reset`, which recenters a length-3 snake, clears the score, restores the starting interval, places
new food, and returns to `Ready` ([`src/snake/input.rs:70`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L70), [`src/snake/state.rs:82`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L82)).

Pause toggles only between `Running` and `Paused`. `toggle_pause` maps `Running` to `Paused` and back, and
leaves `Ready` and `GameOver` where they were, so from those two phases it is a no-op
([`src/snake/input.rs:74`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L74)). Pause is cooperative with the tick: the tick does nothing unless the phase is
`Running` ([`src/snake/step.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/step.rs#L22)), so a paused game consumes no motion. `toggle_pause` always returns
`Repaint`.

## Outcomes

Every handler returns an `EventOutcome`. A control that changed something the player should see returns
`Repaint` so the frame reflects it immediately; a rejected or no-op input returns `Idle` and the frame is
left alone ([`userland/app_skeleton/src/app/event_outcome.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/app/event_outcome.rs#L18)). The skeleton's IPC drain turns a
`Repaint` into an actual redraw and ignores `Idle`
([`userland/app_skeleton/src/runner/drain_ipc.rs:121`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/drain_ipc.rs#L121)).

## Source map

```
  userland/capsule_snake/src/snake/input.rs        on_event, direction, steer, restart, toggle_pause
  userland/capsule_snake/src/snake/state.rs        Dir, Phase, Game, and Dir::opposite / Game::reset
  userland/capsule_snake/src/snake/step.rs         adopts pending; the anti-reversal-safe tick
  userland/capsule_snake/src/snake/manifest.rs     the window's input_kind_mask (key/pointer/button)
  userland/app_skeleton/src/input/keys.rs          KEY_UP..KEY_RIGHT and KEY_ENTER constants
  userland/app_skeleton/src/app/event_outcome.rs   EventOutcome: Idle vs Repaint
  userland/app_skeleton/src/runner/drain_ipc.rs    how Repaint becomes a redraw
```

Every reference above is verified against those trees.
