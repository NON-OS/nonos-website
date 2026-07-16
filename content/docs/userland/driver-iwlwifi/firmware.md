---
title: "Firmware selection, TLV parsing, and staging"
description: "The one thing this capsule does beyond claiming and powering the device is prepare its firmware: it picks the right Intel .ucode blob for the detected family, validates the Inte..."
weight: 7
---
The one thing this capsule does beyond claiming and powering the device is prepare its firmware: it picks the
right Intel `.ucode` blob for the detected family, validates the Intel TLV header, and copies the firmware
sections into the DMA staging buffer in a deterministic layout. This page mirrors `src/firmware/`. It is also
the page that draws the honest line, because staging is where the driver stops: it formats the firmware into
RAM but never programs the flow-handler (FH) registers that would make the device fetch it, so the firmware
is prepared but not delivered. For how the DMA buffer was allocated see the [bring-up](/docs/userland/driver-iwlwifi/bring-up/) page; for
the op that triggers staging see the [operations](/docs/userland/driver-iwlwifi/operations/) page.

## The bundled blobs

Five Intel firmware blobs are linked into the capsule with `include_bytes!` from the Intel files shipped
under `nonos-bootloader/firmware/intel/`, so no filesystem authority is required to load them
([`src/firmware/blob.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/blob.rs#L16)):

| Family | Blob | Included from |
|---|---|---|
| `F7265` | `iwlwifi-7265D-29.ucode` | `nonos-bootloader/firmware/intel/iwlwifi-7265D-29.ucode` |
| `F8265` | `iwlwifi-8265-36.ucode` | `nonos-bootloader/firmware/intel/iwlwifi-8265-36.ucode` |
| `F9260` | `iwlwifi-9260-th-b0-jf-b0-46.ucode` | `nonos-bootloader/firmware/intel/iwlwifi-9260-th-b0-jf-b0-46.ucode` |
| `Ax200` | `iwlwifi-cc-a0-77.ucode` | `nonos-bootloader/firmware/intel/iwlwifi-cc-a0-77.ucode` |
| `Ax210` | `iwlwifi-so-a0-gf-a0-86.ucode` | `nonos-bootloader/firmware/intel/iwlwifi-so-a0-gf-a0-86.ucode` |

`blob_for_family` returns the name and byte slice for a family, and `OP_FIRMWARE_INFO` reports the name and
size of the one that was chosen ([`src/firmware/blob.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/blob.rs#L27), [`src/server/handlers/firmware.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/firmware.rs#L14)). The five
`.ucode` files are present in the tree, so the includes resolve at build time.

## Family selection

`family_for_device` maps a PCI device id to a `Family` ([`src/firmware/family.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/family.rs#L19)). The ranges are the
standard Intel Wi-Fi ids: `0x08B1..=0x08B4`, `0x095A`, `0x095B` for the 7265; `0x24F3..=0x24FD` for the
8265; a set including `0x2526`, `0x9DF0`, `0xA370`, `0x31DC` for the 9260; a set including `0x2723`,
`0x34F0`, `0x02F0` for the AX200; and a set including `0x2725`, `0x51F0`, `0xA74F` for the AX210
([`src/firmware/family.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/family.rs#L20)). The same function is called during discovery to reject an unsupported device
before it is claimed ([`src/discover.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L62)), so the family is already known by the time the driver is built.
The source README lists a "BE200" family in its supported list; the code does not define a `BE200` variant,
so that line in the source README is aspirational. The five families above are what the code selects.

## The Intel TLV header

`parse_header` validates the Intel firmware container before any section is staged
([`src/firmware/tlv.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/tlv.rs#L17)). It requires at least 20 bytes, a leading zero dword, the Intel magic
`IWL_FW_MAGIC` (`0x0A4C_5749`) at offset 4, and a version dword at offset 8 whose low 16 bits are the API
version. The API version must fall in `MIN_FW_API_VERSION..=MAX_FW_API_VERSION` (22 to 77), or the header is
rejected ([`src/firmware/tlv.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/tlv.rs#L28), [`src/constants/mod.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L40)). On success it returns the major, minor, and
API versions decoded from the version dword and the build number from offset 12. Every field read goes
through a bounds-checked `le32` that returns `None` on a short slice rather than reading out of range
([`src/firmware/tlv.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/tlv.rs#L39)).

## Section staging

`stage_firmware` walks the TLV records after the 20-byte header and copies the sections the driver cares
about into the DMA buffer ([`src/firmware/stage/stage_firmware.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/stage/stage_firmware.rs#L22)). For each record it reads a 4-byte type
and a 4-byte length, checks that the record body fits within the firmware slice, and if the type is one of
`TLV_SEC_RT` (20, runtime), `TLV_SEC_INIT` (21, init), or `TLV_PAGING` (33) and the body is at least 4 bytes,
it stages the section and counts it ([`src/firmware/stage/stage_firmware.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/stage/stage_firmware.rs#L33), [`src/firmware/tlv.rs:5`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/tlv.rs#L5)). The
walk advances by the record length rounded up to a 4-byte boundary, and stops when fewer than 8 bytes remain
(`stage_firmware.rs:44`).

`stage_section` is the copy, and it is bounds-checked against the DMA capacity
([`src/firmware/stage/stage_section.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/stage/stage_section.rs#L17)). For each staged section it writes a 12-byte record header into
the DMA buffer, the section's leading 4-byte address dword, a 4-byte little-endian payload length, and 4
zero bytes, followed by the section payload. The total per section is `12 + payload_len`, and if the running
destination offset plus that total would exceed the DMA capacity the whole staging fails with `None`, using
`checked_add` so the bound cannot overflow (`stage_section.rs:26`). `count_section` tallies the init,
runtime, and paging section counts into the state record ([`src/firmware/stage/count_section.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/stage/count_section.rs#L20)), and the
final `staged_bytes` is the total written (`stage_firmware.rs:46`). The resulting `FirmwareStageState`
carries the version fields, the three section counts, the staged byte total, and the alive flag and last
interrupt word, all zeroed by `empty()` until set ([`src/firmware/stage/state.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/stage/state.rs#L17),
[`src/firmware/stage/empty.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/stage/empty.rs#L19)).

Staging is triggered on demand by `OP_FIRMWARE_STAGE`, which calls `Driver::stage_firmware` and stores the
result on the driver ([`src/driver.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/driver.rs#L36), [`src/server/handlers/firmware_stage.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/firmware_stage.rs#L7)). Setup itself starts
with an empty stage record ([`src/setup/sequence.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L35)), so a client must ask for staging; it is not part of
the boot sequence.

## Where it stops: the FH transfer and alive

This is the honest boundary. Staging writes the firmware sections into the DMA buffer that the broker mapped,
and that is all it does. Nothing programs the flow-handler transfer control registers, sets the DMA source
and destination for the firmware image, or tells the device to fetch the staged bytes: there is no FH
transfer sequence in the code, and the only registers ever written are the APM and interrupt registers in
[`src/init.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs) and the interrupt acknowledgement in the alive poll. So the firmware is prepared in RAM and
never delivered to the controller.

`wait_for_alive` polls `CSR_INT` for the `INT_BIT_ALIVE` bit (`1 << 0`) up to `ALIVE_POLL_ITERS` (2000000)
iterations, and if it sees the bit it writes it back to acknowledge and returns `(true, last_int)`; otherwise
it returns `(false, last_int)` ([`src/firmware/alive.rs:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/firmware/alive.rs#L4), [`src/constants/mod.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L36)). Because the firmware
was never actually transferred to the device, the alive interrupt is not expected to fire on current
hardware, and `OP_ALIVE_WAIT` reports that honestly by returning `E_TIMEOUT`
([`src/server/handlers/alive.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/alive.rs#L13)). The alive poll is the correct mechanism waiting for a step that the
missing FH transfer never triggers.

The source README's next-slice list, "firmware command-queue execution, RX/TX ring initialization, and
passive scan command submission", is exactly the work that sits above this line and is not implemented here.
The pieces that exist, blob selection, header validation, and bounded section staging, are the inputs a real
firmware load would consume; the load itself, and everything past it (command queue, rings, association,
scan, and the `net.l2` handoff), is not in this capsule.

## Source map

```
  userland/capsule_driver_iwlwifi/src/firmware/mod.rs                 the firmware module re-exports
  userland/capsule_driver_iwlwifi/src/firmware/blob.rs                the five include_bytes blobs and blob_for_family
  userland/capsule_driver_iwlwifi/src/firmware/family.rs              family_for_device: PCI id -> Family
  userland/capsule_driver_iwlwifi/src/firmware/tlv.rs                 parse_header: Intel magic, API range, bounded le32
  userland/capsule_driver_iwlwifi/src/firmware/stage/stage_firmware.rs the TLV walk and section selection
  userland/capsule_driver_iwlwifi/src/firmware/stage/stage_section.rs  the bounds-checked copy into DMA
  userland/capsule_driver_iwlwifi/src/firmware/stage/count_section.rs  the init/runtime/paging tally
  userland/capsule_driver_iwlwifi/src/firmware/stage/state.rs          FirmwareStageState
  userland/capsule_driver_iwlwifi/src/firmware/stage/empty.rs          the zeroed initial state
  userland/capsule_driver_iwlwifi/src/firmware/alive.rs               wait_for_alive: the CSR_INT alive poll and ack
  userland/capsule_driver_iwlwifi/src/driver.rs                       Driver::firmware and Driver::stage_firmware
  userland/capsule_driver_iwlwifi/src/constants/mod.rs                IWL_FW_MAGIC, the API bounds, INT_BIT_ALIVE, poll caps
  nonos-bootloader/firmware/intel/                                    the bundled Intel .ucode blobs
```

Every reference above is verified against those trees.
