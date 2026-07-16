---
title: "Debugging capsule_snake"
description: "This page lists the one log marker the game emits, and the concrete failure modes with where to look for each."
weight: 7
---
This page lists the one log marker the game emits, and the concrete failure modes with where to look for
each. Snake is small enough to reason about from its four logic files directly, so most debugging is
narrowing a symptom to the right file rather than reading a trace. For the game model see the
[overview](/docs/userland/snake/), the [controls](/docs/userland/snake/controls/), the [game loop](/docs/userland/snake/game-loop/), and the
[rendering](/docs/userland/snake/rendering/) pages in this folder.

## Log marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel logs `[APP-SNAKE]
capsule spawned`: the `Ok` arm of the capsule boot path calls `boot_log::ok(prefix, "capsule spawned")`,
and `ok` prints the tag in brackets followed by the message ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29),
[`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). If that line is absent the capsule never started, and the `Err` arm
logged an `[ERROR]` line built from the spawn error instead ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)),
which is the usual signature, manifest, or capability failure.

Snake is compiled into the desktop fleet only under the `nonos-capsule-snake` feature. On a build without
that feature `spawn_snake` is the empty stub and no line appears at all, because the plan calls the stub
([`src/userspace/init/spawn_plan/apps.rs:116`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L116)). There is no serial self-test build and no debug marker
beyond the spawn line.

## Failure modes

### Window opens but keys do nothing

The game acts only on key-down and returns `Idle` for every other event kind ([`src/snake/input.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L24)). If
the arrows do nothing at all, the shell of the game never sees them, so the suspect is the input path into
the app (compositor, wm, input_router), which the skeleton resolves by name at startup and which the game
does not control ([`userland/app_skeleton/src/discover/require.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/discover/require.rs#L31)).

### The snake will not turn

A key equal to the opposite of the current direction is dropped on purpose, and a turn only applies on the
next tick, so a rapid reverse looks like a dead key but is the anti-reversal guard working
([`src/snake/input.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L48), [`src/snake/step.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/step.rs#L25)). A single perpendicular turn always takes; only the
direct reverse is refused.

### The game never starts

From `Ready` nothing moves until the first accepted direction key flips the phase to `Running`; Space and
Enter alone will not start it ([`src/snake/input.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L52)). If the board sits on `PRESS A DIRECTION KEY`, the
game is waiting for a steer, not stuck.

### Enter does nothing

Restart is honoured only from `GameOver`; in any other phase Enter is a deliberate no-op
([`src/snake/input.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/input.rs#L67)). This is intentional so a stray Enter mid-run cannot wipe the board.

### Motion feels frozen

A paused game and a game-over game both return `false` from the tick, so the skeleton skips the repaint and
the board looks static ([`src/snake/step.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/step.rs#L22)). The overlay text tells the two apart from a running game:
`PAUSED` versus `GAME OVER` ([`src/snake/paint/overlay.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/snake/paint/overlay.rs#L30), `overlay.rs:35`). If neither overlay shows,
the game is `Running` and the freeze is elsewhere.

### Rendering blank or wrong

`paint` is a pure projection of `Game` into the surface, so if the game responds to keys (the overlay text
changes, the snake starts) but the window shows nothing or a stale frame, the split is between the model
and the renderer under `src/snake/paint/`. A blank frame with a responsive game points at the paint path;
an unresponsive game is the input case above, not a render bug.

## Source map

```
  src/userspace/init/capsule_boot/run.rs          [APP-SNAKE] capsule spawned / error path
  src/sys/boot_log/output.rs                      the ok() tag-and-message format
  src/userspace/init/spawn_plan/apps.rs           the feature-gated spawn and the empty stub
  userland/capsule_snake/src/snake/input.rs        key-down gate, anti-reversal, restart, Ready start
  userland/capsule_snake/src/snake/step.rs         the tick returns false unless Running
  userland/capsule_snake/src/snake/paint/overlay.rs  the PAUSED / GAME OVER overlays
  userland/app_skeleton/src/discover/require.rs    the compositor / wm / input_router peers
```

Every reference above is verified against those trees.
