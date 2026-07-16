---
title: "Fields, defaults, and the store"
description: "This page mirrors the field catalog in userland/policyproto/src/field.rs and the store in userland/capsulepolicy/src/store/."
weight: 3
---
This page mirrors the field catalog in `userland/policy_proto/src/field*.rs` and the store in
`userland/capsule_policy/src/store/`. It is the complete list of the 38 fields with their kinds, bounds,
and compiled-in defaults, plus how a value is held and validated. The operations that read and write these
fields are on [protocol.md](/docs/userland/policy/protocol/).

## What a field is

A field is a `u32` discriminant grouped by high byte: `0x01xx` user preferences, `0x02xx` kernel security,
`0x03xx` system identity ([`userland/policy_proto/src/field.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/field.rs#L19), [`userland/policy_proto/src/category.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/category.rs#L27)).
`decode_field` maps a discriminant to a `Field` and rejects any unknown value, so only defined fields are
addressable ([`userland/policy_proto/src/field_decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/field_decode.rs#L19)). Each field has a fixed kind
([`userland/policy_proto/src/field_kind.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/field_kind.rs#L20)), a store slot ([`src/store/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types.rs#L26)), and a compiled-in
default ([`src/store/defaults/store.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/defaults/store.rs#L21)). The defaults below are the values every boot starts from,
because the store is RAM-only and does not persist ([`src/store/state.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/state.rs#L22)).

## User preferences (0x01xx)

| Field | Id | Kind | Default | Source (default) |
|-------|----|------|---------|------------------|
| Brightness | 0x0101 | u8 (max 100) | 80 | [`defaults/store.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L23), max `field_max.rs:25` |
| MouseSensitivity | 0x0102 | u8 (max 4) | 2 | [`defaults/store.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L24), max `field_max.rs:26` |
| SoundEnabled | 0x0103 | bool | true | [`defaults/store.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L25) |
| AnonymousMode | 0x0104 | bool | true | [`defaults/store.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L26) |
| NymEnabled | 0x0105 | bool | false | [`defaults/store.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L27) |
| Theme | 0x0106 | u8 (enum) | 0 | [`defaults/store.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L28) |
| KeyboardLayout | 0x0107 | u8 (enum) | 0 | [`defaults/store.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L29) |
| AutoWipe | 0x0108 | bool | true | [`defaults/store.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L30) |
| Timezone | 0x0109 | i8 (-12..=14) | 0 | [`defaults/store.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L31), range [`store/set_i8.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/store/set_i8.rs#L25) |
| ScreenTimeout | 0x010A | u8 (max 240) | 0 | [`defaults/store.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L32), max `field_max.rs:27` |
| Language | 0x010B | u8 (enum) | 0 | [`defaults/store.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L33) |
| DeveloperMode | 0x010C | bool | false | [`defaults/store.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L34) |
| HardwareCrypto | 0x010D | bool | true | [`defaults/store.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L35) |
| ZkAttestation | 0x010E | bool | true | [`defaults/store.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L36) |
| SystemKeysGenerated | 0x010F | bool | false | [`defaults/store.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L37) |
| NotificationsEnabled | 0x0110 | bool | true | [`defaults/store.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L38) |
| HighContrast | 0x0111 | bool | false | [`defaults/store.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L39) |
| FontSize | 0x0112 | u8 (enum) | 1 | [`defaults/store.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L40) |
| AutoLockTimeout | 0x0113 | u8 (max 240) | 5 | [`defaults/store.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L41), max `field_max.rs:28` |
| WifiAutoconnect | 0x0114 | bool | true | [`defaults/store.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L42) |
| AnimationsEnabled | 0x0115 | bool | true | [`defaults/store.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L43) |
| CursorSize | 0x0116 | u8 (enum) | 1 | [`defaults/store.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L44) |
| Wallpaper | 0x0117 | u8 (enum) | 52 | [`defaults/store.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L45) |
| ClockFormat24 | 0x0118 | bool | true | [`defaults/store.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L46) |

## Kernel security (0x02xx)

All twelve are bool. Whether a value here actually reaches the kernel is a separate question answered on
[gate.md](/docs/userland/policy/gate/): only `KernelPreempt` is mirrored today; the rest are recorded and readable but not yet
wired to a kernel effect.

| Field | Id | Default | Source (default) |
|-------|----|---------|------------------|
| KernelAslr | 0x0201 | true | [`defaults/store.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L47) |
| KernelStackGuard | 0x0202 | true | [`defaults/store.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L48) |
| KernelNxBit | 0x0203 | true | [`defaults/store.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L49) |
| KernelSmep | 0x0204 | true | [`defaults/store.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L50) |
| KernelSmap | 0x0205 | true | [`defaults/store.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L51) |
| KernelDebug | 0x0206 | false | [`defaults/store.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L52) |
| KernelSerial | 0x0207 | true | [`defaults/store.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L53) |
| KernelWatchdog | 0x0208 | false | [`defaults/store.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L54) |
| KernelPreempt | 0x0209 | true | [`defaults/store.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L55) |
| KernelHugepages | 0x020A | false | [`defaults/store.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L56) |
| KernelIommu | 0x020B | true | [`defaults/store.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L57) |
| KernelSeccomp | 0x020C | true | [`defaults/store.rs:58`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L58) |

## System identity (0x03xx)

Both are strings held in a `StringField`: a `[u8; 64]` plus a `len` ([`src/store/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types.rs#L19)).

| Field | Id | Kind | Default | Source (default) |
|-------|----|------|---------|------------------|
| Hostname | 0x0301 | str | `nonos` | [`defaults/store.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L59), [`defaults/constants.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/constants.rs#L17) |
| DomainName | 0x0302 | str | empty | [`defaults/store.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/store.rs#L60), [`defaults/empty_string.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/defaults/empty_string.rs#L19) |

That is 24 user + 12 kernel + 2 identity = 38 fields, one per discriminant in the `Field` enum
([`userland/policy_proto/src/field.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/field.rs#L19)) and one per slot in the `Store` struct ([`src/store/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types.rs#L26)).

## Kinds and bounds

`kind_of` assigns each field one of four kinds. The u8 kind covers Brightness, MouseSensitivity, Theme,
KeyboardLayout, ScreenTimeout, Language, FontSize, AutoLockTimeout, CursorSize, Wallpaper; Timezone is i8;
Hostname and DomainName are str; everything else is bool ([`userland/policy_proto/src/field_kind.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/field_kind.rs#L20)).

A u8 value is bounded before it is stored ([`src/store/set_u8.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/set_u8.rs#L22)):

- Enum fields (Theme, Wallpaper, KeyboardLayout, Language, FontSize, CursorSize) are bounded by the length
  of a label table, `max = table.len() - 1`, so only a value that names a real label is accepted
  ([`userland/policy_proto/src/field_max.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/field_max.rs#L21), [`userland/policy_proto/src/enum_table.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/enum_table.rs#L25)).
- Numeric fields have an explicit max: Brightness 100, MouseSensitivity 4, ScreenTimeout 240,
  AutoLockTimeout 240 ([`userland/policy_proto/src/field_max.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/field_max.rs#L24)).
- Any u8 with no declared bound has `max_of` return 0, and `set_u8` treats `max == 0` as "no ceiling", so
  the full 0..=255 range is accepted ([`src/store/set_u8.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/set_u8.rs#L23)).

Timezone is the only i8, range-checked to `-12..=14` at the store ([`src/store/set_i8.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/set_i8.rs#L25)). Strings are
capped at `STRING_CAP = 64` bytes and restricted to `[A-Za-z0-9._-]`, so a hostname cannot smuggle
arbitrary bytes into whatever reads it ([`src/store/set_str.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/set_str.rs#L24), [`src/store/str_validate.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/str_validate.rs#L19)).

## The store

The store is a single `Store` struct with one slot per field, held behind a global `spin::Mutex`
initialized from the const defaults ([`src/store/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/types.rs#L26), [`src/store/state.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/state.rs#L22),
[`src/store/defaults/store.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/defaults/store.rs#L21)). Access is split one unit per file. `get_bool`, `get_u8`, `get_i8`, and
`get_str` each match a `Field` to its slot and return `None` for a field outside their kind
([`src/store/get_bool.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/get_bool.rs#L21), [`src/store/get_u8.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/get_u8.rs#L21), [`src/store/get_i8.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/get_i8.rs#L21), [`src/store/get_str.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/get_str.rs#L22)).
The `set_*` counterparts do the same and additionally enforce the bounds above, returning `false` for an
out-of-range value or a field outside their kind, which the handler turns into `E_INVAL`
([`src/store/set_bool.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/set_bool.rs#L21), [`src/store/set_u8.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/set_u8.rs#L21), [`src/store/set_i8.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/set_i8.rs#L21), [`src/store/set_str.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/store/set_str.rs#L23)).

## Source map

This page is drawn from `userland/policy_proto/src/` (`field.rs`, `field_decode.rs`, `field_kind.rs`,
`field_max.rs`, `enum_table.rs`, `category.rs`) and `userland/capsule_policy/src/store/` (`types.rs`,
`state.rs`, `defaults/`, and the per-kind `get_*`/`set_*` and `str_validate.rs`). Every reference above is
verified against those trees.
