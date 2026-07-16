---
title: "Operations and the syscall path"
description: "This page mirrors src/protocol/ and src/server/."
weight: 2
---
This page mirrors `src/protocol/` and `src/server/`. It covers the three operations, the fixed frame
format they travel in, the request loop that serves them, the deliberate ordering difference between reboot
and shutdown, and the full path each power op takes from the handler through the kernel admin router to
ACPI. For what the capsule is and its identity, read the [README](/docs/userland/power/). For status codes seen at
runtime, read [debugging](/docs/userland/power/debugging/).

## The three operations

Three operations are defined as `u16` opcodes ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)):

| Op | Opcode | What it does | Handler |
|----|--------|--------------|---------|
| `OP_HEALTHCHECK` | `0x0001` | liveness ping; replies status `0` | [`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20) |
| `OP_REBOOT` | `0x0002` | reset the machine | [`src/server/handlers/reboot.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/reboot.rs#L23) |
| `OP_SHUTDOWN` | `0x0003` | request power off (returns `E_NOTSUP` today) | [`src/server/handlers/shutdown.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/shutdown.rs#L23) |

Health is stateless: it takes `(out, req)` and returns a status-`0` reply, nothing more
([`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20)). The two power ops take the shared `PowerState` so they can record a
request timestamp before acting.

## The wire format

The wire format is a fixed 20-byte header followed by an optional payload, capped at 256 bytes total
([`src/protocol/header.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L19), [`src/protocol/mod.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L29)). Every field is little-endian
([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19), [`src/protocol/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L19)):

```
  offset 0   u32   magic       0x504F5752 ("POWR")          header.rs:17
  offset 4   u16   version     1                            header.rs:18
  offset 6   u16   op          OP_HEALTHCHECK|REBOOT|SHUTDOWN
  offset 8   u16   flags       echoed into the reply
  offset 10  u16   reserved    zeroed in replies            encode.rs:24
  offset 12  u32   request_id  echoed into the reply
  offset 16  u32   payload_len bytes of payload following the header
  offset 20  ..    payload     (unused by every current op)
```

`parse` checks length first, then magic, then version, then rejects a frame whose declared `payload_len`
overruns the buffer. Each failure returns a best-effort `Request` alongside a negative status, so the
server can still reply with a structured error rather than dropping the frame
([`src/protocol/decode.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L20)). The `Request` the parser hands back carries only `op`, `flags`, and
`request_id`; those are what the reply echoes ([`src/protocol/header.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L22)). The error statuses
([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)):

```
  E_BAD_OP       -38   opcode not one of the three known ops     errno.rs:17
  E_BAD_MAGIC    -71   first four bytes are not "POWR"           errno.rs:18
  E_BAD_LEN      -90   frame shorter than the header, or overrun errno.rs:19
  E_BAD_VERSION  -93   version field is not 1                    errno.rs:20
```

Every reply is a fixed 24-byte frame: the 20-byte header echoed back plus a 4-byte little-endian status
word. `respond::status` fills the header through `response_header` with `payload_len = 4`, writes the
status at offset 20, and returns `HDR_LEN + STATUS_LEN` ([`src/server/respond.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L19),
[`src/protocol/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L19)).

## The request loop

The server is a single fixed-port loop ([`src/server/runner.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L28)):

1. Allocate a receive and a send buffer of `IPC_PAYLOAD_MAX` (256) bytes each and construct a fresh
   `PowerState` ([`src/server/runner.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L29), [`src/protocol/mod.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L29)).
2. Block on `mk_ipc_recv_from(4448, ...)`, which returns the byte count and the sender pid. A receive of
   zero or fewer bytes, or a sender pid of `0`, is treated as spurious: the loop yields and retries rather
   than replying to nobody ([`src/server/runner.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L34), [`src/server/runner.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L41)).
3. Route the received bytes through `route`, which parses the header, dispatches on the opcode, and returns
   the number of reply bytes to send. An unknown opcode is answered with `E_BAD_OP` rather than dropped
   ([`src/server/handlers/router.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/router.rs#L22), [`src/server/handlers/router.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/router.rs#L31)).
4. If the router produced a non-empty reply, send it to the attested sender pid with `mk_ipc_reply`
   ([`src/server/runner.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L47)).

The state is a `PowerState` holding `last_reboot_request_unix` and `last_shutdown_request_unix`, both
`u64`, both initialised to zero by a `const fn new` ([`src/state/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/mod.rs#L17)). Nothing reads them back; they
are an in-memory audit breadcrumb for the current process lifetime and do not persist across a reboot.

## Reboot: build the reply first, then reset

`reboot` records the request time, builds the success reply, and only then calls `mk_admin_reboot`
([`src/server/handlers/reboot.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/reboot.rs#L23)):

```
  reboot(state, out, req):
      now = mk_time_millis()
      if now > 0: state.last_reboot_request_unix = now   // reboot.rs:25
      n = respond::status(out, req, 0)                   // build the reply FIRST  reboot.rs:28
      mk_admin_reboot()                                  // then reset the machine reboot.rs:29
      return n
```

The reply is prepared before the reset because after `mk_admin_reboot` the machine restarts and the reply
would never be delivered. A caller should not wait on a reboot ack regardless. The timestamp is recorded
only when the clock read is positive, so a failed `mk_time_millis` leaves the last value in place rather
than clobbering it with a zero or a negative ([`src/server/handlers/reboot.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/reboot.rs#L24)).

## Shutdown: return the syscall's result

`shutdown` calls `mk_admin_shutdown` and returns the syscall's result as the status
([`src/server/handlers/shutdown.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/shutdown.rs#L23)):

```
  shutdown(state, out, req):
      now = mk_time_millis()
      if now > 0: state.last_shutdown_request_unix = now  // shutdown.rs:26
      rc = mk_admin_shutdown()                             // shutdown.rs:28
      status = if rc == 0 { 0 } else { rc }               // shutdown.rs:29
      return respond::status(out, req, status)            // shutdown.rs:30
```

Today `mk_admin_shutdown` always returns `E_NOTSUP` (`-95`), so a caller that sends `OP_SHUTDOWN` gets a
`-95` status back and the machine stays up. The reason is on the kernel side, covered below.

## From handler to ACPI

The two power ops reach the kernel through the userland libc admin wrappers, which issue raw syscalls by a
four-byte tag:

- `mk_admin_reboot` calls syscall `ARBT` (`AdminReboot`) ([`userland/libc/src/admin/reboot.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/admin/reboot.rs#L19),
  [`userland/libc/src/syscall/numbers/admin.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/syscall/numbers/admin.rs#L18)).
- `mk_admin_shutdown` calls syscall `ASDN` (`AdminShutdown`) ([`userland/libc/src/admin/shutdown.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/admin/shutdown.rs#L19),
  [`userland/libc/src/syscall/numbers/admin.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/syscall/numbers/admin.rs#L19)).

The kernel encodes those same tags as `SyscallNumber::AdminReboot` and `AdminShutdown`
([`src/syscall/numbers/defs.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/numbers/defs.rs#L40)). The admin router matches these two plus `AdminPolicyPush` and, before
dispatching, the capability layer checks that the caller's token grants Admin: the cap table maps both
admin syscalls to `caps.can_admin()`, which is `grants(Admin) && is_valid()`
([`src/syscall/contract/cap_table/admin.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/admin.rs#L24), [`src/syscall/caps/checks/system.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/caps/checks/system.rs#L24)). Only a caller
holding the Admin bit, which in this fleet is only the power capsule, passes.

Once past the gate the router dispatches ([`src/syscall/dispatch/router/admin/route.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/admin/route.rs#L41)) and marks the
result `audit_required` for both power ops ([`src/syscall/dispatch/router/admin/route.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/admin/route.rs#L47)):

- `AdminReboot` calls `power_reboot::reboot()` and returns `E_OK`
  ([`src/syscall/dispatch/router/admin/reboot.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/admin/reboot.rs#L21)).
- `AdminShutdown` returns `E_NOTSUP` directly, without side effects and without calling into the ACPI sleep
  path ([`src/syscall/dispatch/router/admin/shutdown.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/admin/shutdown.rs#L19)).

The kernel reboot is a real three-stage fallback that lands on any x86 board
([`src/arch/x86_64/acpi/power_reboot.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/x86_64/acpi/power_reboot.rs#L22)). It first tries the ACPI reset register, `SystemIo` or
`SystemMemory`, if the parsed tables provide one; then falls back to the 8042 keyboard-controller reset
(waits for the input buffer to clear, then writes `0xFE` to port `0x64`); and finally, if the machine is
still alive, loads a null IDT and executes `int3` to force a triple fault
([`src/arch/x86_64/acpi/power_reboot.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/x86_64/acpi/power_reboot.rs#L47), [`src/arch/x86_64/acpi/power_reboot.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/x86_64/acpi/power_reboot.rs#L59)).

Shutdown is honest about a missing piece. Entering S5 requires evaluating the `_S5` AML object in the DSDT
to read the `SLP_TYPa`/`SLP_TYPb` values, and NØNOS has no AML interpreter, no DSDT walker, and no
ACPI-enable handshake against `SMI_CMD`. Writing `SLP_EN` with a hardcoded `SLP_TYP=0` to PM1 has no
defined effect, so the code refuses before any side-effecting register write rather than pretending. The
kernel `AdminShutdown` arm returns `E_NOTSUP` as its own contract; the ACPI helper `power_sleep::shutdown`
carries the same refusal and the comment explaining what an eventual AML evaluator would replace it with
([`src/arch/x86_64/acpi/power_sleep.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/x86_64/acpi/power_sleep.rs#L27), [`src/arch/x86_64/acpi/power_sleep.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/x86_64/acpi/power_sleep.rs#L35)).

The `mk_time_millis` wrapper the handlers use for the audit timestamp is the `MkTimeMillis` syscall
([`userland/libc/src/time/wall.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/libc/src/time/wall.rs#L19)). For the wider admin syscall family, see the
[syscall router](/docs/subsystems/syscall/router/).

## Source map

```
  userland/capsule_power/src/protocol/header.rs            magic POWR, version, 20-byte header, Request
  userland/capsule_power/src/protocol/decode.rs            parse: len, magic, version, payload bound
  userland/capsule_power/src/protocol/encode.rs            build reply header and status word
  userland/capsule_power/src/protocol/ops.rs               OP_HEALTHCHECK | OP_REBOOT | OP_SHUTDOWN
  userland/capsule_power/src/protocol/errno.rs             E_BAD_OP / MAGIC / LEN / VERSION
  userland/capsule_power/src/protocol/mod.rs               IPC_PAYLOAD_MAX, re-exports
  userland/capsule_power/src/server/runner.rs              the loop, recv-from and reply-to-sender on 4448
  userland/capsule_power/src/server/handlers/router.rs     opcode dispatch, E_BAD_OP fallthrough
  userland/capsule_power/src/server/handlers/health.rs     stateless liveness ping
  userland/capsule_power/src/server/handlers/reboot.rs     reply-then-reset
  userland/capsule_power/src/server/handlers/shutdown.rs   shutdown syscall, rc as status
  userland/capsule_power/src/server/respond.rs             header + status reply builder
  userland/capsule_power/src/state/mod.rs                  the two request timestamps
  userland/libc/src/admin/reboot.rs                        mk_admin_reboot -> ARBT
  userland/libc/src/admin/shutdown.rs                      mk_admin_shutdown -> ASDN
  userland/libc/src/syscall/numbers/admin.rs               ARBT / ASDN tag constants
  userland/libc/src/time/wall.rs                           mk_time_millis
  src/syscall/numbers/defs.rs                              AdminReboot / AdminShutdown tags
  src/syscall/contract/cap_table/admin.rs                  can_admin gate on the admin syscalls
  src/syscall/caps/checks/system.rs                        can_admin = grants(Admin) && is_valid
  src/syscall/dispatch/router/admin/route.rs               match, dispatch, audit_required
  src/syscall/dispatch/router/admin/reboot.rs              power_reboot::reboot -> E_OK
  src/syscall/dispatch/router/admin/shutdown.rs            E_NOTSUP, no side effects
  src/arch/x86_64/acpi/power_reboot.rs                     ACPI reg, 8042, triple-fault fallback
  src/arch/x86_64/acpi/power_sleep.rs                      S5 refused until an AML evaluator lands
```

Every reference above is verified against those trees.
