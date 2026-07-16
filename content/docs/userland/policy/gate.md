---
title: "The write gate and the kernel mirror"
description: "This page mirrors userland/capsulepolicy/src/server/handleset.rs (the write gate) and userland/capsulepolicy/src/push/ (the kernel mirror)."
weight: 1
---
This page mirrors [`userland/capsule_policy/src/server/handle_set.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/handle_set.rs) (the write gate) and
`userland/capsule_policy/src/push/` (the kernel mirror). It is the trust core of the capsule: who may write
a setting, and how four of those writes reach the running kernel. The field catalog is on
[fields.md](/docs/userland/policy/fields/); the operations are on [protocol.md](/docs/userland/policy/protocol/).

## The write gate

Reads are open, writes are not. `handle_set::dispatch` resolves the two allowed setter names through the
kernel service registry and compares each resolved pid to the sender before it touches the store
([`src/server/handle_set.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handle_set.rs#L40)):

```
  SETTERS = [ b"app.settings", b"app.setup_wizard" ]          handle_set.rs:23

  lookup_pid(name):
      mk_service_lookup(name) -> (port, pid)
      None if rc < 0 or pid == 0                              handle_set.rs:25

  is_trusted_setter(sender):
      any name in SETTERS where lookup_pid(name) == Some(sender)   handle_set.rs:36

  dispatch(pid, field, payload):
      if not is_trusted_setter(pid):
          respond E_ACCES                                     handle_set.rs:41
          return
      route by kind_of(field) -> set_bool / set_u8 / set_i8 / set_str
```

Only the settings app and the setup wizard, named `app.settings` and `app.setup_wizard`, may call `set`.
The gate resolves those two names to live pids through `mk_service_lookup` at the moment of the call, so a
caller cannot spoof the identity by claiming a name; it has to actually be the pid the registry returns for
one of those services ([`src/server/handle_set.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handle_set.rs#L25), `:37`). Every other caller's `set` returns `E_ACCES`
before the store is read or written ([`src/server/handle_set.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handle_set.rs#L42)). `get` has no such gate: any caller that
can reach the endpoint may read any field. The two writers are documented in
[settings](/docs/userland/settings/) and [setup-wizard](/docs/userland/setup-wizard/).

What each side of a compromise can do:

- A compromised reader (any capsule holding IPC) can `get` every field, including the kernel-security
  toggles and the identity strings, but cannot `set` anything; the gate returns `E_ACCES` before any
  mutation ([`src/server/handle_set.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handle_set.rs#L41)).
- A compromised writer (`app.settings` or `app.setup_wizard`) can `set` any field, including
  `KernelPreempt`, whose change is pushed into the running kernel. This is a real trust concentration: the
  gate is coarse, keyed on the service name rather than a per-field capability, so either writer can write
  the whole policy surface. It is stated here rather than hidden. The typing and bounds still limit the
  blast radius: u8 values are range-checked, the timezone is bounded, and strings are capped and restricted
  to `[A-Za-z0-9._-]` ([`src/store/set_u8.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/set_u8.rs#L22), [`src/store/set_i8.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/set_i8.rs#L25), [`src/store/str_validate.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/str_validate.rs#L19)).

## The kernel mirror

Most fields are pure state that readers poll. Four are also mirrored into the running kernel so that a
change takes effect rather than merely being recorded: `KernelPreempt` (bool), `Timezone` (i8), `Hostname`
and `DomainName` (str). The `push` module is that mirror, and it runs after the store mutation succeeds.

- `on_bool_set` forwards only `KernelPreempt`; any other bool field is ignored
  ([`src/push/on_bool_set.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/push/on_bool_set.rs#L22)).
- `on_i8_set` forwards only `Timezone` ([`src/push/on_i8_set.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/push/on_i8_set.rs#L22)).
- `on_string_set` forwards `Hostname` and `DomainName` ([`src/push/on_string_set.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/push/on_string_set.rs#L22)).

Each maps the wire `Field` to a small kernel-side id and kind and calls `raw::submit`, which is the
`mk_admin_policy_push` syscall ([`src/push/kernel_field.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/push/kernel_field.rs#L17), [`src/push/raw.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/push/raw.rs#L19)). The kernel-side ids
are the capsule's own small enum, distinct from the wire `Field` discriminants: `KERNEL_PREEMPT 0x0001`,
`TIMEZONE_OFFSET 0x0002`, `HOSTNAME 0x0003`, `DOMAIN_NAME 0x0004`, with kinds `KIND_BOOL 1`, `KIND_I8 2`,
`KIND_STR 3` ([`src/push/kernel_field.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/push/kernel_field.rs#L17)).

## The syscall and the kernel end

The syscall is `mk_admin_policy_push(field_id, kind, ptr, len)`, the `AdminPolicyPush` syscall, which the
kernel admits only for a caller that holds `Admin` ([`src/push/raw.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/push/raw.rs#L19),
[`src/syscall/contract/cap_table/admin.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/admin.rs#L24)). This is why the capsule carries the `Admin` bit and nothing
else elevated; see the mask decomposition on the [hub](/docs/userland/policy/). The kernel-side router revalidates the
id and kind before applying the value, mapping the id back through its own `PolicyField` enum and rejecting
an unknown id or kind with `E_INVAL` ([`src/syscall/dispatch/router/admin/policy_push/entry.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/admin/policy_push/entry.rs#L25),
[`src/sys/policy/field_id.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/policy/field_id.rs#L19)). The kernel `PolicyField` ids match the capsule's:
`KernelPreempt 0x0001`, `TimezoneOffset 0x0002`, `Hostname 0x0003`, `DomainName 0x0004`
([`src/sys/policy/field_id.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/policy/field_id.rs#L20)).

## The boot seed

At startup, before entering the request loop, `push::seed_kernel` reads the current values of exactly those
four mirrored fields and pushes each into the kernel so the two agree from boot, even if nothing is written
that session ([`src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L37), [`src/push/seed.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/push/seed.rs#L22)). It calls the same `on_*_set` paths the live writes
use, so the seed and a later write travel the identical route into the kernel ([`src/push/seed.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/push/seed.rs#L23)).

## The honest gap

Of the twelve kernel-security fields, only `KernelPreempt` is actually pushed into the kernel today
([`src/push/on_bool_set.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/push/on_bool_set.rs#L22)). The other eleven, ASLR, StackGuard, NX, SMEP, SMAP, Debug, Serial,
Watchdog, Hugepages, IOMMU, and Seccomp, are recorded in the store and served to readers, but the current
build does not mirror them, so expecting a kernel effect from, for example, `KernelSmep` is expecting
behavior that is not wired yet. There is also no audit log of policy changes and no transactional
multi-field update; each `set` is independent.

## Source map

This page is drawn from [`userland/capsule_policy/src/server/handle_set.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/handle_set.rs),
`userland/capsule_policy/src/push/` (`on_bool_set.rs`, `on_i8_set.rs`, `on_string_set.rs`,
`kernel_field.rs`, `raw.rs`, `seed.rs`), and the kernel-side mirror in [`src/sys/policy/field_id.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/policy/field_id.rs),
`src/syscall/dispatch/router/admin/policy_push/`, and [`src/syscall/contract/cap_table/admin.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/admin.rs). Every
reference above is verified against those trees.
