---
title: "Controller bring-up and the broker grants"
description: "Before the driver can report anything about its device, it has to find the Intel Wi-Fi function, take exclusive ownership of it, map its registers, allocate a staging buffer, an..."
weight: 4
---
Before the driver can report anything about its device, it has to find the Intel Wi-Fi function, take
exclusive ownership of it, map its registers, allocate a staging buffer, and bring the device through its
early power-management sequence. That whole path is one ordered sequence in [`src/setup/sequence.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L19), and
this page mirrors it together with the folders it leans on: `src/setup/` (the sequence and the broker calls),
[`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs) (finding the device), [`src/init.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs) (the APM register bring-up), [`src/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs) (register
access), `src/constants/` (the offsets and bit definitions), and [`src/driver.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/driver.rs) (the built state). The
firmware selection and staging the driver holds are on the [firmware](/docs/userland/driver-iwlwifi/firmware/) page; the broker syscalls
themselves are documented on the [claim](/docs/subsystems/hardware-broker/claim/),
[MMIO](/docs/subsystems/hardware-broker/mmio/), [DMA](/docs/subsystems/hardware-broker/dma/), and
[IRQ](/docs/subsystems/hardware-broker/irq/) pages.

Each step is a broker call or a controller register step, and a failure returns a `&'static str` that setup
propagates, so `setup::run` returns `Err` and the process exits with code 2 without ever serving IPC
([`src/setup/sequence.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L19), [`src/main.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L39)).

## The bring-up sequence

1. **Discover.** `find_iwlwifi` calls `mk_device_list` and returns the first PCI function whose vendor is
   Intel (`0x8086`), whose bus kind is PCI, whose class/subclass is `02/80` (network controller, "other"),
   whose device id matches a supported family, and which has a non-zero interrupt pin and a valid interrupt
   line, with a non-zero MMIO BAR0 ([`src/discover.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L34), [`src/discover.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L57), [`src/constants/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L17)).
   The class match is the generic network/other class Intel Wi-Fi parts report, not a Wi-Fi-specific class.
   No match returns `None`, which setup turns into `iwlwifi: device not found`.
2. **Family check.** `family_for_device` maps the PCI device id to one of five families (7265, 8265, 9260,
   AX200, AX210); an unsupported id is `iwlwifi: unsupported device`
   ([`src/setup/sequence.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L21), [`src/firmware/family.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/family.rs#L19)). Discovery already required this to match, so
   this second check is belt-and-suspenders.
3. **Claim.** `mk_device_claim` on the device id returns a claim epoch ([`src/setup/claim.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L11)). The epoch
   is the token every later broker call must present, so a stale or revoked claim fails cleanly. A refusal
   (a non-positive return) is `iwlwifi: device claim failed`. See
   [device claim and epochs](/docs/subsystems/hardware-broker/claim/).
4. **Map BAR0.** `mk_mmio_map` maps BAR index 0 at offset 0 for its page-rounded size and returns a user
   virtual address, a length, and a grant id ([`src/setup/mmio.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L14), [`src/constants/mod.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L18)). The length
   is `(bar0_size + 0xFFF) & !0xFFF`, rounding up to a whole page ([`src/setup/mmio.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L16)). On failure the
   device is released and the error propagates ([`src/setup/mmio.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L19)). `Regs::new` later wraps the returned
   address for volatile register access ([`src/regs.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs#L23)). See
   [MMIO grants](/docs/subsystems/hardware-broker/mmio/).
5. **Bind IRQ.** `mk_irq_bind` is called with the device's PCI interrupt line and flags `0`, which is the
   legacy INTx path, not MSI-X ([`src/setup/irq.rs:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L15)). This is unlike the [NVMe driver](/docs/userland/driver-nvme/),
   which requests an MSI-X vector. On failure the MMIO grant is unmapped and the device released before the
   error propagates ([`src/setup/irq.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L17)). See [IRQ grants](/docs/subsystems/hardware-broker/irq/).
6. **Map DMA staging.** `mk_dma_map` allocates one 64 KiB (`FW_STAGING_SIZE`) region and returns a user
   virtual address, a device address, a length, and a grant id ([`src/setup/dma.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L22),
   [`src/constants/mod.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L20)). On failure the IRQ is unbound, the MMIO unmapped, and the device released, in
   that reverse order, before the error propagates ([`src/setup/dma.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L23)). See
   [DMA grants](/docs/subsystems/hardware-broker/dma/). This is the buffer the firmware staging writes into.
7. **APM bring-up.** `bring_up` runs the early power-management sequence over the mapped registers
   ([`src/init.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L23)). It sets `GP_CNTRL_XTAL_ON`, then `GP_CNTRL_MAC_ACCESS_REQ | GP_CNTRL_INIT_DONE`, then
   polls `CSR_GP_CNTRL` for `GP_CNTRL_MAC_CLOCK_READY` up to `APM_POLL_ITERS` (250000) iterations
   ([`src/init.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L24), [`src/constants/mod.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L35)). If the clock never comes ready it returns
   `iwlwifi: mac clock not ready`. On success it writes the interrupt-coalescing timeout, clears all
   interrupts by writing `0xFFFF_FFFF` to `CSR_INT`, disables the interrupt mask, clears the FH interrupt
   status, and reads the hardware revision from `CSR_HW_REV` ([`src/init.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L29)). It derives an `rf_kill` flag
   from whether `GP_CNTRL_INIT_DONE` is clear in the read-back general-control word ([`src/init.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L37)).
8. **Acknowledge the IRQ and build the driver.** After bring-up, `mk_irq_ack` acknowledges the bound
   interrupt grant, and the built `Driver` is assembled from the device identity, the four grants, the APM
   result, the family, the register accessor, and an empty firmware stage record
   ([`src/setup/sequence.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L28), [`src/driver.rs:12`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/driver.rs#L12)).

The built `Driver` owns the device id and PCI id, the claim epoch and the MMIO, IRQ, and DMA grants (with the
DMA user VA, device address, and length), the hardware revision, the captured `GP_CNTRL`, the `rf_kill`
flag, the family, the `Regs` accessor, and the firmware stage state ([`src/driver.rs:12`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/driver.rs#L12)).

## The broker grants the capsule holds

The driver reaches hardware only through grants, each scoped to the claim epoch.

| Grant | Where | What it is |
|---|---|---|
| Device claim | [`src/setup/claim.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L11) | the exclusive hold on the Intel Wi-Fi PCI function; the root of every other grant |
| MMIO | [`src/setup/mmio.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L14) | BAR0 mapped into the capsule as a user VA, wrapped by `Regs` |
| IRQ | [`src/setup/irq.rs:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L15) | one legacy INTx binding on the device's PCI interrupt line |
| DMA | [`src/setup/dma.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L22) | one 64 KiB broker-issued staging buffer with a user VA and a device address |

Unlike the NVMe driver, this capsule does not wrap its grants in `Drop` types; the rollback is handled
inline. Each setup step that can fail releases the grants acquired before it, in reverse order, right where
it fails ([`src/setup/mmio.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L19), [`src/setup/irq.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L17), [`src/setup/dma.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L23)). Because the server loop
never returns, that inline rollback runs only on an early error exit. The kernel also revokes every grant
tied to the claim when the process dies, so a crash cannot leak the claim, the mapping, the IRQ binding, or
the DMA buffer (see [revocation](/docs/subsystems/hardware-broker/revocation/)).

## The register block

`Regs` is a base address plus volatile 32-bit reads and writes, a `set_bits` read-modify-write, and a
`poll_set` that spins until a mask is set or an iteration cap is reached ([`src/regs.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs#L22)). The offsets and
bit definitions live in [`src/constants/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs): the control and status registers `CSR_INT_COALESCING` at
`0x004`, `CSR_INT` at `0x008`, `CSR_INT_MASK` at `0x00C`, `CSR_FH_INT_STATUS` at `0x010`, `CSR_GP_CNTRL` at
`0x024`, and `CSR_HW_REV` at `0x028` ([`src/constants/mod.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L22)). The `GP_CNTRL` bits are
`MAC_CLOCK_READY` (`0x2`), `INIT_DONE` (`0x4`), `MAC_ACCESS_REQ` (`0x8`), and `XTAL_ON` (`0x400`)
([`src/constants/mod.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L28)). All register access is 32-bit; there is no 64-bit access and no doorbell or
queue register touched, because the queue engine does not exist yet.

## Security posture at bring-up

This driver holds real hardware authority, so the trust question is not whether it can reach hardware but how
tightly that reach is bounded. The broker bounds it the same four ways it bounds the
[NVMe driver](/docs/userland/driver-nvme/bring-up/), each visible in the sequence above. The claim is device-scoped
and epoch-gated, so the capsule can only act on the one Intel Wi-Fi function it claimed and cannot use a
stale claim ([`src/setup/claim.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L11); [claim.md](/docs/subsystems/hardware-broker/claim/)). The MMIO grant
is exactly BAR0 of that function at a broker-chosen user address, clamped away from the MSI-X table, so the
driver never sees a physical address or another device's registers ([`src/setup/mmio.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L14);
[mmio.md](/docs/subsystems/hardware-broker/mmio/)). The IRQ is a legacy INTx binding the kernel programs;
the capsule receives only a grant id and drives it through ack, never touching the interrupt controller
([`src/setup/irq.rs:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L15); [irq.md](/docs/subsystems/hardware-broker/irq/)). The DMA region is a single
broker-issued grant with its own device address ([`src/setup/dma.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L22);
[dma.md](/docs/subsystems/hardware-broker/dma/)).

The honest caveat is the absence of an IOMMU on the current target. The DMA staging region is allocated and
a device address is returned, but nothing in hardware forces the controller to confine its DMA to that
buffer. In this capsule the point is softened by the fact that the firmware transfer is not wired up: the
device is never actually told to DMA the staged bytes, because the flow-handler registers are not programmed
(see the [firmware](/docs/userland/driver-iwlwifi/firmware/) page). But bus mastering is not disabled either, and the same universal DMA
caveat that applies to every hardware driver capsule applies here: without the `nonos-arch-iommu` backend
engaged, the broker bounds what the capsule may allocate and program, not what a malicious or buggy device
does once it is running. This is not specific to Wi-Fi.

## Source map

```
  userland/capsule_driver_iwlwifi/src/setup/sequence.rs   the whole ordered bring-up
  userland/capsule_driver_iwlwifi/src/setup/claim.rs      mk_device_claim -> epoch
  userland/capsule_driver_iwlwifi/src/setup/mmio.rs       mk_mmio_map for BAR0 and its rollback
  userland/capsule_driver_iwlwifi/src/setup/irq.rs        mk_irq_bind legacy INTx and its rollback
  userland/capsule_driver_iwlwifi/src/setup/dma.rs        mk_dma_map for the 64 KiB staging and its rollback
  userland/capsule_driver_iwlwifi/src/discover.rs         mk_device_list scan and the Intel Wi-Fi match
  userland/capsule_driver_iwlwifi/src/init.rs             bring_up: the APM clock sequence and hw revision read
  userland/capsule_driver_iwlwifi/src/regs.rs             Regs: volatile access, set_bits, poll_set
  userland/capsule_driver_iwlwifi/src/driver.rs           the built Driver struct
  userland/capsule_driver_iwlwifi/src/constants/mod.rs    PCI ids, CSR offsets, GP_CNTRL bits, FW_STAGING_SIZE, poll caps
  src/hardware/broker/                                    the broker grant paths the calls above reach
```

Every reference above is verified against those trees.
