---
title: "Debugging the wireless stack"
description: "Bringing a Wi-Fi chip up on real silicon is a specific kind of hard: the failures are silent, the target often has no serial port, and a wrong register value produces a chip tha..."
weight: 500
---
Bringing a Wi-Fi chip up on real silicon is a specific kind of hard: the failures are silent, the
target often has no serial port, and a wrong register value produces a chip that looks healthy while
being deaf, mute, or asleep. This page documents how the NØNOS wireless stack is made observable and
how it is debugged, because the observability is a design feature of the driver, not an afterthought.
The methods here are the ones that actually took the RTL8821CE from "not present" to a keyed link, and
they generalise to the rest of the network stack.

## The first line: host proofs

Before any of it touches hardware, the chip-specific logic runs against a modeled device on the build
host. `userland/rtl8821ce_proofs/` includes the real driver source through `#[path]` and drives it with
a fake `Mmio` that stores register values, so a read-modify-write behaves and the exact register program
is asserted. The DDMA control words, the completion-bit write-back, the transmit/receive engine enable,
the antenna-switch register program, the receive-path select, the transmit-power write, the association
frame handling: each is a known-answer test that fails on the host the moment a bit is wrong.

This matters because it removes a whole class of bug from the silicon loop. Compiling is not the same
as working, but a proof that asserts "this function writes `0xC5A0` to `0x010C` and `0xFF` to `0x0100`
in that order" catches a transposed value at the desk, not after a ten-minute rebuild-and-reflash
cycle. When the on-silicon behaviour disagreed with a passing proof, the disagreement itself was the
clue: the code was doing what the reference driver documented, so the missing piece was something the
reference did that had not been transcribed yet.

## The lifeline: a console without a serial port

A retail laptop has no serial port, so the usual bring-up console is gone. NØNOS replaces it two ways.
The driver writes one-line progress messages through `status.rs`, which calls the debug output syscall,
and the desktop coordinator routes the kernel's debug output and those messages onto the framebuffer,
so a boot is legible on the screen the laptop does have. Every stage of the bring-up prints a line:

```
  [rtl8821ce] chip powered and answering
  [rtl8821ce] firmware v24.11
  [rtl8821ce] firmware loaded and ready
  [rtl8821ce] trx engines enabled
  [rtl8821ce] mac initialised
  [rtl8821ce] phy configured
  [rtl8821ce] serving net_core
```

The value of this is not that it prints success. It is that it prints exactly how far a failing boot
got, and the last line printed names the failing stage. When the firmware download failed, the console
did not say "error"; it said `fw: hardware checksum not ok, ctrl=0x0001`, and the `0x0001` was the whole
diagnosis. Debug output is only useful if it carries the value that distinguishes the causes, so the
driver prints register values with its failures, not just labels.

## Never exit, never hang

A driver that exits or hangs on a failure erases its own evidence. Its service never registers, and from
userland the chip is indistinguishable from one that was never installed. So the driver is built to do
neither. `bring_up` stops at the first failing step and returns how far it reached as a `Stage`, and
`serve::run` serves forever regardless, on a link that is simply always down when the radio never came
up. The service stays registered, so the failure is a queryable fact rather than an absence.

The Settings panel reads that fact back. `OP_STATUS` returns the one-byte stage, and the panel turns it
into a sentence on screen: "Wi-Fi radio: firmware load failed", "power-on failed", "efuse read failed".
This closed the loop on a machine where the boot console scrolls past too fast to photograph: the panel
holds the stage still, and the stage says which page of this section to open.

## The receive pipeline, counted

Getting the radio to hear was the hardest single step, and a boolean "did it scan" was useless: the
scanner ran perfectly while the antenna was disconnected. So the driver counts the receive pipeline and
reports the counts, not just the result. The background scanner tracks how many times it ran, how many
raw frames the ring delivered, and how many of those parsed as beacons, and `OP_SCAN` returns those
counts to the panel, which prints them under the network list:

```
  rx: passes=3236 frames=0 beacons=0
```

Each reading points at a different layer, and the table is the debugging procedure:

```
  passes = 0                 the scanner never ran            scheduling / clock
  passes > 0, frames = 0     the ring delivered nothing       DMA interface / RF receive path
  frames > 0, beacons = 0    frames arrive but do not parse   frame format / parser
  frames > 0, beacons > 0    it works, just not cached        deduplication
```

This is the counted-pipeline pattern, and it is worth stating as a general method: when a multi-stage
data path produces nothing, instrument every stage's throughput and surface the counts where they can
be read, because the stage whose count is zero while its predecessor's is not is the broken one. The
`passes=3236 frames=0` reading is what proved the DMA was fine and the fault was the radio, and pointed
straight at the missing receive-path enable and antenna switch.

## Naming the failure at every seam

The same discipline runs through the connect path. `OP_CONNECT` returns a status code, and the codes are
specific: `-2` no such network on the air, `-5` the access point refused, `-6` frames were sent but
nothing came back, `-100/-101` the driver was unreachable or too slow. A `-6` with the correct
passphrase is not "connect failed"; it is "the beacon was found, so receive works on that channel, and
the auth frames went out but drew no reply, so the fault is on transmit." That reading is what isolated
the missing transmit-power step: the receiver was proven, the frames were sent, and they were leaving
the antenna at zero power because power had never been set. The panel prints the code, so the failure is
diagnosable from the screen without a rebuild.

## The silicon loop

Put together, the loop for a change to on-silicon behaviour is:

```
  1. change the register program
  2. assert it in the host proofs                 catches transcription errors at the desk
  3. rebuild and reflash                          the slow step; minimise trips through it
  4. read the stage, the rx counts, or the code   the failure names its own cause
  5. cross-check the reference driver for the      the disagreement between a passing proof
     step the symptom points at                    and the silicon is the missing step
```

The reference driver here is Realtek's `rtw88`, kept as a read-only checkout. Its register values are
hardware facts and are reimplemented fresh rather than copied, so the tree stays license-clean, but it
is the authority for the sequence: when the counted pipeline said the radio was deaf, the fix was found
by reading what `rtw88` does between "tables loaded" and "receiving" and finding the antenna switch and
receive-path select that had not been transcribed. The proofs assert the transcription; the silicon
confirms the sequence; the reference resolves the disagreements.

## Debugging the rest of the stack

Above the driver, the same principles hold with different tools. [net_core](/docs/subsystems/networking/stack/) brings the IP
stack up to a bound DHCP lease on a live boot, and that lease is the observable success: a `SLOOK`
return of zero and a printed bound address are the runtime proof that the driver, the device bridge, and
smoltcp all agree. The failures there tend to be capability, not register, bugs, a missing debug
capability silently dropping a driver's log line, a missing DMA grant, a service that registered at
spawn but never reached its serve loop, and the tool for those is the service registry plus the same
"never exit, so the failure is queryable" discipline. The wireless driver is the hardest case because
it has the most silent hardware beneath it, which is why the observability is built in at every seam.

## Source

```
  userland/capsule_driver_rtl8821ce/src/status.rs   the framebuffer console lines
  userland/capsule_driver_rtl8821ce/src/serve.rs    the Stage enum, the rx counters, OP_STATUS/OP_SCAN
  userland/rtl8821ce_proofs/                         the host proofs
  userland/capsule_settings/src/wifi/               the panel that reads stage, counts, and codes
```
