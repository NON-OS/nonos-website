---
title: "Contributing"
description: "The source lives at userland/capsulepolicy/, with the shared wire format at userland/policyproto/."
weight: 4
---
The source lives at `userland/capsule_policy/`, with the shared wire format at `userland/policy_proto/`.
The store is under `src/store/`, the request loop and handlers under `src/server/`, the kernel mirror under
`src/push/`, and service registration under `src/bootstrap/`. Read [protocol.md](/docs/userland/policy/protocol/),
[fields.md](/docs/userland/policy/fields/), and [gate.md](/docs/userland/policy/gate/) before you change anything; the three describe the surfaces a
new field has to pass through.

## Adding a policy field

A field is defined in the proto and stored in the capsule, so a new one touches both crates. The steps:

1. Add the discriminant to the `Field` enum, keeping it in its category range (`0x01xx` user, `0x02xx`
   kernel, `0x03xx` identity) so `Category::of` classifies it correctly
   ([`userland/policy_proto/src/field.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/field.rs#L19), [`userland/policy_proto/src/category.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/category.rs#L27)), and add the
   matching arm to `decode_field` so the wire can address it
   ([`userland/policy_proto/src/field_decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/field_decode.rs#L19)).
2. Declare its kind in `kind_of` ([`userland/policy_proto/src/field_kind.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/field_kind.rs#L20)). If it is a bounded u8, add
   its max to `max_of` or, for an enum, its label table to `enum_table`
   ([`userland/policy_proto/src/field_max.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/field_max.rs#L20), [`userland/policy_proto/src/enum_table.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/enum_table.rs#L25)).
3. Add the slot to the `Store` struct ([`src/store/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types.rs#L26)) and its default to the const `store()`
   ([`src/store/defaults/store.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/defaults/store.rs#L21)). The default must be a `const` expression because the store is a
   `const fn`.
4. Wire it into the matching store getter and setter arm. For a bool that is [`src/store/get_bool.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/get_bool.rs#L21) and
   [`src/store/set_bool.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/set_bool.rs#L21); for a u8, i8, or str the corresponding pair. A field that is not wired into
   its getter returns `E_NOT_FOUND` on `get`, and one not wired into its setter returns `E_INVAL` on `set`.
5. If the field must reach the kernel, add a kernel-side id and kind in [`src/push/kernel_field.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/push/kernel_field.rs#L17), an
   arm to the matching `push::on_*_set`, and a line in `push::seed_kernel` so it is primed at boot
   ([`src/push/on_bool_set.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/push/on_bool_set.rs#L22), [`src/push/seed.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/push/seed.rs#L22)). Then handle the id on the kernel side: add it to
   the `PolicyField` enum ([`src/sys/policy/field_id.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/policy/field_id.rs#L19)) and to the `policy_push` router
   ([`src/syscall/dispatch/router/admin/policy_push/entry.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/admin/policy_push/entry.rs#L25)). A field that is stored but not mirrored is
   fine and common; most of the kernel-security bools are exactly that today.

Adding a field does not change the write gate: any new field is writable only by `app.settings` and
`app.setup_wizard`, and readable by anyone, with no extra work ([`src/server/handle_set.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handle_set.rs#L23)).

## Build, sign, verify

The slug `policy` in `Capsule.mk:5` expands the shared template
(`nonos-mk/capsule.mk`, included through `userland/capsule_policy/Capsule.mk:18` and `Makefile:647`) into
the per-slug make targets:

```
  make nonos-mk-policy              build the capsule ELF
  make nonos-mk-policy-sign         produce the id cert, manifest, and attestation trailer
  make nonos-mk-policy-verify       verify the signed artifacts against the trust anchor
  make nonos-mk-check-policy-keys   check the per-capsule signing keys exist
```

(`nonos-mk/capsule.mk:182`, `:261`, `:263`, `:184`.) There is no `policy`-specific desktop-image target;
the capsule is pulled into the desktop profiles through the shared verified-capsule list, which iterates
`$(NONOS_VERIFIED_CAPSULES)` (`Makefile:688`, and the slug appended at `nonos-mk/capsule.mk:151`).

## Code standards

- `cargo fmt` clean and a clean `cargo clippy`.
- No panics, `unwrap`, or `expect` in capsule code. Every handler returns an error status through
  `respond::err`, never a panic ([`src/server/respond/err.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond/err.rs#L21)); every store setter returns a `bool` the
  handler turns into a status.
- Modular files, one unit per file, with `mod.rs` used only for re-exports ([`src/store/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/mod.rs),
  [`src/server/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/mod.rs), [`src/push/mod.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/push/mod.rs#L24)).
- The AGPL header at the top of every source file, matching the header on every existing module.

## Source map

This page is drawn from `userland/policy_proto/src/` (`field.rs`, `field_decode.rs`, `field_kind.rs`,
`field_max.rs`, `enum_table.rs`, `category.rs`), `userland/capsule_policy/src/` (`store/`, `server/`,
`push/`, `bootstrap/`), `userland/capsule_policy/Capsule.mk`, `nonos-mk/capsule.mk`, `Makefile`, and the
kernel-side [`src/sys/policy/field_id.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/policy/field_id.rs) and `src/syscall/dispatch/router/admin/policy_push/`. Every
reference above is verified against those trees.
