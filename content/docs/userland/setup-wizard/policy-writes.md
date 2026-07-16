---
title: "The policy write and the honest gaps"
description: "The wizard's authority is not in its capability mask; it is in being trusted by two other services by name."
weight: 4
---
The wizard's authority is not in its capability mask; it is in being trusted by two other services by name.
This page covers the review commit that writes the collected choices to policy, the two-name policy gate
that lets the write land, the keyboard grab that protects first-run entry, and the honest gaps between what
the wizard collects and what actually reaches policy. It mirrors [`src/render/screens/review.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/review.rs) and
[`src/clients/policy.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/policy.rs), with the gates it depends on in `capsule_policy` and `capsule_input_router`. For
the steps that fill these values see [steps.md](/docs/userland/setup-wizard/steps/); for identity and the mask see the
[README](/docs/userland/setup-wizard/).

## What the wizard does not enact

The wizard records intent; it does not enact secrets. Three of the security-sensitive steps collect input
into the wizard's own memory and stop there:

- The identity-keys step advances a UI stage counter and flips `ctx.keys_done` without generating or
  storing any key material ([`src/render/screens/keygen.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/keygen.rs#L26), `keygen.rs:28`).
- The passphrase and admin fields are masked and hold their bytes only in `ctx.pass_buf` and
  `ctx.admin_buf`, and neither is written to policy or used to key a store
  ([`src/render/screens/passphrase.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/passphrase.rs#L36), [`src/render/screens/admin.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/admin.rs#L36)).
- The persistence choice is collected into `ctx.persist_sel` without the wizard configuring or encrypting
  any store ([`src/render/screens/persistence.rs:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/persistence.rs#L15)).

Real key material and an encrypted persistent store are therefore deferred to other capsules. The wizard
collects the configuration and commits the non-secret parts to policy. There is also no abort-and-reboot
from the final review: the only forward exit is to commit and finish, and Escape steps back through the
flow rather than cancelling it ([`src/render/screens/review.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/review.rs#L41), `review.rs:42`).

## The commit

The review step's `commit` is the trusted policy write. It runs when Enter is pressed on the review screen,
before the step counter crosses `DONE` ([`src/render/screens/review.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/review.rs#L41)). If `policy_port` is `0`,
because the policy service was absent at discovery, the whole commit is skipped
(`review.rs:22`, `review.rs:23`). Otherwise it makes the following writes, in order, through the policy
client (`review.rs:26`):

```
  set_u8   Field::Language        0x010B   ctx.lang_sel                     review.rs:26
  set_u8   Field::KeyboardLayout  0x0107   ctx.kbd_sel                      review.rs:27
  set_i8   Field::Timezone        0x0109   ctx.tz_off  (always 0)           review.rs:28
  set_u8   Field::Wallpaper       0x0117   ctx.wall_sel                     review.rs:29
  set_u8   Field::Theme           0x0106   ctx.theme_sel                    review.rs:30
  set_bool Field::AnonymousMode   0x0104   net_sel == 0                     review.rs:31
  set_bool Field::WifiAutoconnect 0x0114   net_sel == 1                     review.rs:32
  set_bool Field::AutoWipe        0x0108   privacy bit 0b010                review.rs:33
  set_bool Field::NymEnabled      0x0105   privacy bit 0b001                review.rs:34
  set_str  Field::Hostname        0x0301   ctx.host_buf  (only if len > 0)  review.rs:36
```

The field numbers are the shared `Field` enum ([`userland/policy_proto/src/field.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/field.rs#L19), `field.rs:30`,
`field.rs:26`, `field.rs:28`, `field.rs:42`, `field.rs:25`, `field.rs:23`, `field.rs:39`, `field.rs:27`,
`field.rs:24`, `field.rs:56`).

## The policy client

Each setter builds an `OP_SET` header, one typed payload byte (or a string body), and calls `mk_ipc_call`
([`src/clients/policy.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/policy.rs#L19), `policy.rs:27`, `policy.rs:35`, `policy.rs:43`). The `finish` helper decodes
the reply header and treats a non-zero status as an error, which the review commit discards with
`let _ =` ([`src/clients/policy.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/policy.rs#L6), `policy.rs:13`). So a single rejected field fails silently rather
than aborting the commit.

## The two-name policy gate

The write lands because policy trusts this name, not because the wizard holds any capability. The policy
`set` dispatcher keeps a two-name allowlist, `app.settings` and `app.setup_wizard`, resolves each name to a
pid, and applies a write only if the sender's pid matches one of them; a write from any other capsule is
answered `E_ACCES` and dropped ([`userland/capsule_policy/src/server/handle_set.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/handle_set.rs#L23), `handle_set.rs:37`,
`handle_set.rs:41`). If the sender is trusted, policy dispatches by the field's kind and type-checks the
payload on its own side (`handle_set.rs:45`). The wizard cannot grant itself authority through this channel
and can only write the fields policy's handlers accept. The [settings app](/docs/userland/settings/) is the
other trusted writer and is how these values are changed after first boot; the
[policy](/docs/userland/policy/) service is the store both write through.

## The keyboard grab

The wizard's other privileged interaction is the exclusive keyboard grab, and it is likewise a grant made
by name. `server::runner::run` grabs the keyboard as soon as it starts ([`src/server/runner.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L14),
[`src/clients/input_router.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/input_router.rs#L38)). The input router's grab handler hard-codes three trusted grabbers,
`app.boot_splash`, `app.setup_wizard`, and `app.input_probe`, and refuses a grab from anyone else with
`E_ACCES`; if the keyboard is already held it returns `E_BUSY`
([`userland/capsule_input_router/src/server/handlers/grab_request.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_input_router/src/server/handlers/grab_request.rs#L25), `grab_request.rs:32`,
`grab_request.rs:49`). The grab is why a background subscriber cannot observe first-run entry, including
the passphrase and admin password. That boundary lives in the [input router](/docs/userland/input-router/),
gated on the wizard's name. Both the subscribe and grab return values are discarded, so a refused grab is
silent ([`src/server/runner.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L13), `runner.rs:14`).

## The honest gaps

The commit collects more than it writes, and maps some choices in a lossy way. These are known gaps in the
current flow, not bugs to work around:

- Admin password never reaches policy. Step 6 fills `ctx.admin_buf`/`ctx.admin_len`, but `commit` has no
  `set_*` call for it, so the admin password is collected and then dropped
  ([`src/render/screens/admin.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/admin.rs#L36), [`src/render/screens/review.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/review.rs#L26)).
- Passphrase never reaches policy. Same shape: step 3 fills `ctx.pass_buf`, and `commit` writes no field
  for it ([`src/render/screens/passphrase.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/passphrase.rs#L36)). It is used only to tick the `Passphrase set` line on the
  review screen (`review.rs:15`).
- Persistence choice never reaches policy. `ctx.persist_sel` has no `set_*` call in `commit`
  ([`src/render/screens/persistence.rs:15`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/persistence.rs#L15), `review.rs:26`).
- Timezone is always written 0. No step edits `ctx.tz_off`, so it holds its default of `0`, yet `commit`
  still writes it as `Field::Timezone` ([`src/state.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L55), `review.rs:28`).
- Hostname is never written. No step edits `ctx.host_buf`, so `ctx.host_len` stays `0` and the guarded
  `Hostname` write never fires ([`src/state.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L63), `review.rs:35`). The field is wired into the commit
  ahead of any UI that would set it.
- The three-way network choice collapses to two booleans. `Amnesic / offline` (0) sets `AnonymousMode`,
  `Direct connection` (1) sets `WifiAutoconnect`, and `Bridged / obfuscated` (2) sets neither, so the
  bridged mode is not distinguishable in policy from a machine that chose neither
  ([`src/render/screens/review.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/screens/review.rs#L31), `review.rs:32`).

## Source map

```
  src/render/screens/review.rs         the commit: the ten set_* calls, in order, and the policy_port guard
  src/clients/policy.rs                set_bool/set_u8/set_i8/set_str and the discarded reply status
  src/render/screens/keygen.rs         the UI-only keygen stage (no key material)
  src/render/screens/passphrase.rs     the masked passphrase held only in Context
  src/render/screens/admin.rs          the masked admin password held only in Context
  src/render/screens/persistence.rs    the collected-but-unwritten persistence choice
  src/state.rs                         tz_off and host_buf defaults behind the timezone/hostname gaps
  src/server/runner.rs                 where the keyboard grab is issued
  src/clients/input_router.rs          grab_keyboard
  userland/policy_proto/src/field.rs   the shared Field enum and its numbers
  userland/capsule_policy/src/server/handle_set.rs                    the two-name policy write gate
  userland/capsule_input_router/src/server/handlers/grab_request.rs   the three-name keyboard grab gate
```

Every reference above is verified against those trees.
</content>
