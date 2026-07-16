---
title: "Loading the firmware"
description: "The RTL8821CE carries an on-chip 8051 microcontroller that runs the real-time link work, and that microcontroller has no firmware until the host loads it."
weight: 3
---
The RTL8821CE carries an on-chip 8051 microcontroller that runs the real-time link work, and that
microcontroller has no firmware until the host loads it. Nothing else on the chip works until it does:
the MAC will initialise and the radio will tune, but without running firmware there is no link. Loading
it is the most intricate step of the bring-up, and it is where three of the on-silicon bugs in this
driver lived. This page documents the whole path, from the firmware image on flash to a booted 8051.
The orchestration is `fwload.rs`; the machinery is `fw/`.

## The image

The firmware is a Realtek image with a header and a set of memory sections. [`fw/header.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/fw/header.rs) parses the
header, confirms it is this chip's firmware, and reads the version, which the driver prints to the
console as the first sign the blob is the right one. [`fw/sections.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/fw/sections.rs) splits the body into its
sections. There are two that matter, each followed by an eight-byte checksum the hardware verifies:

```
  DMEM   the 8051 data memory,  on-chip destination OCPBASE_DMEM = 0x200000
  IMEM   the 8051 instruction memory, on-chip destination OCPBASE_IMEM = 0x030000
```

The section addresses in the header carry bit 31 set (`0x80200000` and the like). The hardware wants
the address with that bit cleared, so `sections.rs` masks it: `addr &= ~BIT(31)`, which is why the
destinations above are `0x200000` and `0x030000`. This was one of the "silent on silicon" corrections
made bringing the driver up: leave the bit set and the DDMA targets an address the chip does not have,
and nothing validates.

## The path the bytes take

The 8051's memory cannot be written directly by the host. The only channel into it is a direct-DMA
(DDMA) engine that copies out of the chip's own packet buffer. So each chunk of firmware travels a
two-hop path:

```
  host DMA buffer  ->  on-chip packet buffer (reserved page 0)  ->  8051 memory
      (beacon-queue transmit)          (DDMA channel 0)
```

The first hop reuses the transmit path: the driver stages the chunk as if it were a beacon, and the
card's transmit engine copies it into the on-chip packet buffer. The second hop is the DDMA engine
copying from the packet buffer into the 8051's IMEM or DMEM. [`fw/download.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/fw/download.rs) orchestrates the two
hops for every chunk of every section; the staging is [`fw/rsvd.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/fw/rsvd.rs), the DDMA is [`fw/ddma.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/fw/ddma.rs), and the
register work that brackets the whole download is [`fw/prep.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/fw/prep.rs).

## Staging a chunk (the first hop)

[`fw/rsvd.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/fw/rsvd.rs) stages one chunk into on-chip packet-buffer page 0. It lays a 48-byte transmit descriptor
and then the chunk into a host DMA buffer, publishes a beacon buffer descriptor pointing the card at
that buffer, arms the beacon-valid status, enables the software-beacon path, kicks the beacon queue,
and waits for the card to report the page landed:

```
  stage_chunk(chunk):
      write [48-byte TX descriptor | chunk] into the host staging buffer
      write a beacon buffer descriptor (buf address, sizes, own bit) into the ring
      write16 REG_FIFOPAGE_CTRL_2 = BCN_VALID           // arm beacon-valid (write-1-to-clear)
      set8   REG_CR+1  |= ENSWBCN                        // enable the software beacon path
      clr8   REG_FWHW_TXQ_CTRL+2 &= ~EN_BCNQ_DL          // hold off the auto beacon download
      set8   REG_TXBD_BCN_WORK |= PCI_BCNQ_FLAG          // kick the beacon queue
      poll   REG_FIFOPAGE_CTRL_2 & BCN_VALID != 0        // wait for the page to land
      return OCPBASE_TXBUF + 48                          // the DDMA source: past the descriptor
```

The DDMA source it returns is a constant: the firmware is always staged at page 0, so the source is the
packet-buffer base plus the 48 bytes of prepended descriptor. This mirrors the Realtek reference
driver's reserved-page write path step for step; only the card actually consuming the beacon page is
the part that can only be exercised on silicon.

## The DDMA channel (the second hop)

[`fw/ddma.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/fw/ddma.rs) copies one chunk from the packet buffer into 8051 memory over DDMA channel 0. A transfer
programs the source, the destination, and a control word, then waits for the channel to release
ownership:

```
  DDMA channel 0 registers:  SA = 0x1200, DA = 0x1204, CTRL = 0x1208

  control word bits:
      OWN               bit 31   host sets to start; card clears when done
      CHKSUM_EN         bit 29   compute and verify the transfer checksum
      CHKSUM_STS        bit 27   set by the card when the checksum did not match
      RESET_CHKSUM_STS  bit 25   reset the running checksum (first chunk of a section)
      CHKSUM_CONT       bit 24   continue the checksum from the previous chunk
      DLEN              bits 0-17  the transfer length (18 bits)

  transfer(src, dst, len, first):
      wait until OWN is clear
      ctrl = CHKSUM_EN | OWN | (len & 0x3FFFF)
      if not first: ctrl |= CHKSUM_CONT
      write32 SA = src; write32 DA = dst; write32 CTRL = ctrl
      wait until OWN is clear                            // the copy completed
```

These bit positions are the Realtek reference values, verified against its register header. An early
task brief claimed different values (a different checksum-enable bit, a 28-bit length); those are
wrong, and the code matches the reference, not the brief.

## The completion protocol

This is where the largest bug lived, and it is worth stating plainly because it is entirely
counter-intuitive. After a section's chunks are copied, the firmware control register
`REG_MCUFW_CTRL` (`0x0080`) must show that the section downloaded and its checksum was good. The bits
that show it are not set by the hardware. The driver sets them itself, in software, reading the DDMA
checksum status and then writing the matching pair of bits for the section's memory. This is
`ddma.rs`'s `record_section`, mirroring the reference driver's `check_fw_checksum`:

```
  record_section(dst):
      ok = (read32 DDMA_CTRL & CHKSUM_STS) == 0          // did the DDMA checksum pass?
      ctrl = read8 REG_MCUFW_CTRL
      if dst < OCPBASE_DMEM (0x200000):
          bits = IMEM_DW_OK (bit 3) | IMEM_CHKSUM_OK (bit 4)
      else:
          bits = DMEM_DW_OK (bit 5) | DMEM_CHKSUM_OK (bit 6)
      if ok: write8 REG_MCUFW_CTRL = ctrl | bits
      else:  write8 REG_MCUFW_CTRL = (ctrl | download-ok bit) & ~checksum-ok bit
      return ok
```

The symptom of getting this wrong was exact and confusing: the DDMA reported success, the driver's own
section checksums passed, but the firmware control register read `0x0001`, only the download-enable bit
the driver had set at the start, and the close-out then read the firmware as never checksummed and
failed. The transfer had been fine the entire time. Nothing in the hardware sets those progress bits;
the driver has to, and once it did, the download completed.

## The sub-4GB requirement

The transmit buffer descriptor the staging hop publishes addresses the host buffer with a 32-bit field.
On a machine with more than 4GB of RAM this is a trap. NØNOS's general allocator hands out the largest
usable memory region, which on such a machine is above the 4GB line, so the staging buffer is allocated
high, and its address is silently truncated when it is written into the 32-bit descriptor field. The
card then reads the wrong memory, and the download fails with no error, only garbage.

The fix is in the kernel, not the driver. [`src/kernel_core/init/memory.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/init/memory.rs) scans the memory map for a
below-4GB region the general allocator is not using, and carves a dedicated low DMA pool from it
([`src/hardware/broker/dma/pool.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/dma/pool.rs), the `low32` pool). DMA maps that do not explicitly ask for high
memory are satisfied from that pool first, so the firmware staging buffer, the rings, and the frame
buffers all land below the 4GB line where a 32-bit descriptor can address them. The driver reports the
high half of each DMA address during download, so a buffer that does land high is legible on the
console rather than silent, which is how the truncation was found in the first place.

## Booting the 8051

With every section copied and marked, [`fw/prep.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/fw/prep.rs) closes out the download and releases the
microcontroller. The close-out (`finish`) restores the queue registers the download reprogrammed, then:

```
  end flow:
      write32 REG_TXDMA_STATUS = BTI_PAGE_OVF            // clear the page-overflow status
      ctrl = read16 REG_MCUFW_CTRL
      if (ctrl & CHECK_SUM_OK) != CHECK_SUM_OK:          // both section checksums good?
          fail: ChecksumBad(ctrl)
      write16 REG_MCUFW_CTRL = (ctrl | FW_DW_RDY) & ~MCUFWDL_EN

  release the 8051:
      set8 REG_RSV_CTRL+1   |= WLMCU_IOIF               // restore its IO interface
      set8 REG_SYS_FUNC_EN+1 |= FEN_CPUEN               // release its run enable

  validate:
      poll REG_MCUFW_CTRL & 0xFFFF == FW_READY
```

`FW_READY` is `0xC078`: firmware-init-ready (bit 15), firmware-download-ready (bit 14), IMEM and DMEM
download-ok (bits 3 and 5), and both checksum-ok bits (4 and 6). The whole `finish` returns one of three
outcomes, and the driver prints which, so a firmware failure names its own cause on the console:
`Ready`, `ChecksumBad(ctrl)` (the DDMA delivered wrong bytes), or `NotReady(ctrl)` (the checksums were
good but the 8051 never reached ready). Printing the control-register value with the failure was what
turned `0x0001` from a mystery into the completion-protocol fix above.

## Verification

The whole download path is proven off silicon in `userland/rtl8821ce_proofs/`. A modeled device clears
the DDMA ownership bit as a real card would, records every register write, and the proofs assert the
exact source, destination, control word, and completion-bit program: `ddma_tests` for the channel and
the completion write-back, `prep_tests` for the close-out and the ready poll, `staging_tests` for the
reserved-page hop, `sections_tests` for the header and section split. The register bit values are the
reference driver's, transcribed and checked, not copied.

## Source

```
  userland/capsule_driver_rtl8821ce/src/fwload.rs          orchestration, the sub-4GB diagnostic
  userland/capsule_driver_rtl8821ce/src/fw/header.rs       image header parse
  userland/capsule_driver_rtl8821ce/src/fw/sections.rs     section split, the bit-31 mask
  userland/capsule_driver_rtl8821ce/src/fw/download.rs     the per-chunk two-hop loop
  userland/capsule_driver_rtl8821ce/src/fw/rsvd.rs         reserved-page staging (hop 1)
  userland/capsule_driver_rtl8821ce/src/fw/ddma.rs         the DDMA channel and record_section (hop 2)
  userland/capsule_driver_rtl8821ce/src/fw/prep.rs         download bracket, close-out, 8051 boot
  src/kernel_core/init/memory.rs                           the low DMA pool carve
  src/hardware/broker/dma/pool.rs                          the low32 pool
```
