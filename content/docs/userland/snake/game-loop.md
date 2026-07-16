---
title: "Snake game loop"
description: "The whole game is a small owned state machine driven by a self-timed tick."
weight: 4
---
The whole game is a small owned state machine driven by a self-timed tick. This page covers the `App`
adapter that wires it to the runtime, the `Game` model and its phases, one tick of motion in `step`, the
scoring and speed-up, and the bounded food placement in `rng`. It mirrors [`src/snake/app.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/app.rs),
`state.rs`, `step.rs`, `rng.rs`, and `grid.rs`. For the keys that feed it see the [controls](/docs/userland/snake/controls/),
and for how the resulting state is drawn see the [rendering](/docs/userland/snake/rendering/).

## The App adapter

`SnakeApp` is a thin wrapper that holds exactly one `Game` and forwards the four `App` methods to the free
functions in the submodules ([`src/snake/app.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/app.rs#L25)). There are no globals and no shared mutable state;
each `SnakeApp` owns its `Game` outright ([`src/snake/app.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/app.rs#L31)).

| `App` method | Forwards to | Source |
|---|---|---|
| `manifest` | `manifest()` | [`src/snake/app.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/app.rs#L36) |
| `on_event` | `on_event(&mut game, event)` | [`src/snake/app.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/app.rs#L39) |
| `paint` | `paint(&game, fb)` | [`src/snake/app.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/app.rs#L42) |
| `on_tick` | `step(&mut game)` | [`src/snake/app.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/app.rs#L45) |
| `tick_interval_ms` | `game.interval_ms` | [`src/snake/app.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/app.rs#L48) |

`_start` hands `SnakeApp::new` to the skeleton's `run`, so the runtime owns the surface, the window, the
input subscription, and the loop, and the capsule supplies only these four methods ([`src/main.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L27)).

## The model

The model is a single `Game` struct: the body vector, the current and pending directions, the food cell,
the score, the phase, the current tick interval, and the RNG state ([`src/snake/state.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L55)).

| Field | Type | Meaning | Source |
|---|---|---|---|
| `body` | `Vec<(i16, i16)>` | snake cells, head at index 0 | [`src/snake/state.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L56) |
| `dir` | `Dir` | direction the last tick moved | [`src/snake/state.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L57) |
| `pending` | `Dir` | direction the next tick will adopt | [`src/snake/state.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L58) |
| `food` | `(i16, i16)` | the one food cell | [`src/snake/state.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L59) |
| `score` | `u32` | food eaten this game | [`src/snake/state.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L60) |
| `phase` | `Phase` | `Ready`, `Running`, `Paused`, `GameOver` | [`src/snake/state.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L61) |
| `interval_ms` | `i64` | current tick interval | [`src/snake/state.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L62) |
| `rng` | `u64` | xorshift64 state | [`src/snake/state.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L63) |

`Phase` is the four-state enum that gates everything: `Ready`, `Running`, `Paused`, `GameOver`
([`src/snake/state.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L47)). `Dir` is the four directions with an `opposite` used by the anti-reversal
guard ([`src/snake/state.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L28), `state.rs:37`).

`Game::new` seeds the RNG from the wall clock with the low bit forced set so the seed is never zero, then
calls `reset` ([`src/snake/state.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L67), `state.rs:76`). `reset` recenters a length-3 snake pointing right,
clears the score, restores `START_INTERVAL_MS`, sets the phase to `Ready`, and places the first food
([`src/snake/state.rs:82`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L82)). Score is a plain `u32` starting at zero and reset by `reset`; there is no
persisted high score, so it does not survive a restart or a respawn ([`src/snake/state.rs:90`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L90)).

The board is a fixed 28x18 grid, and the window geometry is derived from the same constants
([`src/snake/grid.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/grid.rs#L18)). `CELL` is 16 px, `COLS` is 28, `ROWS` is 18, and `WIN_W`/`WIN_H` are computed
from those plus the margins, title bar, and header ([`src/snake/grid.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/grid.rs#L17), `grid.rs:26`). Changing
`COLS`/`ROWS` resizes the game with no other edit because everything downstream reads these constants.

## The tick

The game advances one cell per tick, and the tick is self-timed. `on_tick` calls `step`, and
`tick_interval_ms` reports the current interval; the skeleton's run loop compares wall-clock time against
that interval to decide when to call `on_tick` again ([`src/snake/app.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/app.rs#L45), `app.rs:48`,
[`userland/app_skeleton/src/runner/entry.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/entry.rs#L55)). Because the interval is read from game state on every
loop iteration, a speed change takes effect on the very next tick.

`step` does nothing unless the phase is `Running`; in `Ready`, `Paused`, or `GameOver` it returns `false`
so the skeleton skips the repaint ([`src/snake/step.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/step.rs#L22)). The `false` return is why a paused or
game-over board looks frozen. When it does run, `step`:

1. Adopts the buffered `pending` direction into `dir` ([`src/snake/step.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/step.rs#L25)).
2. Computes the next head cell one step in that direction from the current head at `body[0]`
   ([`src/snake/step.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/step.rs#L26)).
3. Ends the game if the next cell is off the 28x18 board or lands on the snake's own body. The wall check
   is a signed bounds test against `COLS`/`ROWS`, and self-collision is checked against the body minus its
   last cell, because that tail cell is about to move out of the way on a non-eating step
   ([`src/snake/step.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/step.rs#L33), `step.rs:34`). On a collision the phase becomes `GameOver` and the tick
   returns `true` so the game-over frame is drawn ([`src/snake/step.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/step.rs#L35)).
4. Otherwise inserts the new head at the front. If the new head is on the food, the score increases by
   one, the interval drops by `SPEEDUP_MS` clamped to the floor, and new food is placed; if not, the tail
   cell is popped so the length stays the same ([`src/snake/step.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/step.rs#L39), `step.rs:44`).

All motion arithmetic is on `i16` cell coordinates bounded against the board before use, the score is a
`u32` with no subtraction, and the interval clamps with `max`, so the tick holds to the no-panic rule end
to end ([`src/snake/step.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/step.rs#L33), `step.rs:42`).

## Scoring and speed

The three tunables live at the top of `state.rs` ([`src/snake/state.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L24)):

| Constant | Value | Meaning | Source |
|---|---|---|---|
| `START_INTERVAL_MS` | 160 | tick interval at the start of a game | [`src/snake/state.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L24) |
| `MIN_INTERVAL_MS` | 80 | fastest the game will ever tick | [`src/snake/state.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L25) |
| `SPEEDUP_MS` | 4 | milliseconds shaved off the interval per food | [`src/snake/state.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L26) |

Each food eaten adds one to the score and speeds the game by 4 ms:
`interval_ms = (interval_ms - SPEEDUP_MS).max(MIN_INTERVAL_MS)`, so the interval falls from 160 ms toward
its floor and is clamped so it never drops below 80 ms no matter how long the snake gets
([`src/snake/step.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/step.rs#L42)). The game starts at 160 ms and never ticks faster than 80 ms.

## Food placement

Food placement is a bounded-retry pick over the grid. `place_food` draws up to 64 xorshift values,
converts each into a `(col, row)` cell against `COLS`/`ROWS`, and returns the first cell that is not on
the snake ([`src/snake/rng.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/rng.rs#L28)). If all 64 draws collide it falls back to `first_free`, which scans the
grid in row-major order and returns the first free cell, keeping placement finite even when the board is
nearly full ([`src/snake/rng.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/rng.rs#L36), `rng.rs:39`). The generator is a local xorshift64 with the classic
13/7/17 shift triple, seeded once from `mk_time_millis` and advanced in place ([`src/snake/rng.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/rng.rs#L19),
[`src/snake/state.rs:76`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/state.rs#L76)). Because the fallback is a deterministic scan and the retry count is fixed, the
one source of nondeterminism in the whole capsule can neither loop unboundedly nor index out of range.

## Source map

```
  userland/capsule_snake/src/main.rs               _start -> run(SnakeApp::new)
  userland/capsule_snake/src/snake/app.rs          SnakeApp: the App impl, forwards the four methods
  userland/capsule_snake/src/snake/state.rs        Game, Dir, Phase, the constants, new/reset
  userland/capsule_snake/src/snake/step.rs         one tick: adopt pending, move, collide, eat, speed up
  userland/capsule_snake/src/snake/rng.rs          xorshift64 and bounded-retry food placement
  userland/capsule_snake/src/snake/grid.rs         board dimensions (28x18) and window geometry
  userland/app_skeleton/src/runner/entry.rs        the run loop that paces on_tick against tick_interval_ms
```

Every reference above is verified against those trees.
