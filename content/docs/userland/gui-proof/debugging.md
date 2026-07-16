---
title: "Debugging the GUI Proof"
description: "This capsule reports by drawing, not by an exit code or a proof marker, so debugging it is a matter of reading a window that either appears or does not."
weight: 4
---
This capsule reports by drawing, not by an exit code or a proof marker, so debugging it is a matter of
reading a window that either appears or does not. The overview and the identity table live on the
[README](/docs/userland/gui-proof/); the mechanics of what each draw call proves are on the [self-test page](/docs/userland/gui-proof/self-test/).
This page is the checklist for when the window is wrong or missing.

## What a pass looks like

A pass is a single small window titled `std GUI proof` ([`src/app.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L39)), opened at `160,140` and sized
`360x200` ([`src/app.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L42), `app.rs:43`, `app.rs:44`, `app.rs:45`). Inside it: a dark background, a blue
header bar across the top, the white label `nonos_std drives this GUI` on the bar, and a lighter line
reading `clicks: 0` below it ([`src/app.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L62), `app.rs:63`, `app.rs:65`, `app.rs:67`). Click anywhere in
the window and the count rises by one on the next frame; every click increments the counter and asks the
skeleton for a repaint ([`src/app.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L53), `app.rs:54`). Press Escape and the window closes
([`src/app.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L56)). That whole behaviour is the assertion: the label came out of a `nonos_std` `HashMap`,
the count line came out of `nonos_std::format!`, and both reached the screen through the shared paint
path. If you see it, `nonos_std` drove a real GUI.

There is no serial line to grep for. Unlike the [input proof](/docs/userland/input-proof/), this capsule
holds no `Debug` capability and calls no `mk_debug`; its verdict is entirely visual.

## What a failure looks like

A failure is the absence or corruption of that window. There are three shapes it can take, and each points
at a different layer.

| Symptom | Reading |
|---|---|
| No window at all | The capsule never spawned, or the skeleton could not open a surface. This is a build or spawn problem, not a paint problem, because this capsule is not in any build today. |
| Window opens but stays blank or shows a header bar with no text | The surface was created and cleared but a draw call or the font path failed. |
| Window opens with text but the count never moves on click | Input is not reaching the surface, so `on_event` never sees a `ButtonDown`. |

## Failure modes, from the outside in

### The capsule is not in the build

This is the first and most likely reason there is no window. The capsule ships no `Capsule.mk`, is in no
workspace member, and has no kernel spawn mirror under `src/userspace/`, so `make` does not build, sign, or
spawn it (`userland/capsule_gui_proof/README.md:3`, verified absent under `src/userspace/`). Nothing on the
desktop will open a `std GUI proof` window until that wiring exists. If you expected a window and got none,
confirm first that the capsule was actually built and spawned at all rather than looking for a paint bug
that cannot exist yet. [Contributing](/docs/userland/gui-proof/contributing/) describes the `Capsule.mk` and kernel mirror this
would take.

### The heap or the desktop peers did not come up

Once the capsule is spawned, the app skeleton owns the runtime. `_start` calls `run(app::GuiProof::new)`
([`src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L28)), and `run` does two things before any window can open: it initializes the heap, and it
resolves the desktop peers by name ([`userland/app_skeleton/src/runner/entry.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/entry.rs#L32), `entry.rs:36`). If the
heap fails, the skeleton exits with code `1` (`entry.rs:34`). If the four peers `compositor`, `wm`,
`input_router`, and `toolkit` are not all announced within the retry budget, `require_peers` returns an
error and the skeleton exits with code `2` ([`userland/app_skeleton/src/discover/require.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/discover/require.rs#L42),
`require.rs:47`, `entry.rs:38`). Both are silent to the screen, so a capsule that exits here leaves no
window and no message; the tell is that the process is gone, not stalled. This almost always means the
desktop compositor stack is not up yet, not that the capsule is broken.

### The window could not open

With the heap and peers in hand, the skeleton builds a fresh `GuiProof`, reads its manifest, and opens the
window ([`userland/app_skeleton/src/runner/boot.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/runner/boot.rs#L44), `boot.rs:45`). If `open_window` fails, `boot`
returns an error and the skeleton loops back to wait for the next delivery without opening anything
(`entry.rs:45`, `entry.rs:47`). No window appears, and the skeleton does not exit; it simply waits. A
capsule stuck here is running but invisible, which is distinct from the exit-code failures above.

### The window opens but does not paint its content

If the window is there but blank, the surface was created and the priming paint ran, but a draw call did
not land. The priming frame is `prime_frame`, called during boot (`boot.rs:47`), which invokes `paint`
once. `paint` first clears to the dark background and fills the header bar ([`src/app.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L62), `app.rs:63`),
so a window that is all dark with no bar means even the fill did not reach the surface. A window with the
bar but no text means the two `fb.text` calls did not render ([`src/app.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L65), `app.rs:67`), which points
at the toolkit font path ([`userland/app_skeleton/src/paint/text.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/paint/text.rs#L22)) rather than at this capsule, since
the label and the count go through the same call. The label specifically comes from
`self.labels.get(&0)` ([`src/app.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L64)); if the `HashMap` read failed it would fall back to an empty
string and you would see the bar with the count line but no label, which is the one failure that would
implicate `nonos_std` collections directly.

### The window paints but the click count never changes

If the count line stays at `clicks: 0` no matter where you click, the surface is drawing but input is not
arriving. `on_event` only increments on `InputKind::ButtonDown` ([`src/app.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L52)), and the manifest
subscribes to just two input bits, KeyDown and ButtonDown ([`src/app.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L46)). A count that never moves means
no `ButtonDown` is being delivered to this surface, which is a focus or router problem in the input path
rather than anything in this capsule. Escape not closing the window is the same story for the KeyDown bit:
`on_event` returns `Close` only on a delivered `KeyDown` with code `KEY_ESC` ([`src/app.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/app.rs#L56)), so if
Escape does nothing, key events are not reaching the surface either. The dedicated harness for that whole
delivery path is the [input proof](/docs/userland/input-proof/); if both keys and clicks are dead here, debug
it there.

## Reading the outcome

Because the verdict is visual, the debugging rule is to work outward in the order above: is it built and
spawned, did the runtime come up, did the window open, did it paint, does input land. The first stop that
fails is the layer to fix. There is no marker to misread and no exit code to interpret beyond the two the
skeleton uses for heap and peer failure; everything else is what you see on the screen.

## Source map

Everything here is drawn from [`userland/capsule_gui_proof/src/app.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_gui_proof/src/app.rs) and [`src/main.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs), the capsule's own
`README.md`, and the app skeleton under `userland/app_skeleton/src/` that provides the runner, the peer
discovery, the window setup, the priming frame, and the paint calls. The absence of a `Capsule.mk` and of a
kernel spawn mirror under `src/userspace/` is itself verified. Every reference above is verified against
those trees.
