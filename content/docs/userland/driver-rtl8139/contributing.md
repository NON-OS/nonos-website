---
title: "Contributing to capsule_driver_rtl8139"
description: "This page is for a contributor who wants to change the RTL8139 driver."
weight: 9
---
This page is for a contributor who wants to change the RTL8139 driver. It covers where the source lives, which
folder owns which concern, the steps to add a client op, how to build and sign the capsule, and the code
standards a change has to meet. For what the driver does and how it fits together, read the [README](/docs/userland/driver-rtl8139/),
the [operations](/docs/userland/driver-rtl8139/operations/) page, the [bring-up](/docs/userland/driver-rtl8139/bring-up/) page, and the [buffers](/docs/userland/driver-rtl8139/buffers/) page.

## Where the source lives

The capsule is at `userland/capsule_driver_rtl8139/`. It is a `no_std`/`no_main` capsule: `_start` initialises
the heap, runs `setup::run` to take the grants, runs `init::bring_up` to program the NIC, and hands the built
`Driver` to `server::run`, which loops forever ([`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35)). The top-level modules are declared there
([`src/main.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L22)).

## Module map

| Folder | Owns | Touch it when |
|---|---|---|
| `src/protocol/` | the `NR89` wire format: header, ops, errno, limits, decode and encode, endpoint | you change the request or reply layout |
| `src/server/` | the request loop and one handler per op | you add or change a client op |
| [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs), `src/discover/` | the `mk_device_list` scan and the RTL8139 match | you change how the device is found |
| `src/setup/` | the grant sequence, its rollback, and the `Driver` struct | you change discovery, claim, or a grant |
| `src/init/` | reset, MAC read, RX/TX programming, IRQ unmask, RX/TX enable | you change the device bring-up |
| [`src/pio.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pio.rs) | the checked 8/16/32-bit port accessor | you change how a register is read or written |
| `src/rx/` | the circular receive buffer reader | you change the receive path |
| `src/tx/` | the four transmit slots and the completion poll | you change the transmit path |
| `src/constants/` | register offsets and bits, PCI ids, DMA sizes, frame bounds | you touch a register offset, bit, or size |

## Adding a client op

There are three edits, and the dispatch wiring is the load-bearing one.

1. Add the opcode constant to [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17), re-export it from [`src/protocol/mod.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L34), and, if it
   carries a fixed payload, add its length to [`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17).
2. Write the handler as one file under `src/server/handlers/`, exposing a `handle` function that encodes the
   response header, writes the status word, and sends with `mk_ipc_send`, following `mac_address.rs` (a cached
   read), `link_status.rs` (a live register read), or `stats.rs` (a multi-register snapshot). A status-only op
   can delegate to `reply_with_status` ([`src/server/error.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L23)). Declare the module in
   [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17).
3. Wire it into the dispatch match in [`src/server/runner.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L58).

An op that carries a client body follows `tx_packet.rs`: check the body length against the header's
`payload_len` and against the size bound before touching the device ([`src/server/handlers/tx_packet.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L24)).

## Keep it PIO-only

The defining architectural rule of this capsule is that it is port-mapped, not memory-mapped. It holds `Pio`
and not `Mmio`, and every register touch goes through the `Pio` accessor ([`src/pio.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pio.rs#L24)), never inline `in`
or `out` and never an MMIO mapping. A change that reaches for `mk_mmio_map` or adds the `Mmio` capability to
the manifest is wrong for this device; the RTL8139's registers live behind the port BAR and the broker's
[PIO path](/docs/subsystems/hardware-broker/pio/) is the only way in.

## Build and sign

The per-slug make targets are generated from the template in `nonos-mk/capsule.mk` and pulled in through
`userland/capsule_driver_rtl8139/Capsule.mk:18`.

```
  make nonos-mk-driver-rtl8139               build the capsule ELF
  make nonos-mk-driver-rtl8139-sign          produce the id cert, manifest, and attestation trailer
  make nonos-mk-driver-rtl8139-verify        verify the signed artifacts against the trust anchor
  make nonos-mk-check-driver-rtl8139-keys    assert the per-capsule signing keys exist
```

The signed ELF, id cert, manifest, and attestation trailer are embedded into the kernel image from
`nonos-data/trust/capsules/` and `userland/.../release/driver_rtl8139` when the
`nonos-capsule-driver-rtl8139` feature is set ([`src/hardware/rtl8139_capsule/embed.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/rtl8139_capsule/embed.rs#L17)).

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Every setup and init path returns a
  `Result<_, &'static str>` and every request path returns an errno word; the release profile is
  `panic = "abort"` (`Cargo.toml:21`).
- One unit per file. New ops are one file per handler under `src/server/handlers/`, and the rx and tx paths
  keep one step per file the way `src/rx/` and `src/tx/` already do. `mod.rs` is used only for module
  declarations and re-exports.
- Every grant taken in setup must have reverse-order rollback, which is what the inline failure arms and
  `rollback::after_irq` provide during setup ([`src/setup/rollback.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/rollback.rs#L21)) and what `Driver::release` provides
  after the driver is built ([`src/setup/driver.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L39)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1)
  and every other module.

## Source map

```
  userland/capsule_driver_rtl8139/src/main.rs               _start -> setup::run -> init::bring_up -> server::run; module list
  userland/capsule_driver_rtl8139/src/protocol/ops.rs       the opcode constants
  userland/capsule_driver_rtl8139/src/protocol/mod.rs       the protocol re-exports
  userland/capsule_driver_rtl8139/src/protocol/limits.rs    the fixed payload lengths
  userland/capsule_driver_rtl8139/src/server/handlers/mod.rs the handler module declarations
  userland/capsule_driver_rtl8139/src/server/runner.rs      the dispatch match
  userland/capsule_driver_rtl8139/src/server/error.rs       reply_with_status
  userland/capsule_driver_rtl8139/src/server/handlers/tx_packet.rs  the body-carrying op reference
  userland/capsule_driver_rtl8139/src/pio.rs                the checked port accessor
  userland/capsule_driver_rtl8139/src/setup/rollback.rs     the setup rollback
  userland/capsule_driver_rtl8139/src/setup/driver.rs       Driver::release teardown
  userland/capsule_driver_rtl8139/Cargo.toml                panic = "abort" and the binary name
  userland/capsule_driver_rtl8139/Capsule.mk                slug, ports, mask; includes the generated targets
  nonos-mk/capsule.mk                                       the nonos-mk-driver-rtl8139[-sign|-verify] target template
  src/hardware/rtl8139_capsule/embed.rs                     the embedded ELF, cert, manifest, and trailer
```

Every reference above is verified against those trees.
