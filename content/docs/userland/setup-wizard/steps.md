---
title: "The setup steps"
description: "This page is the user reference for the wizard's ten steps."
weight: 5
---
This page is the user reference for the wizard's ten steps. It mirrors `src/render/screens/`, one file per
step, and describes each screen, the keys it accepts, and the `Context` field it writes. For the machine
that sequences them and the global keys shared by every step, see the
[state machine](/docs/userland/setup-wizard/state-machine/); for what happens to these values at the end, see the
[policy writes](/docs/userland/setup-wizard/policy-writes/). For identity and the capability mask, see the [README](/docs/userland/setup-wizard/).

The wizard is a ten-step state machine. `screens::draw` selects the screen for the current `ctx.step` and
`screens::on_key` routes the key to that screen's handler ([`src/render/screens/mod.rs:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/mod.rs#L15),
[`src/render/screens/mod.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/mod.rs#L31)). The left rail lists all ten steps from `STEP_LABELS` with a `+` for a done
step, `>` for the current step, and `.` for a pending one ([`src/render/chrome.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/chrome.rs#L18),
[`src/render/chrome.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/chrome.rs#L26), [`src/render/theme.rs:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/theme.rs#L15)). Across every step, Enter advances and Escape goes
back one step; list steps also accept `j`/`k` to move the selection and `1`..`9` to jump to an item
([`src/server/step.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/step.rs#L22), [`src/server/step.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/step.rs#L30)).

## Step 0, Language

[`src/render/screens/language.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/language.rs). A single-select list of twelve languages, English through Hindi, drawn
from the shared label table ([`src/render/screens/language.rs:12`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/language.rs#L12),
[`userland/policy_proto/src/language_labels.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/language_labels.rs#L17)). `j`/`k` and `1`..`9` choose, Enter advances
(`language.rs:15`). The choice is stored as an index in `ctx.lang_sel` ([`src/state.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L16)), and the list
labels the selected row with a `>` and a trailing `+` ([`src/render/widgets/rows.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/widgets/rows.rs#L23), `rows.rs:27`).

## Step 1, Keyboard layout

[`src/render/screens/keyboard.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/keyboard.rs). A single-select list of ten layouts, US QWERTY through Chinese, from the
shared label table ([`src/render/screens/keyboard.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/keyboard.rs#L19),
[`userland/policy_proto/src/keyboard_layout_labels.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/keyboard_layout_labels.rs#L17)). Same navigation; the index lands in `ctx.kbd_sel`
(`keyboard.rs:24`, [`src/state.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L10)).

## Step 2, Identity keys

[`src/render/screens/keygen.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/keygen.rs). A two-stage progress screen for an Ed25519 and an ML-DSA-65 keypair. The
subtitle reads `Ed25519 + ML-DSA-65 keypair` and the footer `ENTER GENERATE/NEXT ESC BACK`
(`keygen.rs:9`, `keygen.rs:10`). The first Enter marks the Ed25519 task done and advances the progress bar
to 50 percent; the second marks the ML-DSA-65 task done at 100 percent and sets `ctx.keys_done`; a third
Enter moves to the next step (`keygen.rs:24`, `keygen.rs:19`). This is a UI stage counter, not key
material: the screen advances `ctx.keygen_stage` and flips `ctx.keys_done` but does not itself generate or
store any key (`keygen.rs:26`, `keygen.rs:28`). The [policy writes page](/docs/userland/setup-wizard/policy-writes/) covers why real
key material is deferred to another capsule.

## Step 3, Disk-encryption passphrase

[`src/render/screens/passphrase.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/passphrase.rs). A masked text field for the passphrase that protects the persistent
store at rest (`passphrase.rs:8`, `passphrase.rs:9`). Any printable byte `0x20`..`0x7E` appends to
`ctx.pass_buf` up to 64 bytes, Backspace deletes the last byte, Enter advances (`passphrase.rs:28`,
`passphrase.rs:34`, [`src/state.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L13)). The field renders the entered length as asterisks with a caret and
a strength bar that fills 12 percent per character up to 100, so it is masked and shows a coarse strength
meter ([`src/render/widgets/field.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/widgets/field.rs#L19), `field.rs:29`). The bytes stay in `ctx.pass_buf`/`ctx.pass_len`
and are not written to policy (see the [policy writes page](/docs/userland/setup-wizard/policy-writes/)).

## Step 4, Persistence

[`src/render/screens/persistence.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/persistence.rs). A two-item list, `Amnesic (RAM only)` or `Persistent encrypted store`
(`persistence.rs:5`). `j`/`k` and `1`/`2` choose, Enter advances; the index lands in `ctx.persist_sel`
(`persistence.rs:15`, [`src/state.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L20)). The choice is recorded but the wizard itself does not configure
or encrypt a store.

## Step 5, Network mode

[`src/render/screens/network.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/network.rs). A three-item list, `Amnesic / offline`, `Direct connection`, or
`Bridged / obfuscated` (`network.rs:5`). Same navigation; the index lands in `ctx.net_sel`
(`network.rs:20`, [`src/state.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L19)). At review this index is mapped to two policy booleans, not stored
raw, which is where the three-way choice collapses to two (see the [policy writes page](/docs/userland/setup-wizard/policy-writes/)).

## Step 6, Administration password

[`src/render/screens/admin.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/admin.rs). A masked field with identical mechanics to the passphrase: printable bytes
`0x20`..`0x7E` append to `ctx.admin_buf` up to 64 bytes, Backspace deletes, Enter advances, with the same
asterisk mask and strength bar (`admin.rs:34`, `admin.rs:30`, [`src/render/widgets/field.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/widgets/field.rs#L19),
[`src/state.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L23)). The subtitle reads `Used to authorise privileged actions` (`admin.rs:9`). The entered
password is collected into `ctx.admin_buf`/`ctx.admin_len` but is never committed to policy by the review
step (see the [policy writes page](/docs/userland/setup-wizard/policy-writes/)).

## Step 7, Privacy and hardening

[`src/render/screens/privacy.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/privacy.rs). A three-item toggle list, `MAC address randomization`,
`Secure-wipe RAM on shutdown`, and `Telemetry` (`privacy.rs:5`). `j`/`k` move the focus, Space toggles the
focused item, Enter advances (`privacy.rs:28`, `privacy.rs:32`, `privacy.rs:37`). The three toggle bits
live in the low byte of `ctx.privacy` and the focus index in its high byte; the field defaults to
`0b0000_0011`, so the first two toggles start on (`privacy.rs:22`, `privacy.rs:8`, [`src/state.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L59)).

## Step 8, Appearance

[`src/render/screens/appearance.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/appearance.rs). A three-item wallpaper list, `Deep`, `Slate`, `Night`, chosen with
`j`/`k` or `1`..`3` into `ctx.wall_sel`; the `t` key cycles the theme index `ctx.theme_sel` through three
values; Enter advances (`appearance.rs:5`, `appearance.rs:20`, `appearance.rs:16`, [`src/state.rs:11`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L11),
[`src/state.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L18)). These are the wizard's own three built-in wallpaper names, not the full policy
wallpaper catalog.

## Step 9, Review

[`src/render/screens/review.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/review.rs). A confirmation screen showing three status lines, `Identity keys` (ticked
when `ctx.keys_done`), `Passphrase set` (ticked when `ctx.pass_len > 0`), and `Layout/wallpaper chosen`
(always ticked) (`review.rs:13`). Enter runs `commit` then advances past the last step, which ends the
wizard; Escape goes back to appearance (`review.rs:41`, `review.rs:42`). `commit` is the trusted policy
write and is detailed on the [policy writes page](/docs/userland/setup-wizard/policy-writes/).

## The step list at a glance

| Step | Screen | Kind | Writes to `Context` |
|------|--------|------|---------------------|
| 0 | Language | list of 12 | `lang_sel` |
| 1 | Keyboard | list of 10 | `kbd_sel` |
| 2 | Identity keys | progress | `keygen_stage`, `keys_done` |
| 3 | Passphrase | masked field | `pass_buf`, `pass_len` |
| 4 | Persistence | list of 2 | `persist_sel` |
| 5 | Network | list of 3 | `net_sel` |
| 6 | Admin | masked field | `admin_buf`, `admin_len` |
| 7 | Privacy | toggles of 3 | `privacy` (low byte bits, high byte focus) |
| 8 | Appearance | list of 3 + theme cycle | `wall_sel`, `theme_sel` |
| 9 | Review | confirm | runs `commit` |

## Source map

```
  src/render/screens/mod.rs           draw and on_key dispatch by ctx.step
  src/render/screens/language.rs      step 0, LANGUAGE_LABELS list -> lang_sel
  src/render/screens/keyboard.rs      step 1, KEYBOARD_LAYOUT_LABELS list -> kbd_sel
  src/render/screens/keygen.rs        step 2, two-stage progress -> keygen_stage/keys_done
  src/render/screens/passphrase.rs    step 3, masked field -> pass_buf/pass_len
  src/render/screens/persistence.rs   step 4, two-item list -> persist_sel
  src/render/screens/network.rs       step 5, three-item list -> net_sel
  src/render/screens/admin.rs         step 6, masked field -> admin_buf/admin_len
  src/render/screens/privacy.rs       step 7, three toggles -> privacy
  src/render/screens/appearance.rs    step 8, wallpaper list + theme cycle -> wall_sel/theme_sel
  src/render/screens/review.rs        step 9, status lines + commit
  src/render/widgets/rows.rs          the single-select list widget
  src/render/widgets/toggles.rs       the toggle-row widget
  src/render/widgets/field.rs         the masked field and strength meter
  src/render/widgets/progress.rs      the task/progress widget
  src/render/chrome.rs                the left rail step list and marks
  src/render/theme.rs                 STEP_LABELS and the palette
  src/state.rs                        Context: every selection field
  userland/policy_proto/src/language_labels.rs         the twelve language labels
  userland/policy_proto/src/keyboard_layout_labels.rs  the ten layout labels
```

Every reference above is verified against those trees.
</content>
