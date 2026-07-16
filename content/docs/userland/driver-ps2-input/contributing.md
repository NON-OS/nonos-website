---
title: "Contributing to capsule_driver_ps2_input"
description: "This page is for a contributor who wants to change the PS/2 driver."
weight: 6
---
This page is for a contributor who wants to change the PS/2 driver. It covers where the source lives,
which folder owns which behaviour, the exact steps for the common changes, how to build and sign the
capsule, and the code standards a change has to meet, several of which are enforced by CI. For what the
driver does and how it is put together, read the [README](/docs/userland/driver-ps2-input/), the
[protocol and rings](/docs/userland/driver-ps2-input/protocol/), the [bring-up](/docs/userland/driver-ps2-input/bring-up/), and the [decode](/docs/userland/driver-ps2-input/decode/) pages in this
folder.

## Where the source lives

The capsule is at `userland/capsule_driver_ps2_input/`. It is a `no_std`/`no_main` broker-driven device
capsule, not a GUI app: `_start` initialises the heap, retries `setup::run` until bring-up succeeds, and
hands the `Driver` to the server loop ([`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31)). The top-level modules are declared there
([`src/main.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L19)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/setup/` | the ordered bring-up: claim, PIO grant, IRQ bind, and their rollbacks | you change how the device is acquired |
| `src/init/` | the i8042 keyboard and mouse enable sequences | you change the controller programming |
| `src/constants/` | port offsets, controller commands, config and status bits, PnP ids, ring capacity | you add a command or a status bit |
| [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs) | matching the PS/2 records on the ACPI bus | you change device matching |
| `src/poll/` | the per-byte drain and the Set 1 scancode absorber | you change how bytes are read or absorbed |
| `src/keymap/` | the Set 1 tables, translate, modifier tracking, the key input post | you change the keymap or key posting |
| `src/mouse/` | the 3-byte packet parser, the mouse ring, the mouse input post | you change mouse decoding or posting |
| `src/ring/` | the bounded keyboard event ring and its counters | you change the keyboard ring discipline |
| `src/protocol/` | the `NKBD` header, ops, limits, encode/decode, the reply endpoint | you change the wire format or add an op |
| `src/server/` | the recv/dispatch loop, the interrupt pump, and the op handlers | you change the loop or a handler |

## Extending the keymap

The Set 1 tables are internal to this capsule; there is no shared keymap crate to edit
([decode.md](/docs/userland/driver-ps2-input/decode/)). Printable and named base keys live in `src/keymap/set1/{left,right,function}.rs`
split by scancode range, the extended block in [`src/keymap/set1_e0.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/keymap/set1_e0.rs), and the keycode constants in
[`src/keymap/set1/keycodes.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/keymap/set1/keycodes.rs). Add a mapping to the right range's match and, if the value is a named key,
add its constant to `keycodes.rs` first. If you add a new modifier key, wire its bit into `modifier_bit`
so the modifier mask tracks it ([`src/keymap/post.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/keymap/post.rs#L31)); the `MOD_*` values must stay aligned with the
app-side contract and the USB HID driver ([`src/keymap/post.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/keymap/post.rs#L23)).

## Changing mouse decoding

Edit [`src/mouse/packet.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/packet.rs) for the byte layout and sign extension, and [`src/mouse/post.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/post.rs) for how a
`MouseEvent` becomes kernel input events. Keep the input post in the pump path only: the parser's comment
records that posting happens once, from the pump draining the ring, so absorbing must not also post or
every event reaches the kernel twice ([`src/mouse/parser.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/parser.rs#L26), [`src/server/pump.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/pump.rs#L36)).

## Adding or changing an op

There are three edits. Add the op constant to [`src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs) and re-export it through
[`src/protocol/mod.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L32). Add a handler file under `src/server/handlers/` and declare it in
[`src/server/handlers/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs); a handler builds its reply over `tx` and sends it to the kernel reply
endpoint, the way the existing handlers do. Add the match arm in `run` so the op is dispatched
([`src/server/runner.rs:68`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L68)). If the reply carries a payload, add its size constant to
[`src/protocol/limits.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs) and confirm the runner's transmit buffer is sized for it: the buffer is the max
of the four payload-bearing replies ([`src/server/runner.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L40)).

## Build and sign

The per-slug make targets are generated by the macro in `nonos-mk/capsule.mk:156`, pulled in through
`userland/capsule_driver_ps2_input/Capsule.mk:20`.

```
  make nonos-mk-driver-ps2-input            build the capsule ELF               capsule.mk:182
  make nonos-mk-driver-ps2-input-sign       id cert, manifest, attestation      capsule.mk:261
  make nonos-mk-driver-ps2-input-verify     verify artifacts vs trust anchor    capsule.mk:263
  make nonos-mk-check-driver-ps2-input-keys assert the per-capsule signing keys exist  capsule.mk:184
```

The rule names come from `nonos-mk-$(1)`, `nonos-mk-$(1)-sign`, `nonos-mk-$(1)-verify`, and
`nonos-mk-check-$(1)-keys` with the slug `driver-ps2-input` substituted for `$(1)`
(`nonos-mk/capsule.mk:158`). For a bootable kernel that includes this driver,
`make nonos-mk-driver-ps2-input-prod` builds under the `microkernel-driver-ps2-input` feature
(`Makefile:970`, `Cargo.toml:301`).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every fallible step returns a `Result`
  with a static error string, and the server drops damaged input rather than panicking; the release
  profile is `panic = "abort"` (`Cargo.toml:27`).
- One unit per file. New commands, tables, and handlers are one item per file, and `mod.rs` is used only
  for re-exports, matching the existing tree.
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

Several standards are enforced by [`nonos-ci/run-static-checks.sh`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh), so a change that breaks them fails CI:

- No `crate::drivers` import and no kernel `memory`/`paging`/`phys`/`hardware` import
  (`run-static-checks.sh:1158`, `:1167`).
- No raw `in`/`out` inline assembly; all port access goes through `mk_pio_read`/`mk_pio_write`
  (`run-static-checks.sh:1178`).
- No `#[allow(dead_code)]` without a written reason (`run-static-checks.sh:1189`).
- [`setup/pio.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/setup/pio.rs) rolls back via `mk_device_release` and [`setup/irq.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/setup/irq.rs) via `mk_pio_release`
  (`run-static-checks.sh:1194`).
- `OP_CONTROLLER_STATUS`, the 28-byte status payload, and the ring telemetry are present
  (`run-static-checks.sh:1206`).
- The AUX mouse path through IRQ12 is wired, and the `driver.ps2_kbd0` endpoint string is advertised
  (`run-static-checks.sh:1220`, `:1232`).

## Source map

```
  userland/capsule_driver_ps2_input/src/main.rs        _start and the module declarations
  userland/capsule_driver_ps2_input/src/setup/         the bring-up and rollbacks
  userland/capsule_driver_ps2_input/src/init/          the i8042 enable sequences
  userland/capsule_driver_ps2_input/src/keymap/        the Set 1 tables and the key post
  userland/capsule_driver_ps2_input/src/mouse/         the packet parser and the mouse post
  userland/capsule_driver_ps2_input/src/protocol/      the ops, limits, and reply endpoint
  userland/capsule_driver_ps2_input/src/server/        the loop, the pump, and the handlers
  userland/capsule_driver_ps2_input/Capsule.mk         slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                                  the nonos-mk-driver-ps2-input[-sign|-verify] macro
  Makefile                                             the -prod image target
  Cargo.toml                                           the microkernel-driver-ps2-input feature
  nonos-ci/run-static-checks.sh                        the PS/2 isolation, rollback, and mouse gates
```

Every reference above is verified against those trees.
