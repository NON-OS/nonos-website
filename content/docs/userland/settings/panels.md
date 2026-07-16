---
title: "Settings panels and controls"
description: "This page mirrors src/settings/schema/ and src/settings/state/."
weight: 2
---
This page mirrors `src/settings/schema/` and `src/settings/state/`. The schema is the spine of the
capsule: it lists every field the capsule knows about and assigns each to one of three tabs. The state is
the in-memory model behind the rows: the active tab, a per-tab cursor and scroll position, and one cached
value per field. Together they decide which rows appear and what each row shows and writes. For the wider
capsule (identity, the write path, rendering, input) see the [settings overview](/docs/userland/settings/).

## The field spine

Every row the user sees is one `Field` from the shared `nonos_policy_proto` crate. The capsule declares
the full set it knows about in `ALL_FIELDS`, a static list of 37 fields ([`src/settings/schema/all_fields.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/schema/all_fields.rs#L19)).
That list has two jobs: it fixes the cache layout (one value slot per entry) and it fixes the hydration
order (the fields are read once each in this order at startup). `slot_of` maps a field to its slot by
searching the list for a matching id ([`src/settings/state/slot_of.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/state/slot_of.rs#L21)), and `FIELD_SLOTS` is just its
length ([`src/settings/state/state.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/state/state.rs#L25)).

A field's kind decides how its row behaves. The kind comes from `kind_of` in the shared crate, not from
anything hard-coded in the capsule ([`userland/policy_proto/src/field_kind.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/field_kind.rs#L20)):

- `KIND_BOOL` (1): a toggle. Space, Enter, or a click on the value flips it and writes the new bool
  ([`src/settings/event/toggle_or_inc.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/toggle_or_inc.rs#L30)).
- `KIND_U8` (2): a numeric or enum value. Left and Right adjust it by one, clamped to the field's max
  ([`src/settings/event/adjust_u8.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/adjust_u8.rs#L26)). A field with an enum table renders as `< Label >  [n/total]`
  ([`src/settings/paint/paint_value_enum.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/paint/paint_value_enum.rs#L25)); the rest render as a decimal.
- `KIND_I8` (3): a signed value. Left and Right adjust it, clamped to -12..=14
  ([`src/settings/event/adjust_i8.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/adjust_i8.rs#L25), `:33`). Only the timezone field uses this.
- `KIND_STR` (4): free text. Enter opens an inline editor; typing appends, Backspace deletes, Enter
  commits the write, Esc cancels ([`src/settings/event/on_event_editing.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/on_event_editing.rs#L24)).

The label shown for each row comes from `label_of` ([`userland/policy_proto/src/field_label.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/field_label.rs#L19)); the
range and the enum tables come from `max_of` and the labels tables in the same crate. None of that
metadata is duplicated in the capsule.

## Tab grouping

`visible_for` assigns fields to tabs. It returns a fixed slice per category: `DISPLAY_FIELDS` for
`Category::User`, `NETWORK_FIELDS` for `Category::Identity`, `SECURITY_FIELDS` for `Category::Kernel`
([`src/settings/schema/visible_for.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/schema/visible_for.rs#L53)). The three tab labels drawn on screen are `Display`, `Network`,
and `Security` ([`src/settings/paint/paint_tabs.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/paint/paint_tabs.rs#L25)).

A field's tab is set by this grouping, not by its numeric category. A few identity-category fields
(anonymous mode, Nym routing) live under the Network tab because that is where `visible_for` places them
([`src/settings/schema/visible_for.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/schema/visible_for.rs#L32)). Conversely, several fields are declared in `ALL_FIELDS` and are
hydrated and writable but are not placed on any tab, so they never appear as rows; they are listed at the
end of this page.

### Display tab (`Category::User`)

Rows from `DISPLAY_FIELDS` ([`src/settings/schema/visible_for.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/schema/visible_for.rs#L19)), in order:

| Row label | Field | Kind | Control and range | What it writes |
|---|---|---|---|---|
| Display brightness | `Brightness` `0x0101` | u8 | Left/Right, 0..=100 | `OP_SET` u8 to `Brightness` (`field_max.rs:25`) |
| Pointer speed | `MouseSensitivity` `0x0102` | u8 | Left/Right, 0..=4 | `OP_SET` u8 to `MouseSensitivity` (`field_max.rs:26`) |
| Cursor size | `CursorSize` `0x0116` | u8 enum | Left/Right cycles Small, Normal, Large, Huge (0..=3) | `OP_SET` u8 index (`cursor_size_labels.rs:17`) |
| High contrast mode | `HighContrast` `0x0111` | bool | Space/Enter toggles | `OP_SET` bool |
| Text size | `FontSize` `0x0112` | u8 enum | Left/Right cycles Tiny, Small, Normal, Large, Huge (0..=4) | `OP_SET` u8 index (`font_size_labels.rs:17`) |
| Color theme | `Theme` `0x0106` | u8 enum | Left/Right cycles Aurora, Slate, Nord, Dracula, Solar, Mono, Forest, Sunset (0..=7) | `OP_SET` u8 index (`theme_labels.rs:17`) |
| Wallpaper | `Wallpaper` `0x0117` | u8 enum | Left/Right cycles the 62 wallpaper names (0..=61) | `OP_SET` u8 index (`wallpaper_labels.rs:17`) |
| Screen blank timeout (min) | `ScreenTimeout` `0x010A` | u8 | Left/Right, 0..=240 | `OP_SET` u8 to `ScreenTimeout` (`field_max.rs:27`) |
| UI animations | `AnimationsEnabled` `0x0115` | bool | Space/Enter toggles | `OP_SET` bool |
| 24-hour clock | `ClockFormat24` `0x0118` | bool | Space/Enter toggles | `OP_SET` bool |

The wallpaper enum has 62 entries named `Field Focus 01..13`, `Hardware Aesthetic 01..14`, `Network
Topology 01..19`, and `Special Variant 1a..15` (`wallpaper_labels.rs:17`), and its selected index is what
the wallpaper capsule reads back to choose the background.

### Network tab (`Category::Identity`)

Rows from `NETWORK_FIELDS` ([`src/settings/schema/visible_for.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/schema/visible_for.rs#L32)), in order:

| Row label | Field | Kind | Control | What it writes |
|---|---|---|---|---|
| Wi-Fi auto-connect | `WifiAutoconnect` `0x0114` | bool | Space/Enter toggles | `OP_SET` bool |
| Anonymous mode | `AnonymousMode` `0x0104` | bool | Space/Enter toggles | `OP_SET` bool |
| Nym routing | `NymEnabled` `0x0105` | bool | Space/Enter toggles | `OP_SET` bool |
| Hostname | `Hostname` `0x0301` | string | Enter opens editor, up to 63 chars, `[A-Za-z0-9._-]` only | `OP_SET` str to `Hostname` |
| Domain name | `DomainName` `0x0302` | string | Enter opens editor, up to 63 chars, `[A-Za-z0-9._-]` only | `OP_SET` str to `DomainName` |

The Wi-Fi auto-connect row is the settings side of Wi-Fi: it toggles the `WifiAutoconnect` policy bit that
the network stack reads to decide whether to associate on boot. It is a single boolean and nothing more;
the network capsule owns the actual scanning, association, and credential handling. For how Wi-Fi brings a
link up, see the [networking subsystem](https://github.com/NON-OS/nonos-micro-kernel/blob/main/subsystems/networking/README.md).

Hostname and domain name are the only free-text controls. The capsule accepts only ASCII letters, digits,
`.`, `-`, and `_` while editing ([`src/settings/event/push_text_char.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/push_text_char.rs#L33)), and the policy server
independently re-validates the bytes with the same character set before storing them
([`userland/capsule_policy/src/store/str_validate.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/store/str_validate.rs#L17)), so an invalid string is rejected on both sides.
The string cap is 63 bytes ([`userland/policy_proto/src/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/limits.rs#L17)).

### Security tab (`Category::Kernel`)

Rows from `SECURITY_FIELDS` ([`src/settings/schema/visible_for.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/schema/visible_for.rs#L40)), in order:

| Row label | Field | Kind | Control | What it writes |
|---|---|---|---|---|
| Auto-lock after idle (min) | `AutoLockTimeout` `0x0113` | u8 | Left/Right, 0..=240 | `OP_SET` u8 (`field_max.rs:28`) |
| Auto-wipe on shutdown | `AutoWipe` `0x0108` | bool | Space/Enter toggles | `OP_SET` bool |
| Hardware crypto offload | `HardwareCrypto` `0x010D` | bool | Space/Enter toggles | `OP_SET` bool |
| Zero-knowledge attestation | `ZkAttestation` `0x010E` | bool | Space/Enter toggles | `OP_SET` bool |
| Developer mode | `DeveloperMode` `0x010C` | bool | Space/Enter toggles | `OP_SET` bool |
| Kernel ASLR | `KernelAslr` `0x0201` | bool | Space/Enter toggles | `OP_SET` bool |
| NX bit enforcement | `KernelNxBit` `0x0203` | bool | Space/Enter toggles | `OP_SET` bool |
| SMEP (supervisor exec prevention) | `KernelSmep` `0x0204` | bool | Space/Enter toggles | `OP_SET` bool |
| SMAP (supervisor access prevention) | `KernelSmap` `0x0205` | bool | Space/Enter toggles | `OP_SET` bool |
| Seccomp syscall filter | `KernelSeccomp` `0x020C` | bool | Space/Enter toggles | `OP_SET` bool |

Every security row is a boolean written through the same gated `OP_SET` path as any other field; setting
one tells the policy store the desired kernel posture, and the store applies it downstream through its
push path ([`userland/capsule_policy/src/push/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/push/mod.rs#L17)). The row labels come straight from
`field_label.rs` (for example `field_label.rs:45` for Kernel ASLR).

### Fields present but not on a tab

`ALL_FIELDS` also declares `SoundEnabled` `0x0103`, `KeyboardLayout` `0x0107`, `Timezone` `0x0109`,
`Language` `0x010B`, `SystemKeysGenerated` `0x010F`, `NotificationsEnabled` `0x0110`, and the kernel
fields `KernelStackGuard`, `KernelDebug`, `KernelSerial`, `KernelWatchdog`, `KernelPreempt`,
`KernelHugepages`, and `KernelIommu` ([`src/settings/schema/all_fields.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/schema/all_fields.rs#L19)). These are hydrated into the
cache at startup and the policy protocol supports getting and setting them, but the current `visible_for`
grouping does not put them on any tab, so they are not shown as rows. The `KeyboardLayout`, `Language`,
and `Timezone` fields carry full metadata (enum tables and the i8 range) and would render correctly if
added to a tab (`keyboard_layout_labels.rs:17`, `language_labels.rs:17`, `field_kind.rs:32`).

## The model behind the rows

The whole capsule state is a single `State` ([`src/settings/state/state.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/state/state.rs#L27)):

| Field | Meaning | Source |
|---|---|---|
| `policy_port`, `policy_ready` | the resolved policy service port and whether it is known | `state.rs:28` |
| `category` | the active tab, one of `User`, `Identity`, `Kernel` | `state.rs:30` |
| `cursor[3]` | the selected row per tab | `state.rs:31` |
| `scroll_top[3]` | the first visible row per tab | `state.rs:32` |
| `values[FIELD_SLOTS]` | one cached value per field in `ALL_FIELDS` | `state.rs:33` |
| `editing`, `edit` | whether a string edit is active and its buffer | `state.rs:34` |
| `status` | the status line text and colour | `state.rs:36` |

Every slot starts `Unknown` until hydration fills it, and the model opens on the Display tab with the
cursor at the top ([`src/settings/state/new.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/state/new.rs#L24)). The value array is indexed by `slot_of`, so a cache
read for a field first finds its slot and then reads that entry ([`src/settings/state/cached_value.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/state/cached_value.rs));
`current_field` maps the active tab plus the cursor back to the `Field` under it
([`src/settings/state/current_field.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/state/current_field.rs)). The per-tab cursor and scroll are kept on screen by
`track_scroll` after any move ([`src/settings/state/track_scroll.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/state/track_scroll.rs#L21)), and `focused_count` gives the
number of rows the active tab actually has ([`src/settings/state/focused_count.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/state/focused_count.rs)), which bounds both the
cursor and pointer hit-testing.

The cache is written only on a confirmed change. A successful `OP_SET` reply is what triggers
`store_value` to update the slot ([`src/settings/state/store_value.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/state/store_value.rs)); a rejected write leaves the cache
untouched and only changes the status line. So the model never shows a value the store did not accept.

## Source map

```
  src/settings/schema/all_fields.rs     the 37-field spine: cache slots and hydration order
  src/settings/schema/visible_for.rs    the three tab groups (Display/Network/Security)
  src/settings/state/state.rs           the State struct: category, cursor, scroll, cache, edit, status
  src/settings/state/new.rs             initial state: Display tab, all slots Unknown
  src/settings/state/slot_of.rs         field -> cache slot
  src/settings/state/current_field.rs   active tab + cursor -> Field
  src/settings/state/{cached_value,store_value}.rs   read and confirmed-write of a cache slot
  src/settings/state/{track_scroll,focused_count}.rs cursor bounds and scroll keep-on-screen
  userland/policy_proto/src/field.rs          the Field enum and ids
  userland/policy_proto/src/{field_label,field_kind,field_max}.rs   labels, kinds, ranges
  userland/policy_proto/src/*_labels.rs       the enum tables (theme, wallpaper, font size, and the rest)
```

Every reference above is verified against those trees.
