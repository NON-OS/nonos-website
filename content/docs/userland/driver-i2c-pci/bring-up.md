---
title: "Controller bring-up and broker grants"
description: "This page covers the one-shot path that turns a PCI record into a live I2C master: discovery, the three broker grants, and the DesignWare reset with its SCL clock program."
weight: 2
---
This page covers the one-shot path that turns a PCI record into a live I2C master: discovery, the three
broker grants, and the DesignWare reset with its SCL clock program. It mirrors [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs),
`src/setup/`, and `src/init/`. For the request server that runs afterward see
[operations.md](/docs/userland/driver-i2c-pci/operations/); for the transfer engine the master drives see
[transfer-engine.md](/docs/userland/driver-i2c-pci/transfer-engine/).

Bring-up is one linear sequence ([`src/setup/sequence.rs:9`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L9)): discover, claim, map, bind, initialise,
ack, then build the `Driver`. Each step that can fail unwinds the grants it already took, so a partial
bring-up leaves no dangling claim or mapping.

## Discovery (Intel and PCI only)

`find_controller` calls the kernel `MkDeviceList` syscall into a 128-entry buffer and scans it
([`src/discover.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L34), `discover.rs:36`). A record qualifies only if `is_intel_i2c` holds: an Intel
vendor (`0x8086`) PCI (`BUS_KIND_PCI`) device of class serial bus (`0x0c`) whose PCI device id is in the
driver's static table ([`src/discover.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L60)). On top of that it must have a real interrupt pin and line
(`irq_pin != 0` and `irq_line != 0xFF`) and a non-zero MMIO BAR0 ([`src/discover.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L41), `discover.rs:46`).

The device table maps PCI id ranges to a family name and a source clock, spanning Skylake-era Sunrise
Point through Meteor Lake, plus Broxton, Gemini Lake, and Jasper Lake, with clocks of 120 MHz on the
older parts and 100 MHz on Tiger Lake and later ([`src/constants/mod.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L28)).

This is the first honest gap. Discovery is PCI and Intel only. A controller present on the platform but
enumerated through ACPI rather than PCI, or a PCI id not in the table, is not matched, and `setup::run`
fails with `i2c-pci: controller not found` ([`src/setup/sequence.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L10)). On a laptop where the LPSS
controllers are described in ACPI and never surface a matching PCI function, this driver will not find
them.

## Claim, map, bind

The three broker steps run in order against the discovered device id and the claim epoch. Each is one
file under `src/setup/`.

- **Claim.** `mk_device_claim` returns the epoch; a non-positive result is `i2c-pci: device claim failed`
  ([`src/setup/claim.rs:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L3), `claim.rs:5`). The epoch is the anti-stale token every later grant carries;
  see the [device claim](/docs/subsystems/hardware-broker/claim/) page.
- **Map.** `mk_mmio_map` maps BAR0 at offset 0, rounding the BAR0 size up to a page boundary
  (`(bar0_size + 0xFFF) & !0xFFF`), and on failure releases the claim before returning `i2c-pci: mmio map
  failed` ([`src/setup/mmio.rs:8`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L8), `mmio.rs:11`). The broker clamps the mapping to the BAR and withholds
  any MSI-X table pages; see the [MMIO](/docs/subsystems/hardware-broker/mmio/) page. The returned user
  VA becomes the register base ([`src/setup/sequence.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L14)).
- **Bind.** `mk_irq_bind` binds the device's PCI interrupt line, and on failure unmaps the MMIO grant and
  releases the claim before returning `i2c-pci: irq bind failed` ([`src/setup/irq.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L5), `irq.rs:9`). This
  is a legacy INTx bind: the request passes `irq_line` with zero flags, so the broker takes the INTx
  path, not MSI-X ([`src/setup/irq.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L7); the two bind modes are on the
  [IRQ](/docs/subsystems/hardware-broker/irq/) page).

## Controller reset and the clock program

`bring_up` ([`src/init/mod.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/mod.rs#L14)) resets the DesignWare master into a known state. It first disables the
controller and spins on `IC_ENABLE_STATUS` until the enable bit clears, failing with `i2c-pci:
controller disable timeout` if it never does ([`src/init/mod.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/mod.rs#L47), `mod.rs:55`). While disabled it
writes `IC_CON` to select master mode, fast speed, restart-enable, and slave-disable
([`src/init/mod.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/mod.rs#L16), [`src/constants/mod.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L65)), programs the SCL clock, zeroes the RX and TX FIFO
thresholds, masks all interrupts (`IC_INTR_MASK` = 0), and reads `IC_CLR_INTR` once to clear pending
state ([`src/init/mod.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/mod.rs#L24), `mod.rs:26`, `mod.rs:27`). Finally it reads and caches the component type,
component param, enable status, and status registers, which are the values `OP_CONTROLLER_INFO` returns
and the first four words of the register snapshot ([`src/init/mod.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/mod.rs#L28)).

The clock program is the load-bearing detail. The DesignWare master emits no SCL clock at all until the
HCNT/LCNT count pairs are programmed, and those registers are writable only while the controller is
disabled ([`src/init/mod.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/mod.rs#L20), `mod.rs:36`). `program_clock` writes the standard and fast SCL high/low
pairs and the SDA hold time, all derived from the discovered source clock ([`src/init/mod.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/mod.rs#L37)). The
counts follow the Linux dw_i2c formulas, `HCNT = clk_hz * tHIGH_ns / 1e9 - 3` and `LCNT = clk_hz *
tLOW_ns / 1e9 - 1`, with the bus timing budgets from the I2C specification
([`src/init/scl.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/scl.rs#L7), `scl.rs:23`). The arithmetic is saturating and every result is clamped into the
`u16` register width and to a floor of 1, so no source clock can produce a zero count, an overflow, or a
panic ([`src/init/scl.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/scl.rs#L31), `scl.rs:39`). This is the "no SCL clock" failure class the
[debugging](/docs/userland/driver-i2c-pci/debugging/) page covers: a controller whose count pairs were left at zero looks alive but
never toggles the line.

After bring-up the sequence acks the IRQ grant once ([`src/setup/sequence.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L16)) and assembles the
`Driver` ([`src/setup/sequence.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L17)).

## What bring-up produces

The `Driver` value the server carries is the whole runtime state: the device id, PCI device id, claim
epoch, MMIO and IRQ grant ids, bound vector, source clock, family name, the four cached DesignWare words,
and the register accessor ([`src/driver.rs:3`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/driver.rs#L3)). The accessor does raw volatile 32-bit reads and writes at
fixed offsets into the granted window ([`src/regs.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs#L11)), so every access lands inside the mapping the
broker installed.

## Source map

```
  userland/capsule_driver_i2c_pci/src/discover.rs        MkDeviceList scan, Intel/PCI-only match
  userland/capsule_driver_i2c_pci/src/constants/mod.rs   PCI id -> family/clock table, register offsets
  userland/capsule_driver_i2c_pci/src/setup/sequence.rs  discover -> claim -> map -> bind -> init -> ack
  userland/capsule_driver_i2c_pci/src/setup/claim.rs     mk_device_claim
  userland/capsule_driver_i2c_pci/src/setup/mmio.rs      mk_mmio_map, page-rounded BAR0, release on fail
  userland/capsule_driver_i2c_pci/src/setup/irq.rs       mk_irq_bind (INTx), unmap+release on fail
  userland/capsule_driver_i2c_pci/src/init/mod.rs        controller reset and the four cached words
  userland/capsule_driver_i2c_pci/src/init/scl.rs        the SCL count formulas
  userland/capsule_driver_i2c_pci/src/driver.rs          the Driver state bring-up returns
  userland/capsule_driver_i2c_pci/src/regs.rs            the volatile register accessor
  docs/subsystems/hardware-broker/{claim,mmio,irq}.md    the broker grant semantics
```

Every reference above is verified against those trees.
