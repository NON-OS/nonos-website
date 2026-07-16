---
title: "The Syscall Router"
description: "Once a syscall has passed the capability contract, the router dispatches it to the handler for its family."
weight: 4
---
Once a syscall has passed the [capability contract](/docs/subsystems/syscall/boundary/), the router dispatches it
to the handler for its family. This page documents the family dispatch, the handlers each
family routes to, and the fallback for an unrouted number. The code is under
`src/syscall/dispatch/router/`.

## The dispatch

The core is `dispatch_syscall` ([`src/syscall/dispatch/router/dispatch_fn.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/dispatch_fn.rs#L22)), a match
on the typed syscall number that routes each family to its handler:

```
  dispatch_syscall(syscall, a0..a5):
      Crypto* (the crypto calls)          -> crypto::dispatch_crypto
      admin::matches(nr)                  -> admin::handle
      microkernel_ops::matches(nr)        -> microkernel_ops::handle
      graphics_backend::matches(nr)       -> graphics_backend::handle
      MkSurface* and MkDisplayVsyncWait   -> surface_ops::handle
      MkInputEvent*                       -> input_ops::handle
      _                                   -> ENOSYS
```

The crypto, surface, and input families are matched by an explicit list of variants, while
the admin, microkernel, and graphics families are matched by a `matches` predicate each
module owns, so a family can claim its own numbers without the central match having to
enumerate every one. A number that no family claims falls through to `ENOSYS` (errno 38).
Because the [contract](/docs/subsystems/syscall/boundary/) already established that the caller holds the capability
this syscall requires, the router does not repeat the authority check; it only routes.

## The handlers

Each arm dispatches into a family module:

```
  crypto::dispatch_crypto   the in-kernel cryptographic primitives
  admin::handle             reboot, shutdown, policy push
  microkernel_ops::handle   the Mk* microkernel surface: ipc, memory, spawn,
                            time, capabilities, and the hardware broker
  graphics_backend::handle  display queries
  surface_ops::handle       surface register, share, attach, release, present, vsync
  input_ops::handle         input event post, drain, wait
```

The microkernel handler is the largest, since the `Mk*` family is the bulk of the syscall
surface; it does a second level of dispatch of its own to reach the individual IPC, memory,
process, device, and broker operations. The surface and input handlers connect to the
[graphics](/docs/subsystems/graphics/) and [input](/docs/subsystems/input/) subsystems, and the crypto handler to
the [crypto stack](/docs/subsystems/crypto/).

## Counters and audit

The router is entered through `handle_syscall_dispatch`
([`src/syscall/dispatch/router/entry.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/entry.rs)), which wraps `dispatch_syscall` with bookkeeping:
it counts total calls and their success, failure, and permission-denied outcomes, and
where a handler marks its result as requiring audit, it invokes the audit hook after the
call. The counters make the syscall surface observable, and the audit path records the
calls that ask to be recorded. The dispatch itself is the match above; this wrapper is the
accounting around it.

## Security analysis

The router runs only after the [contract](/docs/subsystems/syscall/boundary/) has already established that the caller holds the
capability its syscall requires, so the router itself is not an authority boundary; it is a routing and
accounting layer. Its security-relevant properties are about not weakening what the contract established
and about making the boundary observable.

**Unclaimed numbers dead-end, they do not fall through to a neighbour.** `dispatch_syscall`
(`dispatch_fn.rs:22`) matches the crypto, surface, and input families by explicit variant lists and the
admin, microkernel, and graphics families by each module's own `matches` predicate; a number that no arm
and no predicate claims hits the final `_ => errno(38)` arm and returns `ENOSYS`
(`dispatch_fn.rs`). There is no default handler and no index arithmetic, so a number the contract somehow
let through without a home cannot be misrouted into another family's handler; it is simply not serviced.

**The capability check is not repeated, and that is deliberate, not a gap.** The router trusts the
contract's result because `dispatch` ([`src/syscall/contract/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/dispatch.rs#L31)) is the only path that reaches
`handle_syscall_dispatch`, and it reaches it only after `Capability::resolve` succeeded. Re-resolving in
the router would be redundant work on the hot path and, worse, a second place the rule lives that could
drift from the first. The cap-table that maps each `SyscallNumber` to its required bits is the single
source of truth (`src/syscall/contract/cap_table/`), consulted once at the gate.

**Denials are counted separately so the boundary is visible without a logging layer.**
`handle_syscall_dispatch` (`entry.rs:29`) bumps `total_calls` on entry, then `successful_calls` or
`failed_calls` by the sign of the result, and increments `permission_denied` specifically when the result
is `-1`, which is `-EPERM` (`entry.rs:45`). So the running counts expose how many calls the capability
boundary is dropping, distinct from ordinary handler failures, which is the signal you watch when a
capsule is misbehaving or under-provisioned. The audit ring is the per-call record behind those counts:
when a handler marks its result `audit_required`, `audit_syscall` ([`audit/sink.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/audit/sink.rs)) appends a
`SyscallAuditEntry` with the pid, syscall name, arguments, and result into a 256-entry ring
([`audit/entry.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/audit/entry.rs)). The honest limit is that the audit path records only the calls that ask to be
recorded, and the ring holds the most recent 256, so it is a recent-history window, not a complete log.

## Debugging the router

The router is where a call's outcome becomes a counted, optionally-audited event, so two facilities make
the syscall surface observable. `get_syscall_stats` ([`audit/stats.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/audit/stats.rs)) returns the four running counters
as a tuple, `(total, successful, failed, permission_denied)`, and `get_audit_log`
([`audit/entry.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/audit/entry.rs)) returns up to N of the most recent audited calls newest-first. Together they answer
"what is this capsule actually calling and how is it failing."

```
  total_calls        every call that reached the router
  successful_calls    result.value >= 0
  failed_calls        result.value < 0  (any negative errno)
  permission_denied   result.value == -1  (that is -EPERM specifically)
```

The one subtlety worth stating: `permission_denied` counts only `-1`. An `EPERM` returned by the contract
gate never reaches `handle_syscall_dispatch` at all, because `dispatch` returns before calling
`invoke` when `resolve` fails, so a contract-level denial shows up as a `[CAP-DENY]` log line rather than
in this counter. The `permission_denied` counter therefore reflects handlers that themselves return
`EPERM` (for example a handler that re-checks a finer-grained condition), not the boundary denials. If
`failed_calls` is climbing but `permission_denied` is not, the failures are `EFAULT`, `EINVAL`, `ENOMEM`,
or `ENOSYS`, not authority, and the audit ring is where you read which: a `NØNOS`-side dump of
`get_audit_log` gives the syscall name, the first four arguments, and the exact `result` value per call, so
a run of `-14` on `MkInputEventDrain` with a given `out_ptr` argument points straight at a bad user buffer
rather than a permissions problem. `ENOSYS` (38) from the router, as opposed to from the boundary, means a
number decoded to a real `SyscallNumber` but no family claimed it in `dispatch_syscall`, which is a
routing-table omission rather than a bad caller.

## Source map

```
  src/syscall/dispatch/router/dispatch_fn.rs      dispatch_syscall, the family match and ENOSYS dead-end
  src/syscall/dispatch/router/entry.rs            handle_syscall_dispatch, the counters and audit call
  src/syscall/dispatch/router/crypto.rs           the crypto family
  src/syscall/dispatch/router/admin/              the admin family
  src/syscall/dispatch/router/microkernel_ops.rs  the Mk* family entry and its matches predicate
  src/syscall/dispatch/router/input_ops.rs        the input family (a handler that does usercopy)
  src/syscall/dispatch/util.rs                    errno, require_capability, the usercopy error mapping
  src/syscall/dispatch/audit/stats.rs             SYSCALL_STATS and get_syscall_stats
  src/syscall/dispatch/audit/entry.rs             the 256-entry audit ring and get_audit_log
  src/syscall/dispatch/audit/sink.rs              audit_syscall
  src/syscall/microkernel/                         the Mk* handler implementations
```

Every reference above is verified against those trees. The capability gate the router relies on and does
not repeat is on the [boundary](/docs/subsystems/syscall/boundary/) page, and the per-syscall capability table it trusts is on the
[capabilities page](/docs/security/capabilities-and-tokens/).
