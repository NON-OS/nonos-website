---
title: "PIO Grants"
description: "Some x86 devices are driven through port-mapped I/O rather than memory-mapped registers."
weight: 6
---
Some x86 devices are driven through port-mapped I/O rather than memory-mapped registers. The
broker grants a capsule a specific port window and then performs the `in` and `out` instructions
on its behalf, checking every access against the grant. Port I/O is an x86-only instruction
class, so this whole path is compiled only on x86_64; other architectures fail the syscalls
closed with `ENOSYS`. This page documents `MkPioGrant` and the checked accesses. The code is
under `src/hardware/broker/pio/`.

## The grant

A `PioGrant` ([`src/hardware/broker/pio/grant.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/pio/grant.rs#L34)) records a contiguous port window for a
holder:

```
  struct PioGrant {
      grant_id: u64, pid: u32, device_id: u64, claim_epoch: u64,
      port_base: u16, port_count: u16,
  }
```

The grant is issued from `grant_for_caller` after the same claim and epoch check the other grant
classes run, and it is recorded in the global PIO grant table. The window is `[port_base,
port_base + port_count)`, and it is the exact set of ports the capsule is allowed to touch.

## Checked access

The capsule does not execute `in` or `out` itself, because that would require the kernel to hand
it I/O privilege over the whole port space. Instead it calls `MkPioRead` and `MkPioWrite`, and
each access is resolved against the grant table ([`pio/grant.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/pio/grant.rs#L54), [`pio/access/resolve.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/pio/access/resolve.rs)):

```
  lookup_for_holder(pid, grant_id):
      g = grant with this grant_id     else UnknownGrant
      if g.pid != pid:                 NotHolder
      return g
```

The access is then bounds-checked against the grant's port window and the requested width before
the kernel issues the instruction. A missing grant, a grant held by another pid, or a port
outside the granted window is refused. This is the same shape as the MMIO story: the kernel holds
the privileged capability (here, I/O port access) and mediates every use of it against a
per-capsule grant, so a capsule can drive its device's ports and only its device's ports.

## Non-x86 builds

Because port I/O does not exist off x86, the broker's `pio` submodule is gated on
`target_arch = "x86_64"` ([`src/hardware/broker/mod.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/mod.rs#L32)), and on other architectures the
syscall layer fail-closes the PIO calls with `ENOSYS` through
[`syscall/microkernel/pio/unsupported.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/syscall/microkernel/pio/unsupported.rs). The behavior is explicit rather than a silent no-op: a
capsule that asks for port I/O on a platform without it gets a clear unsupported error.

## Revocation

The PIO grant table is drained on `MkPioRelease` (single grant), on `MkDeviceRelease` (every
grant on the device), and on capsule exit (`release_all_for_pid`), the same three-way revocation
the other classes use; `remove` and the `drain_*` helpers all enforce holder ownership. See
[revocation](/docs/subsystems/hardware-broker/revocation/).

## Security analysis

PIO is the grant that would be catastrophic done naively, because x86 I/O-port privilege reaches the
*entire* port space, not one device. A capsule granted the raw `in`/`out` instructions (an IOPL of 3)
could touch the 8042 keyboard controller, the PIC and PIT, the CMOS, and, worst of all, the PCI config
ports `0xCF8`/`0xCFC`, from which it could reprogram any device on the bus. NØNOS never grants a capsule
I/O privilege. The capsule calls `MkPioRead`/`MkPioWrite`, and the kernel executes the instruction after
two checks: `lookup_for_holder` rejects a grant id the calling pid does not own (`NotHolder`), and the
access is bounds-checked against `[port_base, port_base + port_count)` and the requested width before the
`in`/`out` runs. So a capsule reaches exactly its own device's port window and nothing else, and the
window came from the kernel's device table, not the request. In practice exactly one capsule in the
system holds the `Pio` capability at all, `ps2_input`, and only for the 8042's two ports. Off x86 the
whole path fail-closes with `ENOSYS` rather than silently succeeding, which is a security property in its
own right: a driver ported to another architecture gets a clear unsupported error instead of a no-op it
might read as success.

## Debugging PIO grants

A grant refusal is one `PioError` ([`pio/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/pio/types.rs)): `NotClaimed` / `StaleEpoch` (no current claim),
`NotPioBar` / `BadBarIndex` (the device has no port BAR), or `UnsupportedFlags` / `ZeroSize`. A refusal
on an individual access is different: `UnknownGrant` (a bad grant id), `NotHolder` (a grant id owned by
another pid), or `PortOverflow` / `BadOffset` (the port or width falls outside the granted window). So a
driver that gets its grant but fails its reads is almost always computing a port outside its window, and
the `PortOverflow`/`BadOffset` line names it precisely. A `NotPioBar` at grant time on a device that has
port registers on real hardware usually means firmware reported the BAR differently from the model. On
any non-x86 build every one of these calls returns `ENOSYS` at the syscall layer, so PIO debugging is
inherently an x86 activity.

## Source map

```
  src/hardware/broker/pio/grant.rs           the PioGrant table and holder checks
  src/hardware/broker/pio/access/resolve.rs  per-access bounds checking
  src/hardware/broker/pio/types.rs           PioGrant and the PioError variants
  src/hardware/broker/mod.rs                 the x86-only cfg gate
  src/syscall/microkernel/pio/unsupported.rs the fail-closed ENOSYS on non-x86
```

Every reference above is verified against those trees. The claim and epoch are on the
[device claim](/docs/subsystems/hardware-broker/claim/) page, and the revocation paths are on the [revocation](/docs/subsystems/hardware-broker/revocation/) page.
