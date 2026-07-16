---
title: "Contributing to capsule_driver_rtl8169"
description: "This page is for a contributor who wants to change the RTL8169 driver."
weight: 7
---
This page is for a contributor who wants to change the RTL8169 driver. It covers where the source lives,
which folder owns which concern, the steps to add a client op, how to build and sign the capsule, and the
code standards a change has to meet. For what the driver does and how it fits together, read the
[README](/docs/userland/driver-rtl8169/), the [operations](/docs/userland/driver-rtl8169/operations/) page, the [bring-up](/docs/userland/driver-rtl8169/bring-up/) page, and the
[rings](/docs/userland/driver-rtl8169/rings/) page.

## Where the source lives

The capsule is at `userland/capsule_driver_rtl8169/`. It is a `no_std`/`no_main` capsule: `_start`
initialises the heap, runs `setup::run` to acquire the broker grants, runs `init::bring_up` to reset and
enable the device, and hands the built `Driver` to `server::run`, which loops forever ([`src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L40)). The
top-level modules are declared there ([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NR69` wire format: header, ops, errno, limits, decode and encode | you change the request or reply layout |
| `src/server/` | the request loop and one handler per op | you add or change a client op |
| [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs), `src/discover/` | the `mk_device_list` scan and the Realtek match | you change how the NIC is found |
| `src/setup/` | the grant sequence, the `Driver` struct, and rollback | you change discovery, a grant, or teardown |
| `src/init/` | reset, MAC read, ring programming, and device enable | you change the device bring-up |
| `src/queue/` | the descriptor struct and the ring cursors | you change the ring layout |
| `src/tx/`, `src/rx/` | the transmit and receive paths | you change the frame movement |
| [`src/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs), `src/constants/` | register access, offsets, and bit definitions | you touch a register offset or bit |

## Adding a client op

There are three edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode constant to [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17), and re-export it from [`src/protocol/mod.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L34). If
   the op carries a fixed reply payload, add its length to [`src/protocol/limits.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L24) and re-export it from
   [`src/protocol/mod.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L30).
2. Write the handler as one file under `src/server/handlers/`, exposing a `handle` function that encodes the
   response header, writes the status word, and sends with `mk_ipc_send`, following `mac_address.rs` (a
   cached read) or `link_status.rs` (a live register read). A status-only op can delegate to
   `reply_with_status` ([`src/server/error.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L23)). Declare the module in [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17).
3. Wire it into the dispatch match in [`src/server/runner.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L53). An unrecognised opcode already falls through
   to `E_INVAL`, so the new arm is the only routing change.

If the op is meant to be reachable from the kernel-side client, mirror the opcode in
[`src/hardware/rtl8169_capsule/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/rtl8169_capsule/protocol/ops.rs#L17) and add a client method under
`src/hardware/rtl8169_capsule/client/`; the two opcode files must stay in lockstep.

## Touching a register or a descriptor bit

Register offsets and the command, config, interrupt, and descriptor bits all live in one place,
[`src/constants/regs.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L17). Add or change a constant there and reference it by name from the `init`, `tx`,
`rx`, or handler code; do not inline a raw offset or bit at a use site. The register accessor itself is
[`src/regs.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs#L19) and is a thin volatile 8/16/32-bit wrapper, so a new access is a call to `r8`/`r16`/`r32` or
`w8`/`w16`/`w32` at a named offset, never a raw pointer at a call site.

## Build and sign

The per-slug make targets are generated from the template in `nonos-mk/capsule.mk` and pulled in through
`userland/capsule_driver_rtl8169/Capsule.mk:18`.

```
  make nonos-mk-driver-rtl8169              build the capsule ELF
  make nonos-mk-driver-rtl8169-sign         produce the id cert, manifest, and attestation trailer
  make nonos-mk-driver-rtl8169-verify       verify the signed artifacts against the trust anchor
  make nonos-mk-check-driver-rtl8169-keys   assert the per-capsule signing keys exist
```

The source README also documents `make -B nonos-mk-driver-rtl8169` for a forced rebuild and the static gate
`bash nonos-ci/run-static-checks.sh`, whose RTL8169 rule is that the driver stays MMIO-only and requests no
PIO grant (`README.md:133`). The signed artifacts are embedded into a kernel image through
[`src/hardware/rtl8169_capsule/embed.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/rtl8169_capsule/embed.rs#L17).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every bring-up path returns a
  `Result<_, &'static str>` and every request path returns a status word; the release profile is
  `panic = "abort"` (`Cargo.toml:21`).
- One unit per file. New ops are one file per handler under `src/server/handlers/`, and the setup, init, tx,
  and rx steps are each one file. `mod.rs` is used only for module declarations and re-exports, matching the
  existing tree ([`src/protocol/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L17), [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17)).
- Every grant taken in setup must have a matching unmap. The `Driver::release` path unmaps the four DMA
  regions, unbinds the IRQ, unmaps the MMIO grant, and releases the claim in reverse order
  ([`src/setup/driver.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L38)), and a mid-sequence DMA failure rolls back the same way through
  `rollback::after` ([`src/setup/rollback.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/rollback.rs#L21)). A new grant must extend both.
- Keep the driver MMIO-only and raw-frame-only. Do not request a PIO grant, and do not add ARP, IP, socket,
  or firewall logic; that policy belongs above the driver in the [network stack](/docs/subsystems/networking/).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_driver_rtl8169/src/main.rs             _start -> setup::run -> init::bring_up -> server::run
  userland/capsule_driver_rtl8169/src/protocol/ops.rs     the opcode constants
  userland/capsule_driver_rtl8169/src/protocol/limits.rs  the fixed payload lengths
  userland/capsule_driver_rtl8169/src/protocol/mod.rs     the protocol re-exports
  userland/capsule_driver_rtl8169/src/server/handlers/mod.rs the handler module declarations
  userland/capsule_driver_rtl8169/src/server/runner.rs    the dispatch match
  userland/capsule_driver_rtl8169/src/server/error.rs     reply_with_status
  userland/capsule_driver_rtl8169/src/setup/driver.rs     the Driver struct and the release teardown
  userland/capsule_driver_rtl8169/src/setup/rollback.rs   the mid-sequence grant rollback
  userland/capsule_driver_rtl8169/src/constants/regs.rs   the register offsets and bit definitions
  userland/capsule_driver_rtl8169/src/regs.rs             the volatile register accessor
  userland/capsule_driver_rtl8169/Cargo.toml              panic = "abort" and the binary name
  userland/capsule_driver_rtl8169/Capsule.mk              slug, ports, mask; includes the generated targets
  src/hardware/rtl8169_capsule/protocol/ops.rs            the kernel-side opcode mirror
  src/hardware/rtl8169_capsule/embed.rs                   the signed-artifact embed into the kernel image
  nonos-mk/capsule.mk                                     the nonos-mk-driver-rtl8169[-sign|-verify] target template
```

Every reference above is verified against those trees.
