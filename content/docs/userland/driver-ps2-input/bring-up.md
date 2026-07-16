---
title: "Bring-up, PIO, and IRQ"
description: "This page mirrors src/setup/, src/init/, src/discover.rs, and src/constants/."
weight: 2
---
This page mirrors `src/setup/`, `src/init/`, [`src/discover.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs), and `src/constants/`. It covers how the
capsule finds the i8042 on the ACPI bus, claims it, mints the port-IO grant, binds IRQ1 and IRQ12, and
brings the controller up, and how each phase rolls back what the phase before it took so the capsule
never runs holding a partial set of grants. It also covers the interrupt pump: how the driver polls for
edges and why it sweeps the output buffer twice. The general broker model is on
[../../subsystems/hardware-broker/pio.md](/docs/subsystems/hardware-broker/pio/) and
[../../subsystems/hardware-broker/irq.md](/docs/subsystems/hardware-broker/irq/).

## Every access is a broker call

The capsule never executes an `in` or `out` instruction. Command bytes go to the status/command port at
offset 4 and data bytes to the data port at offset 0 (`DATA_OFFSET = 0`, `STATUS_OFFSET = 4` at
[`src/constants/ports.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ports.rs#L16)), and every read and write is a `mk_pio_read` or `mk_pio_write` against the
grant ([`src/init/enable_keyboard/pio_write.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/enable_keyboard/pio_write.rs#L18), [`src/poll/read_port.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/poll/read_port.rs#L17)). A CI static check rejects
any inline `in`/`out` in this capsule, so every byte crosses the kernel's grant-bounds and stale-epoch
checks ([`nonos-ci/run-static-checks.sh:1178`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L1178)). Two more CI checks forbid this capsule from importing
`crate::drivers` or any kernel memory, paging, or hardware path
([`nonos-ci/run-static-checks.sh:1158`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L1158), `:1167`), so its only reach into the machine is the port window.

## Discovery over ACPI records

`find_ps2_kbd` and `find_ps2_aux` list the ACPI platform records with `mk_device_list` (up to 32) and
scan for a matching PnP vendor and device id ([`src/discover.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L26)). The keyboard record is vendor
`0x0001`, device `0x0303`; the AUX record is vendor `0x0001`, device `0x0304`
([`src/constants/pnp.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/pnp.rs#L16)). The keyboard match additionally requires a BAR, because the keyboard record
owns the shared port window; the AUX record needs none ([`src/discover.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L32), `:43`). A match returns the
`device_id` and the record's `irq_line` ([`src/discover.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L46)). The kernel-side broker synthesises these
two platform records with `PS2_KBD_IRQ = 1` and `PS2_AUX_IRQ = 12`
([`src/hardware/broker/platform.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/platform.rs#L28)), and a CI check pins both the device id and `PS2_AUX_IRQ = 12`
([`nonos-ci/run-static-checks.sh:1220`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L1220)). A missing keyboard record fails startup outright with
`ps2 keyboard not present in device list` ([`src/setup/sequence.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L27)).

## The ordered bring-up

`setup::run` runs a fixed sequence and returns a `Driver { pio_grant_id, irq_grant_id, aux_irq_grant_id,
mouse_enabled }` ([`src/setup/sequence.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L26), [`src/setup/driver.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/driver.rs#L16)).

1. Find and claim the keyboard record. `claim` calls `mk_device_claim` and returns the claim epoch, or
   fails startup ([`src/setup/claim.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L17)).
2. Grant the i8042 PIO window over BAR index 0 with `mk_pio_grant`. On failure it releases the device
   claim with `mk_device_release` and fails startup ([`src/setup/pio.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pio.rs#L18)).
3. Bind IRQ1. `irq::bind` calls `mk_irq_bind` against the keyboard record's `irq_line`; on failure it
   releases the PIO grant with `mk_pio_release` and returns the error ([`src/setup/irq.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L19)). The
   sequence catches that error, re-mints the PIO grant, and continues with `irq_grant_id = 0` so the
   keyboard still works purely by polling if the interrupt could not be bound
   ([`src/setup/sequence.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L32)).
4. Discover, claim, and bind the AUX record on IRQ12 through `setup_aux`. This path is all soft failure:
   if the AUX record is absent, its claim fails, or its IRQ bind fails, `setup_aux` releases whatever it
   took and returns grant id 0, and the keyboard path continues without the mouse
   ([`src/setup/setup_aux.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/setup_aux.rs#L21)).
5. Flush stale controller output. `flush_output` drains up to 16 bytes from the data port while the
   output-full bit is set ([`src/init/flush_output.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/flush_output.rs#L20)).
6. Enable the keyboard. This is the careful config-byte step, below ([`src/init/enable_keyboard/enable.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/enable_keyboard/enable.rs#L26)).
7. Enable the mouse if the AUX IRQ bound. `mouse_enabled` is true only when the AUX grant is non-zero and
   the mouse enable sequence acknowledges ([`src/setup/sequence.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L40)).
8. Acknowledge both IRQ lines once through `open_line` so the first real edge is delivered, then emit the
   ready marker ([`src/setup/open_line.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/open_line.rs#L17), [`src/setup/sequence.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L41)).

The rollback discipline is enforced by a CI check that requires [`setup/pio.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/setup/pio.rs) to release the device and
[`setup/irq.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/setup/irq.rs) to release the PIO grant on failure ([`nonos-ci/run-static-checks.sh:1194`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L1194)). Because every
phase releases the phase before it, no error path leaves the broker holding a grant the capsule will
never use.

## The keyboard config-byte sequence and its flush fix

`enable_keyboard` sends `CTL_ENABLE_KBD` (`0xAE`), flushes the output buffer, reads the config byte with
`CTL_READ_CONFIG` (`0x20`), sets `CONFIG_IRQ1` and clears `CONFIG_KBD_DISABLE`, writes it back with
`CTL_WRITE_CONFIG` (`0x60`), issues a keyboard reset, and enables scanning with `0xF4`
([`src/init/enable_keyboard/enable.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/enable_keyboard/enable.rs#L26), [`src/constants/ports.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ports.rs#L18)). A config byte read back as
`0xFF` is treated as an invalid controller and fails the sequence (`enable.rs:39`).

The flush after `CTL_ENABLE_KBD` is a real hardware fix, and its own comment states why
([`src/init/enable_keyboard/enable.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/enable_keyboard/enable.rs#L28)): enabling the keyboard can leave an ACK or a stray scancode in
port `0x60` on real hardware. Without the drain, the read after `CTL_READ_CONFIG` would return that
leftover byte instead of the config, and writing it back could clear `CONFIG_IRQ1` or set the disable
bit, killing the keyboard. `read_byte` polls the status port for output-full before reading, so with the
buffer flushed the next full byte is genuinely the config response ([`src/init/enable_keyboard/read_byte.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/enable_keyboard/read_byte.rs#L21)).

Every command and data write first spins on the status port until the input-buffer-full bit clears
(`STATUS_INPUT_FULL 0x02`), and reads spin until output-full is set, each capped at a fixed spin count so
a wedged controller returns an error rather than hanging ([`src/init/enable_keyboard/cmd.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/enable_keyboard/cmd.rs#L20),
[`src/init/enable_keyboard/wait_clear.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/enable_keyboard/wait_clear.rs#L21), `read_byte.rs:22`). The keyboard reset writes `0xFF` and
consumes the two response bytes it may produce ([`src/init/enable_keyboard/reset.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/enable_keyboard/reset.rs#L20)).

## The mouse enable sequence

`enable_mouse` sends `CTL_ENABLE_AUX` (`0xA8`), flushes, reads the config byte, sets both `CONFIG_IRQ1`
and `CONFIG_IRQ12` and clears `CONFIG_AUX_DISABLE`, writes it back, then sends the mouse
`MOUSE_SET_DEFAULTS` (`0xF6`) and `MOUSE_ENABLE_REPORTING` (`0xF4`) commands
([`src/init/enable_mouse/enable.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/enable_mouse/enable.rs#L26), [`src/constants/ports.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/ports.rs#L20)). Each mouse command is routed to the
AUX device by prefixing `CTL_WRITE_AUX` (`0xD4`) and then reading the reply, and the whole sequence fails
unless the reply is `MOUSE_ACK` (`0xFA`) ([`src/init/enable_mouse/mouse_command.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/enable_mouse/mouse_command.rs#L21)). Because the flag
that drives `mouse_enabled` requires this sequence to return `Ok`, a mouse that does not acknowledge
leaves the keyboard live and `OP_CONTROLLER_STATUS` reporting `mouse_enabled = 0`
([`src/setup/sequence.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L40)). A CI check pins the `CTL_WRITE_AUX` and `MOUSE_ENABLE_REPORTING` path and
the IRQ12 ownership ([`nonos-ci/run-static-checks.sh:1229`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-ci/run-static-checks.sh#L1229)).

## The interrupt pump and the double drain

Interrupt handling is edge-driven and lives in the server loop. `pump` polls each IRQ grant's delivery
sequence with `mk_irq_poll` ([`src/server/irq_seq.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/irq_seq.rs#L18)), drains the ports once, and if either sequence
advanced past the last one seen it acknowledges both lines and drains a second time
([`src/server/pump.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/pump.rs#L24)). The second sweep is deliberate, and its comment states why
([`src/server/pump.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/pump.rs#L42)): a byte that lands between the pre-ack drain and the IO-APIC unmask raises its
edge while the line is still masked, and a masked edge is dropped rather than latched, so without the
extra sweep that byte could sit in the i8042 holding the line high with no further edge to wake the
driver. After draining, the pump publishes each queued mouse event to the kernel input ring, carrying the
previous button mask forward so only button transitions are posted ([`src/server/pump.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/pump.rs#L36)).

When no IPC request is waiting, the runner blocks on `mk_irq_wait` with a 100 ms timeout rather than
busy-spinning, so it wakes on the next interrupt ([`src/server/runner.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L51)). A grant id of 0, which is
what the keyboard carries if its IRQ never bound, makes `poll_seq` return 0 without a syscall, so the
polling-only path degrades cleanly ([`src/server/irq_seq.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/irq_seq.rs#L19)).

## Security analysis

This capsule is more privileged than an app because it holds real hardware authority, but that authority
is narrow and fully enumerated. Its mask grants CoreExec, IPC, Memory, DeviceEnum, Driver, Irq, Pio, and
InputSource and nothing else (`Capsule.mk:17`, [`src/hardware/ps2_kbd_capsule/spawn.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/ps2_kbd_capsule/spawn.rs#L51)); the bit
decomposition is on the [README](/docs/userland/driver-ps2-input/).

No memory-mapped reach. There is no `Mmio` and no `Dma` bit, so the capsule cannot map a device BAR into
its address space or receive a DMA-coherent buffer. Its only hardware reach is the i8042 port window, and
only the ports the grant covers: `Pio` mints the grant, and every access is a `mk_pio_read` or
`mk_pio_write` the kernel bounds-checks against the granted window before it runs the instruction
([../../subsystems/hardware-broker/pio.md](/docs/subsystems/hardware-broker/pio/)). This is the only
driver in the verified set that holds `Pio` at all (`Capsule.mk:1`).

No side authority. There is no FileSystem, Network, Admin, or Debug bit in the mask, so the capsule
cannot touch a file, open a socket, or take an administrative action. The one thing it writes outside its
rings is the ready marker, through `mk_debug` ([`src/setup/marker.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/marker.rs#L17)).

Bring-up is all-or-nothing per phase. A PIO failure releases the device claim, an IRQ1 failure releases
the PIO grant, and a missing keyboard record fails startup, so the capsule never runs holding a partial
set of grants ([`src/setup/pio.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pio.rs#L21), [`src/setup/irq.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L22), [`src/setup/sequence.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L27)). On exit the
kernel revokes every grant the pid held, so a crashed driver leaves no grant behind
([../../subsystems/hardware-broker/irq.md](/docs/subsystems/hardware-broker/irq/)).

The controller is a single shared resource, which is why one capsule owns both the keyboard and the AUX
records rather than splitting one physical controller across two owners. Malformed hardware input is
data-plane damage, not a fault: a parity or timeout status is counted during the drain
([`src/poll/drain.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/poll/drain.rs#L39)), a bad mouse sync byte is counted and dropped ([`src/mouse/parser.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/mouse/parser.rs#L30)), and a
full ring drops deterministically, none of which can crash the driver or wedge the line.

## Source map

```
  userland/capsule_driver_ps2_input/src/discover.rs            find_ps2_kbd / find_ps2_aux over ACPI records
  userland/capsule_driver_ps2_input/src/constants/ports.rs     port offsets, controller commands, config bits
  userland/capsule_driver_ps2_input/src/constants/pnp.rs       the PS/2 keyboard and AUX PnP ids
  userland/capsule_driver_ps2_input/src/setup/sequence.rs      the ordered bring-up
  userland/capsule_driver_ps2_input/src/setup/claim.rs         mk_device_claim and the claim epoch
  userland/capsule_driver_ps2_input/src/setup/pio.rs           mk_pio_grant with device-release rollback
  userland/capsule_driver_ps2_input/src/setup/irq.rs           mk_irq_bind with pio-release rollback
  userland/capsule_driver_ps2_input/src/setup/setup_aux.rs     the soft-failing AUX claim and bind
  userland/capsule_driver_ps2_input/src/setup/open_line.rs     the first-edge acknowledge
  userland/capsule_driver_ps2_input/src/setup/marker.rs        the mk_debug ready marker
  userland/capsule_driver_ps2_input/src/init/flush_output.rs   the stale-output drain
  userland/capsule_driver_ps2_input/src/init/enable_keyboard/  the config-byte sequence and its flush fix
  userland/capsule_driver_ps2_input/src/init/enable_mouse/     the AUX enable and mouse commands
  userland/capsule_driver_ps2_input/src/server/pump.rs         the interrupt pump and the double drain
  userland/capsule_driver_ps2_input/src/server/irq_seq.rs      the mk_irq_poll sequence read
  src/hardware/broker/platform.rs                              the synthesised PS/2 records and IRQs
  src/hardware/ps2_kbd_capsule/spawn.rs                        the requested capability set
  nonos-ci/run-static-checks.sh                                the PS/2 isolation, rollback, and mouse gates
```

Every reference above is verified against those trees.
