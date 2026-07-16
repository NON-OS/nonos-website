---
title: "Mode-set: DISPI registers and the framebuffer clear"
description: "This page covers the DISPI half of the capsule: how it programs a linear-framebuffer mode by writing the BGA index registers, and how it then fills the framebuffer with a solid ..."
weight: 3
---
This page covers the DISPI half of the capsule: how it programs a linear-framebuffer mode by writing the
BGA index registers, and how it then fills the framebuffer with a solid colour. It mirrors `src/dispi/`,
[`src/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs), and the mode constants in [`src/constants.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs). For how the two BARs it writes here were
obtained, read [bring-up](/docs/userland/driver-bga/bring-up/).

Both steps run inside `setup::run` right after the two BARs are mapped: `set_mode` against the register
window, then `clear` against the framebuffer window ([`src/setup/sequence.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L37), [`src/setup/sequence.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L39)).

## The register window

The DISPI registers are reached through the mapped register BAR, not through x86 I/O ports. `Regs` is a
thin wrapper over the BAR's user virtual address with two volatile accessors, `r16` and `w16`, each a
`read_volatile`/`write_volatile` at `base + offset` ([`src/regs.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs#L24), [`src/regs.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs#L29),
[`src/regs.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs.rs#L33)). The capsule never mints a PIO grant and never issues `in`/`out`.

The naming is a known trap. The offset constant is called `DISPI_IOPORT_OFFSET` (`0x500`) after the
historical Bochs I/O-port interface, but here it is an offset inside the MMIO register BAR, and the DISPI
registers sit at MMIO offset `0x500` within that BAR ([`src/constants.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs#L24)). `dispi_off` turns a DISPI
index into a byte offset as `0x500 + index * 2`, because the registers are 16-bit and packed two bytes
apart ([`src/dispi/dispi_off.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dispi/dispi_off.rs#L19)).

| DISPI index | Constant | Meaning | Source |
|---|---|---|---|
| 1 | `DISPI_INDEX_XRES` | horizontal resolution | [`src/constants.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs#L25) |
| 2 | `DISPI_INDEX_YRES` | vertical resolution | [`src/constants.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs#L26) |
| 3 | `DISPI_INDEX_BPP` | bits per pixel | [`src/constants.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs#L27) |
| 4 | `DISPI_INDEX_ENABLE` | enable and mode flags | [`src/constants.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs#L28) |

## The mode-set sequence

`set_mode` writes five 16-bit registers in a fixed order ([`src/dispi/set_mode.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dispi/set_mode.rs#L24)). The order matters:
the BGA protocol requires the adapter to be disabled before the resolution registers change, and enabled
last, with the linear-framebuffer bit set alongside the enable bit.

| Write | Register (index) | Value | Source |
|---|---|---|---|
| disable | ENABLE (4) | `0` | [`src/dispi/set_mode.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dispi/set_mode.rs#L26) |
| x resolution | XRES (1) | `width` (1024) | [`src/dispi/set_mode.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dispi/set_mode.rs#L27) |
| y resolution | YRES (2) | `height` (768) | [`src/dispi/set_mode.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dispi/set_mode.rs#L28) |
| bit depth | BPP (3) | `32` | [`src/dispi/set_mode.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dispi/set_mode.rs#L29) |
| enable | ENABLE (4) | `DISPI_ENABLED \| DISPI_LFB_ENABLED` (`0x41`) | [`src/dispi/set_mode.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dispi/set_mode.rs#L30) |

The final enable value combines two bits: `DISPI_ENABLED` (`0x01`) turns the adapter on, and
`DISPI_LFB_ENABLED` (`0x40`) selects the linear-framebuffer path so the framebuffer BAR presents as a
flat, packed pixel array rather than the banked legacy VGA window ([`src/constants.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs#L30),
[`src/constants.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs#L31)). The `width` and `height` arguments come from the `MODE_WIDTH` and `MODE_HEIGHT`
constants that `setup::run` passes in ([`src/constants.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs#L33), [`src/setup/sequence.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L37)); they are not
negotiated with any client, and the capsule does not read EDID.

## The framebuffer clear

After the mode is live, `clear` fills the whole visible framebuffer with a single 32-bit colour. It
computes the pixel count as `MODE_WIDTH * MODE_HEIGHT` (`1024 * 768`) in `setup::run` and writes that
many volatile `u32` stores from the framebuffer base ([`src/setup/sequence.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L38), [`src/dispi/clear.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dispi/clear.rs#L19)).
The colour is the constant `CLEAR_COLOR` (`0x00102A3A`), a dark teal, so a successful bring-up shows a
solid panel rather than uninitialised memory ([`src/constants.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants.rs#L36)).

The clear assumes a packed layout: it walks pixels contiguously from the base, so it implicitly treats the
scanline stride as exactly `width * 4` bytes, the same value `setup::run` records in the `Driver`
([`src/setup/sequence.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L41)). That assumption is correct for the linear-framebuffer mode the mode-set
requested, but it is an assumption the capsule does not verify by reading back a hardware stride register;
see the garbled-fill case in [debugging](/docs/userland/driver-bga/debugging/).

## Why the registers are unabstracted

There is no display abstraction here beyond the two accessors and the offset helper. `set_mode` writes raw
indices and raw values through `Regs::w16`, `dispi_off` does the arithmetic, and `clear` writes raw
`u32`s ([`src/dispi/set_mode.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dispi/set_mode.rs#L24), [`src/dispi/dispi_off.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dispi/dispi_off.rs#L19), [`src/dispi/clear.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dispi/clear.rs#L19)). This is
deliberate for a bring-up capsule: it proves the DISPI path with the minimum code. A promoted version
would grow a mode table and a client-facing surface protocol on top of this, but the register vocabulary
would stay the same.

## Source map

```
  userland/capsule_driver_bga/src/dispi/set_mode.rs   the DISPI mode-set (disable, xres, yres, bpp, enable+lfb)
  userland/capsule_driver_bga/src/dispi/dispi_off.rs  DISPI index -> MMIO byte offset (0x500 + index*2)
  userland/capsule_driver_bga/src/dispi/clear.rs      solid-colour framebuffer fill
  userland/capsule_driver_bga/src/dispi/mod.rs        re-exports set_mode and clear
  userland/capsule_driver_bga/src/regs.rs             Regs: volatile 16-bit register accessors
  userland/capsule_driver_bga/src/constants.rs        DISPI offset and indices, mode, enable bits, clear colour
  userland/capsule_driver_bga/src/setup/sequence.rs   calls set_mode then clear on the mapped BARs
```

Every reference above is verified against those trees.
