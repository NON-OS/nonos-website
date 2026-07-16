---
title: "Debugging capsule_power"
description: "This page lists what the power capsule does and does not emit, and the concrete failure modes with where to look for each."
weight: 4
---
This page lists what the power capsule does and does not emit, and the concrete failure modes with where to
look for each. For what the capsule is and how it is served, read the [README](/docs/userland/power/) and the
[operations](/docs/userland/power/operations/) page.

## There is no boot marker

The power capsule emits no serial output by design, because Debug is not in its `0x219` mask, so there is
no boot line and no per-request log to grep for (`Capsule.mk:12`). It is also not spawned by the init
spawn plan, so even a Debug-capable capsule would print nothing at boot: a search of
`src/userspace/init/spawn_plan/` for the power slug or its port 4448 finds no entry
(see the [README lifecycle](/docs/userland/power/#lifecycle)).

Confirming the service is reachable therefore means confirming a service lookup for `power` resolves, not
reading a boot line. The observable behaviour of a request is the reply status word, covered below.

## How to read a reply status

Every reply is a 24-byte frame ending in a 4-byte little-endian status word
([`src/server/respond.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L19)). A caller reads that word to know what happened.

| Status | Meaning | Where it comes from |
|--------|---------|---------------------|
| `0` | healthcheck ok, or reboot reply built before reset fired | [`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20), [`src/server/handlers/reboot.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/reboot.rs#L28) |
| `-95` | `E_NOTSUP`: shutdown is not implemented in the kernel | [`src/syscall/dispatch/router/admin/shutdown.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/admin/shutdown.rs#L19) |
| `-38` | `E_BAD_OP`: opcode was none of the three | [`src/server/handlers/router.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/router.rs#L31), [`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17) |
| `-71` | `E_BAD_MAGIC`: first four bytes were not `POWR` | [`src/protocol/decode.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L28), [`src/protocol/errno.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L18) |
| `-90` | `E_BAD_LEN`: frame short or payload length overran | [`src/protocol/decode.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L20), [`src/protocol/errno.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L19) |
| `-93` | `E_BAD_VERSION`: version field was not 1 | [`src/protocol/decode.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L31), [`src/protocol/errno.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L20) |

## Failure modes

### A reboot appears to hang

This is by design. `reboot` builds its success reply before calling `mk_admin_reboot`, and the machine
resets before the reply can be delivered, so a caller must not wait on a reboot ack
([`src/server/handlers/reboot.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/reboot.rs#L28)). In QEMU the reboot path takes effect within milliseconds of any
capsule sending `OP_REBOOT`.

### A shutdown comes back with `-95`

This is not a bug in this capsule. `shutdown` returns the admin syscall's `rc`, and the kernel returns
`E_NOTSUP` because there is no AML interpreter to evaluate the DSDT `_S5` object; the kernel refuses before
any register write rather than writing a meaningless PM1 value
([`src/server/handlers/shutdown.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/shutdown.rs#L29), [`src/arch/x86_64/acpi/power_sleep.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/x86_64/acpi/power_sleep.rs#L35)). The machine correctly
stays up. Reboot works on any x86 box.

### A structured error status instead of a power result

A status of `-71`, `-93`, `-90`, or `-38` points at the frame, not the machine. Check the header the caller
sent against the layout on the [operations](/docs/userland/power/operations/#the-wire-format) page: magic must be `POWR`,
version must be 1, the frame must be at least 20 bytes, the declared `payload_len` must not overrun the
buffer, and the opcode must be one of `OP_HEALTHCHECK`, `OP_REBOOT`, or `OP_SHUTDOWN`
([`src/protocol/decode.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L20)).

### No reply at all

The receive was treated as spurious. A byte count of zero or fewer, or a sender pid of `0`, makes the loop
yield and retry without replying ([`src/server/runner.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L41)). A frame that parses but produces a zero-length
route result is also not sent, though every current op returns a non-empty reply
([`src/server/runner.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L46)).

### A request that should be refused is not

The power capsule does not attest its caller. Any capsule that can reach port 4448 can send `OP_REBOOT`,
and the request succeeds because the power capsule itself holds Admin. The real gate on who may power the
machine is the capability to reach the power service combined with the power capsule's own Admin grant, not
per-caller logic in the handler ([`src/syscall/contract/cap_table/admin.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/admin.rs#L24)). There is no debounce and no
rate limit, so repeated `OP_REBOOT` frames all attempt to fire.

## Source map

```
  userland/capsule_power/src/server/runner.rs              recv-from, spurious-receive guard, reply
  userland/capsule_power/src/server/handlers/router.rs     dispatch, E_BAD_OP fallthrough
  userland/capsule_power/src/server/handlers/reboot.rs     reply-then-reset ordering
  userland/capsule_power/src/server/handlers/shutdown.rs   rc-as-status, E_NOTSUP today
  userland/capsule_power/src/server/handlers/health.rs     status-0 liveness
  userland/capsule_power/src/server/respond.rs             24-byte reply builder
  userland/capsule_power/src/protocol/decode.rs            the four parse failures
  userland/capsule_power/src/protocol/errno.rs             E_BAD_OP / MAGIC / LEN / VERSION values
  userland/capsule_power/Capsule.mk                        Debug absent from the 0x219 mask
  src/syscall/contract/cap_table/admin.rs                  the can_admin gate
  src/syscall/dispatch/router/admin/shutdown.rs            E_NOTSUP
  src/arch/x86_64/acpi/power_sleep.rs                      why shutdown is refused
  src/userspace/init/spawn_plan/                           searched: no power entry, so no boot marker
```

Every reference above is verified against those trees.
