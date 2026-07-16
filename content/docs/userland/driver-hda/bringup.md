---
title: "Controller bring-up and codec enumeration"
description: "This page mirrors the privileged half of the driver: src/discover.rs, src/setup/, src/controller/, and the register and constant helpers under src/regs/ and src/constants/."
weight: 2
---
This page mirrors the privileged half of the driver: [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs), `src/setup/`, `src/controller/`,
and the register and constant helpers under `src/regs/` and `src/constants/`. It is the whole path from
"a PCI function exists" to "a `Driver` that owns the register window and knows which codecs are present."
It runs exactly once, in `setup::run`, and unwinds any broker grant it took on any later failure
([`src/setup/sequence.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L27)). For the request loop that consumes the resulting `Driver`, see
[operations.md](/docs/userland/driver-hda/operations/); for the driver's place in the system, see the [README](/docs/userland/driver-hda/).

Everything below reads hardware through a thin register wrapper. `Regs` holds a base user VA and does
volatile 8/16/32-bit reads and 8/32-bit writes at `base + offset`; it is `Copy`, so it is passed by value
through the whole controller layer ([`src/regs/mmio.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/mmio.rs#L24), `:29`). The register offsets and the two bit
constants it uses live in [`src/constants/regs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs).

## The bring-up sequence

`setup::run` is the one-shot path, in order ([`src/setup/sequence.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L27)):

```
  find_hda            discover the HDA PCI function                sequence.rs:28
  claim               bind the device, get a claim epoch          sequence.rs:29
  enable_bus_master   set the PCI bus-master bit                   sequence.rs:30
  mmio::map           map BAR0, get a user VA and grant id         sequence.rs:34
  irq::bind           bind the controller interrupt               sequence.rs:35
  leave_reset         drive GCTL.CRST high and wait                sequence.rs:39
  ControllerInfo::read  snapshot the global registers             sequence.rs:40
  reject unusable     fail if vmaj or gcap read back zero          sequence.rs:41
  probe               STATESTS presence + vendor id per codec      sequence.rs:44
```

Each step that has already taken a broker grant releases it on the next failure, so no error path leaks a
claim, a mapping, or a binding. `enable_bus_master` releases the device on failure
([`src/setup/sequence.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L30)); `mmio::map` releases the device on a failed map ([`src/setup/mmio.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L26));
and `irq::bind` unmaps BAR0 and then releases the device on a failed bind ([`src/setup/irq.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L26)). Once
all three grants are held they are handed to a single `BrokerHandles` owner that frees them on drop
([`src/setup/sequence.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L36), described on the [operations](/docs/userland/driver-hda/operations/) page).

### Discovery

`find_hda` asks the broker for the audio-class device list and returns the first record that qualifies
([`src/discover.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L32)). It requests up to 32 records of class `CLASS_AUDIO` (`0x0050`) through
`mk_device_list` ([`src/discover.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L34), [`src/constants/pci.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/pci.rs#L17)). A record is a candidate only when all
of these hold ([`src/discover.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L50)):

```
  bus_kind == PCI
  class == CLASS_AUDIO
  pci_class == 0x04         multimedia
  pci_subclass == 0x03      HD Audio
  bar_count > 0             BAR0 present
  irq_pin != 0              has an interrupt pin
  irq_line != 0xff          has a routed interrupt line
  bar[0].kind == MMIO
  bar[0].size >= 0x1000     at least 4 KiB
```

The `0x04`/`0x03` class/subclass pair is the PCI code for an HD Audio controller
([`src/discover.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L22), `:23`). The returned `Found` carries the `device_id`, the `irq_line`, and the
BAR0 size, which are the three inputs the rest of setup needs ([`src/discover.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L26)). If nothing matches,
`find_hda` returns `None` and setup fails with `DeviceNotFound` ([`src/setup/sequence.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L28)).

### Claim, bus master, BAR0 map, IRQ bind

These four steps are the broker bring-up, each a thin wrapper around one broker syscall, each turning a
negative return into `BrokerCallFailed`.

- **Claim.** `claim` calls `mk_device_claim(device_id)` and returns the claim epoch; a negative return is
  a failure ([`src/setup/claim.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L21)). Every later broker call carries that epoch, and the broker rejects
  a stale one. The claim is the root authority; see the [device claim](/docs/subsystems/hardware-broker/claim/)
  page for the epoch rule.
- **Bus master.** `enable_bus_master` sets the PCI command register's bus-master bit through
  `mk_pci_config_write` on the claimed function, not by poking config space directly
  ([`src/setup/pci.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L21)). It is enabled ahead of the future stream-DMA work; in this slice the controller
  does no DMA because the driver programs no stream.
- **Map BAR0.** `mmio::map` maps BAR0, the HDA register window, into the capsule's address space and
  returns a user VA and a grant id ([`src/setup/mmio.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L22)). It passes offset 0 and the full BAR size, so
  the whole register window is mapped ([`src/setup/mmio.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio.rs#L24), [`src/constants/pci.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/pci.rs#L18)). The broker
  clamps the mapping to the BAR and withholds any MSI-X table pages; see the
  [MMIO](/docs/subsystems/hardware-broker/mmio/) page.
- **Bind IRQ.** `irq::bind` binds the controller's interrupt line through `mk_irq_bind` and returns a
  grant id ([`src/setup/irq.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L22)). The interrupt is polled and acked at runtime but gates nothing: every
  query is a synchronous register read. See the [IRQ](/docs/subsystems/hardware-broker/irq/) page.

### Leaving reset

`leave_reset` reads `GCTL`, sets `GCTL.CRST` (bit 0) if it is clear, and spins until the controller
reports `CRST` set, meaning it has come out of reset and is running ([`src/controller/reset.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/reset.rs#L23)). The
spin is bounded at one million iterations; if `CRST` never reads back set, it returns
`ControllerResetTimeout` ([`src/controller/reset.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/reset.rs#L21), `:35`). The register offset and the `CRST` bit
are `GCTL = 0x08` and `GCTL_CRST = 1 << 0` ([`src/constants/regs.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L22), `:31`).

Note the polarity. On HDA `CRST = 1` is the run state and `CRST = 0` is the reset state, so this step
drives the bit high and waits for it to stay high, the opposite of the AHCI `GHC.HR` self-clearing reset.
The driver only sets the bit if it is currently clear, so a controller already out of reset is left alone
and the spin observes it immediately ([`src/controller/reset.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/reset.rs#L25)).

### Reading controller info

`ControllerInfo::read` snapshots the controller-global registers into a plain `Copy` struct
([`src/controller/info.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/info.rs#L40)). It reads `GCAP`, `VMIN`, `VMAJ`, `OUTPAY`, `INPAY`, `GCTL`, `STATESTS`,
`GSTS`, `INTCTL`, and `INTSTS`, each at its fixed offset ([`src/controller/info.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/info.rs#L41),
[`src/constants/regs.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L17)). From `GCAP` alone it derives four counts, described next
([`src/controller/info.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/info.rs#L53)).

Setup then rejects an unusable controller: if the major version or `GCAP` reads back as zero, it fails
with `UnsupportedController` ([`src/setup/sequence.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L41)). A controller that answers with all-zero global
registers is either absent behind a bad mapping or not an HDA controller, and the driver refuses to
proceed rather than probe garbage.

### The `GCAP` stream counts

The stream counts are a decode of the `GCAP` bitfield, not a read of any stream register
([`src/controller/streams.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/streams.rs#L17)):

```
  input_streams   (gcap >> 8)  & 0x0f     bits 8..11
  output_streams  (gcap >> 12) & 0x0f     bits 12..15
  bidi_streams    (gcap >> 3)  & 0x1f     bits 3..7
  addr64           gcap & 1               bit 0, 64-bit-address capable
```

These four values ride along in every `ControllerInfo` and feed both the `OP_CONTROLLER_INFO` reply and
the stream-layout derivation ([`src/controller/info.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/info.rs#L53)).

### The stream layout derivation

The stream layout is a computed projection of those counts, not a read of live stream descriptors.
`layout` appends the input streams, then the output streams, then the bidirectional streams, in that
order, assigning each a running global index and the standard descriptor offset
([`src/controller/stream_layout.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/stream_layout.rs#L32)). Each descriptor's offset is `0x80 + global_index * 0x20`, and the
whole list is capped at 64 entries ([`src/controller/stream_layout.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/stream_layout.rs#L48), [`src/controller/streams.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/streams.rs#L19)).

No stream register is read and no stream is programmed. The offsets tell a client where the descriptors
would live once playback and capture are implemented; they are the address arithmetic, not a live view.
Each `StreamDescriptor` carries a `kind` (1 input, 2 output, 3 bidirectional), a per-kind `local_index`, a
`global_index`, and the computed `mmio_offset` ([`src/controller/streams.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/streams.rs#L20), `:24`).

## The immediate-command codec interface

This slice reads codec identity through the controller's immediate-command registers (`IC`/`IR`/`IRS`),
not a CORB/RIRB verb ring ([`src/controller/immediate.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/immediate.rs#L17), [`src/constants/regs.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L27)). The immediate
interface sends one verb at a time and reads one response, which is exactly enough for inventory.

`get_parameter` composes a 32-bit verb and sends it ([`src/controller/immediate.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/immediate.rs#L23)). The verb is
packed from the codec address, the node id, the 12-bit verb code, and an 8-bit parameter
([`src/controller/immediate.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/immediate.rs#L62)):

```
  bits 31..28   codec address & 0x0f
  bits 27..20   node id & 0x7f
  bits 19..8    verb & 0x0fff        VERB_GET_PARAMETER = 0x0f00
  bits 7..0     payload & 0xff       PARAM_VENDOR_ID = 0x00
```

`send` runs the handshake ([`src/controller/immediate.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/immediate.rs#L27)): it waits for `IRS.BUSY` to clear, writes
`IRS.VALID`, writes the verb to `IC`, sets `IRS.BUSY`, then waits for `BUSY` to clear with `VALID` set
before reading the response from `IR`. Both waits are bounded at one million spins with a
`spin_loop` hint; the busy wait times out to `ImmediateCommandBusy` and the response wait to
`ImmediateResponseTimeout` ([`src/controller/immediate.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/immediate.rs#L37), `:49`, `:21`). The bit constants are
`IRS_BUSY = 1 << 0` and `IRS_VALID = 1 << 1` ([`src/constants/regs.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L32), `:33`).

The only verb this slice ever issues is `Get Parameter(Vendor ID)` ([`src/controller/codec_probe.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/codec_probe.rs#L48)).
CORB/RIRB verb transport is a named future target, not present here
(`userland/capsule_driver_hda/Capsule.mk:4`).

## Probing the codecs

`probe` walks the 15 codec slots and builds one `CodecProbe` per slot
([`src/controller/codec_probe.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/codec_probe.rs#L32), `:21`). A slot is present when its `STATESTS` bit is set: for each
address, `present = (statests >> address) & 1` ([`src/controller/codec_probe.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/codec_probe.rs#L36)). An absent slot yields
an all-zero probe with `present = 0`; a present slot is passed to `read_vendor`
([`src/controller/codec_probe.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/codec_probe.rs#L37)).

`read_vendor` issues `get_parameter(address, node 0, PARAM_VENDOR_ID)` on the immediate interface
([`src/controller/codec_probe.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/codec_probe.rs#L48)). On success it splits the 32-bit response: the vendor id is the high
16 bits and the device id the low 16 bits, and it records `ok = 1`
([`src/controller/codec_probe.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/codec_probe.rs#L52)). If the verb times out it records `present = 1, ok = 0` with zero
ids, so a present-but-unresponsive codec is distinguishable from an identified one
([`src/controller/codec_probe.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/codec_probe.rs#L56)). Note the difference in severity: a codec whose immediate interface
never clears busy or never returns a valid response at setup fails the whole bring-up with
`ImmediateCommandBusy` or `ImmediateResponseTimeout`, because the timeout propagates out of `read_vendor`
only as a per-codec `ok = 0`, while a hang inside the handshake surfaces as a setup error. The probe
result array becomes the `Driver`'s codec inventory, read later by `OP_CODEC_LIST`
([`src/setup/sequence.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L45)).

## What is implemented and what is not

Implemented in this slice:

- Controller discovery, claim, bus-master enable, BAR0 mapping, and IRQ bind
  ([`src/setup/sequence.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L28)).
- Reset release by driving `GCTL.CRST` high ([`src/controller/reset.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/reset.rs#L23)).
- Live controller-global register snapshot and `GCAP`-derived stream counts and address width
  ([`src/controller/info.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/info.rs#L40)).
- Codec-presence detection from `STATESTS` ([`src/controller/codec_probe.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/codec_probe.rs#L36)).
- Per-codec vendor and device id via the immediate-command `Get Parameter(Vendor ID)` verb
  ([`src/controller/codec_probe.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/codec_probe.rs#L48)).
- Computed stream-descriptor offsets `0x80 + i * 0x20` ([`src/controller/stream_layout.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/controller/stream_layout.rs#L48)).

Not implemented, and deliberately so: there is no CORB/RIRB verb ring, no buffer descriptor list, no
stream-descriptor programming, no PCM playback, no PCM capture, no mixer, and no jack or volume policy.
The driver holds no `Dma` capability and calls no DMA broker syscall, so it allocates no command ring, no
BDL, and no sample buffer. The bus-master bit is set ahead of that future work, but nothing programs the
controller to move data. Audio comes later, after CORB/RIRB and stream DMA are real
(`userland/capsule_driver_hda/Capsule.mk:4`, `Cargo.toml:5`).

## Source map

This page is drawn from the discovery, setup, controller, register, and constant modules of the capsule,
and from the broker grant contracts under `docs/subsystems/hardware-broker/`.

```
  userland/capsule_driver_hda/src/discover.rs                  find_hda and the candidate predicate
  userland/capsule_driver_hda/src/setup/sequence.rs            the one-shot bring-up, in order
  userland/capsule_driver_hda/src/setup/claim.rs               mk_device_claim wrapper
  userland/capsule_driver_hda/src/setup/pci.rs                 bus-master bit via mk_pci_config_write
  userland/capsule_driver_hda/src/setup/mmio.rs                BAR0 map via mk_mmio_map
  userland/capsule_driver_hda/src/setup/irq.rs                 interrupt bind via mk_irq_bind
  userland/capsule_driver_hda/src/setup/driver.rs              the Driver struct
  userland/capsule_driver_hda/src/controller/reset.rs          leave_reset: GCTL.CRST high and wait
  userland/capsule_driver_hda/src/controller/info.rs           ControllerInfo::read
  userland/capsule_driver_hda/src/controller/streams.rs        GCAP bitfield decode and StreamDescriptor
  userland/capsule_driver_hda/src/controller/stream_layout.rs  computed descriptor offsets
  userland/capsule_driver_hda/src/controller/immediate.rs      IC/IR/IRS immediate-command transport
  userland/capsule_driver_hda/src/controller/codec_probe.rs    STATESTS presence + vendor-id probe
  userland/capsule_driver_hda/src/regs/mmio.rs                 volatile register accessors
  userland/capsule_driver_hda/src/constants/regs.rs            HDA register offsets and bit constants
  userland/capsule_driver_hda/src/constants/pci.rs             PCI class and BAR constants
  docs/subsystems/hardware-broker/claim.md                     the claim and epoch
  docs/subsystems/hardware-broker/mmio.md                      the BAR0 mapping and MSI-X clamp
  docs/subsystems/hardware-broker/irq.md                       the interrupt bind
```

Every reference above is verified against those trees.
