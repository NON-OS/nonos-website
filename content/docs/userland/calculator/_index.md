---
title: "The Calculator Capsule"
description: "The calculator is the model least-privilege NØNOS application: a signed userland capsule that draws its own window, reads pointer clicks and keys, runs a fixed-point arithmetic ..."
weight: 400
---
The calculator is the model least-privilege NØNOS application: a signed userland capsule that draws its
own window, reads pointer clicks and keys, runs a fixed-point arithmetic engine, and reaches nothing
outside its own surface. Where the [terminal](/docs/userland/terminal/) reaches the filesystem, the network,
and the installer, the calculator holds only the window-and-input envelope every GUI app needs and no
authority beyond it. Its source is organized into three code concerns, and this documentation mirrors that
structure one page per concern so a page can be read beside the folder it describes. The source is
`userland/capsule_calculator/`.

## Identity

Everything the kernel and the service registry need to name and reach the calculator comes from its
`Capsule.mk` and its kernel-side spawn record.

| Field | Value | Source |
|---|---|---|
| Capsule slug | `calculator` | `Capsule.mk:1` |
| Service handle | `app.calculator` | `Capsule.mk:2`, [`src/userspace/capsule_calculator/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_calculator/spawn.rs#L31) |
| Namespace | `systems.nonos.app.calculator` | `Capsule.mk:7` |
| Service endpoint | `service:4720:app.calculator` | `Capsule.mk:8`, `spawn.rs:32` |
| Reply endpoint | `reply:4721:endpoint.app.calculator.reply` | `Capsule.mk:9`, `spawn.rs:33`, `spawn.rs:34` |
| Capability mask | `0x1819` | `Capsule.mk:11` |
| Binary name | `calculator` | `Capsule.mk:5` |
| Kernel feature | `nonos-capsule-calculator` | `Capsule.mk:6` |
| Kernel mirror | `src/userspace/capsule_calculator` | `Capsule.mk:12` |

The mask `0x1819` decomposes bit by bit against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

```
  0x0001  CoreExec                bit()  1     types.rs:56
  0x0008  IPC                     bit()  8     types.rs:59
  0x0010  Memory                  bit() 16     types.rs:60
  0x0800  GraphicsDisplayQuery    bit() 2048   types.rs:67
  0x1000  GraphicsSurfaceCreate   bit() 4096   types.rs:68
  ------
  0x1819  = 1 + 8 + 16 + 2048 + 4096
```

The kernel spawn path requests exactly those five capabilities by name and no others
([`src/userspace/capsule_calculator/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_calculator/spawn.rs#L50)). There is no `Network` bit (4), no `FileSystem` bit
(64), no `Debug` bit (256), and no hardware, driver, MMIO, or DMA capability in the mask. The spawn spec
also sets an empty `debug_tag` (`spawn.rs:55`), so the capsule is granted no serial surface at all. This
is the whole basis of the security posture: the calculator can create a surface, ask the display for its
size, and speak IPC to the compositor through the app skeleton, and nothing else. The
[debugging](/docs/userland/calculator/debugging/) page walks the consequences.

## The three code concerns

The source under `userland/capsule_calculator/src/calc/` is a small set of modules, and the documentation
is one page for each of the three concerns a change would land in. Data flows one way: a click or a key
comes in through `event`, is turned into an `Action`, runs through `actions` against the arithmetic
engine, mutates one `State`, which `paint` turns into pixels.

```
  event/ + buttons/   ->   actions/ + op/unary/fixed/   ->   paint/
  input and the keypad     the evaluation engine             the frame
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [input.md](/docs/userland/calculator/input/) | `src/calc/event/`, `src/calc/buttons/`, [`src/calc/layout.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/layout.rs) | The full input reference: the 6x5 keypad grid every button by row, the keyboard keymap byte by byte, the pointer hit-test, the router, and how both inputs land on the same dispatch. |
| [engine.md](/docs/userland/calculator/engine/) | `src/calc/actions/`, [`src/calc/op.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/op.rs), [`src/calc/unary.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/unary.rs), [`src/calc/fixed.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/fixed.rs), [`src/calc/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/state.rs), `src/calc/format/` | The evaluation model: the fixed-point scale, the single-pending-operator machine, every operation and its checked arithmetic, the error latch, and number-to-text formatting. |
| [rendering.md](/docs/userland/calculator/rendering/) | `src/calc/paint/`, [`src/calc/theme.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/theme.rs) | How a frame is produced: the compose order, the display panel, the memory badge, the keypad grid, per-role button colours, and delivery to the compositor through the skeleton. |
| [contributing.md](/docs/userland/calculator/contributing/) | the whole tree | Where to work, how to add an operation, the build and sign steps for the `calculator` slug, and the code standards. |
| [debugging.md](/docs/userland/calculator/debugging/) | runtime | The one boot marker, why the capsule emits no serial of its own, and the concrete failure modes with where to look for each. |

## Lifecycle

The calculator is `no_std`/`no_main`. `_start` hands `calc::Calculator::new` to the app skeleton's `run`,
so the runtime owns the surface, the window, the input subscription, and the paint loop, and the calculator
supplies three things: a manifest for a normal window, an `on_event` that turns a keystroke or a click into
an arithmetic action, and a `paint` that draws the frame ([`src/main.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L27), [`src/calc/app.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/app.rs#L34)).

1. The kernel spawns the capsule at boot through the desktop fleet plan
   ([`src/userspace/init/spawn_plan/apps.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L21), `apps.rs:59`), which verifies the embedded ELF, id cert,
   manifest, and attestation trailer, holds its requested capabilities against its manifest ceiling, maps
   its ELF, registers `app.calculator` on port 4720, and logs `[APP-CALCULATOR] capsule spawned`
   ([`src/userspace/capsule_calculator/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_calculator/spawn.rs#L37), [`src/userspace/init/spawn_plan/apps.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L62),
   [`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)).
2. The skeleton `run` creates the window from the manifest (a 360x520 Normal window titled `Calculator`,
   subscribing to key-down, pointer button-down, and absolute pointer input) and drives the event and
   paint loop ([`src/calc/manifest.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/manifest.rs#L28)).
3. Each event flows in through `on_event`: a button-down goes to `on_pointer_button`, a key-down to
   `on_key`, and anything else is idle ([`src/calc/event/router.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/event/router.rs#L23)). A click hit-tests to a grid cell
   and runs its action; a key classifies to an action or is ignored ([`src/calc/event/on_pointer_button.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/event/on_pointer_button.rs#L24),
   [`src/calc/event/on_key.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/event/on_key.rs#L23)). Esc returns `EventOutcome::Close`; any handled action returns
   `EventOutcome::Repaint` (`on_key.rs:25`).
4. `paint` composes the frame in a fixed order: background, wordmark, the display value, the memory badge,
   then the keypad grid ([`src/calc/paint/frame.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/paint/frame.rs#L26)). The frame lands in the shared surface the
   compositor presents.

## Protocol and IPC

The calculator exposes no application opcodes of its own beyond what the app skeleton registers for it
(the `app.calculator` service on port 4720 and the reply inbox on 4721,
[`src/userspace/capsule_calculator/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_calculator/spawn.rs#L31)). It makes no outbound service calls of its own. Unlike the
terminal, there is no vfs client, no clipboard client, no network client, and no installer call anywhere
in the tree. Everything it does that leaves the capsule is the app envelope the skeleton owns: window
registration and the per-frame paint buffer, input delivery decoded into `InputEvent`s, and surface
presentation after a `Repaint` outcome ([`src/main.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L27), [`src/calc/manifest.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/manifest.rs#L28), [`src/calc/app.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/app.rs#L38)).
The manifest declares the exact input subscription: key-down, pointer button-down, and absolute pointer
motion ([`src/calc/manifest.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/manifest.rs#L23)). No other IPC surface exists in the capsule.

## Security posture

The calculator is the model least-privilege application in the catalog, and unlike the terminal it never
even uses the parts of the envelope that reach other services. Its authority is exactly the five bits
above and nothing more: it cannot read a block device, open a socket, resolve a name, touch a device
register, or write a log line. The empty `debug_tag` and the absent `Debug` bit mean the kernel grants it
no serial surface, so it leaves no trace on the wire beyond the frames the compositor already presents
(`spawn.rs:55`).

The privacy posture follows from the code, not just the manifest. The entire machine is the `State` struct
of a few integers ([`src/calc/state.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/state.rs#L28)); there is no file it reads, no file it writes, no socket, no
persistent identifier, and no history buffer. Every operand exists only in process memory and vanishes the
moment the user presses `AC` or the window closes. A compromise of the calculator gains an attacker exactly
those five capabilities and cannot pivot, because it never held the authority to ask.

The arithmetic is hardened against undefined behaviour to match. There is no `unsafe` outside the
`_start` extern, and every operation uses `checked_*` or `saturating_*` so overflow, division by zero, and
a negative square root become a typed `ErrorKind` and a red `Error` display rather than a wrap, a trap, or
a panic ([`src/calc/op.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/op.rs#L29), [`src/calc/unary.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/unary.rs#L20), [`src/calc/state.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/calc/state.rs#L20)). The release profile is
`panic = "abort"` (`Cargo.toml:26`), so even an unexpected panic terminates the capsule rather than
unwinding; the point of the checked arithmetic is that no reachable input reaches that path. The
[engine](/docs/userland/calculator/engine/) page traces this operation by operation.

## Source map

```
  src/main.rs                              _start -> run(Calculator::new)
  src/calc/mod.rs                          the module tree; re-exports Calculator
  src/calc/app.rs                          Calculator: owns one State; App impl (manifest/on_event/paint)
  src/calc/state.rs                        State: display, operand, operator, memory, error latch
  src/calc/fixed.rs                        i128 fixed-point scale (FRAC = 1e8, 8 fractional digits)
  src/calc/op.rs                           Op enum and apply(): the four binary operators
  src/calc/unary.rs                        square, reciprocal, integer sqrt
  src/calc/actions/                        one file per operation (digit, set_op, equals, memory_*, ...)
  src/calc/actions/dispatch.rs             Action -> handler dispatch
  src/calc/buttons/                        the 6x5 keypad grid, one file per row + kinds
  src/calc/event/                          router, key_classifier, on_key, on_pointer_button
  src/calc/format/                         number-to-text (integer, fraction, display, constants)
  src/calc/paint/                          the frame renderer (background, wordmark, display, badge, grid, button)
  src/calc/layout.rs                       grid/display geometry and hit_test
  src/calc/manifest.rs                     window title, size, and input subscription mask
  src/calc/theme.rs                        the phosphor-green palette
  Capsule.mk                               slug, handle, ports, capability mask, kernel mirror
  src/userspace/capsule_calculator/        the kernel-side embed and verified spawn
  src/userspace/init/spawn_plan/apps.rs    the desktop-fleet spawn entry
  nonos-mk/capsule.mk                      the generated nonos-mk-calculator[-sign|-verify] targets
```

Everything here is drawn from `userland/capsule_calculator/` (the capsule source and its `Capsule.mk`),
[`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bits), and the kernel spawn mirror under
`src/userspace/capsule_calculator/`. Every reference above is verified against those trees.
