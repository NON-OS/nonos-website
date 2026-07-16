---
title: "Debugging"
description: "This page is the runtime companion: the boot marker that says the capsule ran, and the four failure modes you are likely to chase."
weight: 5
---
This page is the runtime companion: the boot marker that says the capsule ran, and the four failure modes
you are likely to chase. The mechanisms behind each are on [protocol.md](/docs/userland/policy/protocol/),
[fields.md](/docs/userland/policy/fields/), and [gate.md](/docs/userland/policy/gate/).

## Did it start

On a successful boot the kernel prints `[POLICY] capsule spawned` (prefix `POLICY`, message
`capsule spawned`) from the boot log ([`src/userspace/init/spawn_plan/core.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/core.rs#L67),
[`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). An absent line means the capsule never started, usually a
signature, manifest, or capability failure at verified spawn; the error path prints a `[POLICY]` error line
instead ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)). The whole capsule is gated behind the
`nonos-capsule-policy` feature, so if the build did not enable it the spawn is a no-op and no line appears
at all ([`src/userspace/init/spawn_plan/core.rs:70`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/core.rs#L70)).

One nuance specific to this capsule: at startup `main.rs` runs `push::seed_kernel` before entering the loop
([`src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L37)), so a `[POLICY] capsule spawned` line means both that the service registered and that
the kernel was primed with the mirrored defaults. If `mk_service_register` had failed the process would
have exited with code 2 before printing anything ([`src/main.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L34)).

## A setting does not take effect

Reads and writes of a plain field only touch the RAM store, so a change that "does not take effect" is
usually a reader that has not re-read the field, not a capsule fault; the store has no notification channel
and readers poll a `get` when they need a value (see [protocol.md](/docs/userland/policy/protocol/)). For the four mirrored
fields (`KernelPreempt`, `Timezone`, `Hostname`, `DomainName`) the write also fires an `AdminPolicyPush`; a
store update that lands but a kernel effect that does not is a push-side symptom, so check the admin syscall
and its kernel handler ([`src/push/on_bool_set.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/push/on_bool_set.rs#L22),
[`src/syscall/dispatch/router/admin/policy_push/entry.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/admin/policy_push/entry.rs#L25)). Any other kernel-security toggle is recorded
but not pushed by the current build, so expecting a kernel effect from, for example, `KernelSmep` is
expecting behavior that is not wired yet; that gap is documented on [gate.md](/docs/userland/policy/gate/).

## A write is denied

A `set` from anything but `app.settings` or `app.setup_wizard` returns `E_ACCES`; that is the write gate
doing its job ([`src/server/handle_set.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handle_set.rs#L42)). If a legitimate writer is being denied, the suspect is
service resolution: `mk_service_lookup` must return that writer's live pid, so confirm the settings app or
wizard actually registered its service name and is running ([`src/server/handle_set.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handle_set.rs#L37)). The gate
resolves the name at call time, so a writer that crashed and did not re-register will be denied even though
its name is "known".

## A request is rejected

- `E_INVAL` means an unknown op, an unknown field discriminant, a body that runs past the frame, or a value
  the store refuses (over a max, out of the timezone range, or a bad string byte)
  ([`src/server/runner.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L42), `:48`, `:55`, [`src/store/set_u8.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/set_u8.rs#L23), [`src/store/set_i8.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/set_i8.rs#L25),
  [`src/store/str_validate.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/str_validate.rs#L19)).
- `E_BAD_LEN` means the payload length did not match the kind: a bool or numeric that was not exactly one
  byte, or a string over 63 bytes ([`src/server/handlers/set_bool.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_bool.rs#L25), [`src/server/handlers/set_str.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_str.rs#L25)).
- `E_NOT_FOUND` means a `get` reached a getter that does not carry that field for its kind
  ([`src/server/handlers/get_bool.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_bool.rs#L28)).

## Malformed input is dropped

A frame shorter than the 12-byte header is silently skipped rather than answered, and a header that fails
to decode is skipped; only a decodable header with a bad op or field gets an error reply
([`src/server/runner.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L32), `:36`). If a client sends and never gets any reply at all, this is the first
thing to rule out: the frame likely arrived under 12 bytes or with a header that did not parse.

## Source map

This page is drawn from `userland/capsule_policy/src/` (`main.rs`, [`server/runner.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/runner.rs), [`server/handle_set.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/server/handle_set.rs),
`server/handlers/`, `store/`, `push/`) and the kernel-side boot and mirror paths in
[`src/userspace/init/spawn_plan/core.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/core.rs), [`src/userspace/init/capsule_boot/run.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs), and
`src/syscall/dispatch/router/admin/policy_push/`. Every reference above is verified against those trees.
