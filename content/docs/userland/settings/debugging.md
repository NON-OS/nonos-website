---
title: "Debugging capsule_settings"
description: "This page lists the log marker the settings boot path emits and the concrete failure modes with where to look for each."
weight: 6
---
This page lists the log marker the settings boot path emits and the concrete failure modes with where to
look for each. For the model see the [README](/docs/userland/settings/), the [panels reference](/docs/userland/settings/panels/), the
[policy client](/docs/userland/settings/policy/), the [rendering](/docs/userland/settings/rendering/), and the [input](/docs/userland/settings/input/) pages in this folder.

## Log marker

The first thing to confirm is that the capsule ran. Settings is spawned through the desktop fleet plan,
which names it `APP-SETTINGS` and runs it through the shared capsule boot path
([`src/userspace/init/spawn_plan/apps_tools.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps_tools.rs#L40)). On a successful boot the `Ok` arm of that path logs
`[APP-SETTINGS] capsule spawned` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). If that line is absent the
capsule never started, and the `Err` arm logged an error line instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)), which is the usual signature, manifest, or capability
failure caught at verified spawn ([`src/userspace/capsule_settings/spawn.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_settings/spawn.rs#L56)).

## Failure modes

### Window opens but every row shows `...` and the status reads `policy unavailable`

The capsule could not resolve the `policy` service, so nothing hydrated. `lookup_policy_port` returned
`NotFound` (a zero port), `policy_ready` stayed false, and `paint_status` drew `policy unavailable; showing
static defaults` before consulting any status ([`src/settings/ipc/lookup.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/ipc/lookup.rs#L32),
[`src/settings/paint/paint_status.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/paint/paint_status.rs#L31)). Confirm the policy capsule is registered; the values stay blank
until the lookup succeeds and `ensure_ready` runs hydration once ([`src/settings/app.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/app.rs#L42)). The lookup is
retried on each event, so once the policy service comes up the next keypress fills the rows.

### A change shows `policy rejected` (red status)

The write reached the policy service and the service returned a non-`E_OK` status, which `call` surfaces as
`IpcError::Status` and `report` maps to `policy rejected` ([`src/settings/ipc/call.rs:70`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/ipc/call.rs#L70),
[`src/settings/event/report.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/report.rs#L29)). The usual cause is an out-of-range numeric value or an invalid hostname
character, rejected by the store handler with `E_INVAL` or `E_BAD_LEN`
([`userland/capsule_policy/src/server/handlers/set_str.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/handlers/set_str.rs#L24), [`userland/policy_proto/src/errno.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/errno.rs#L18)). The
same `policy rejected` line also covers an `E_ACCES` denial from the trusted-setter gate; that only happens
if the registry entry for `app.settings` is missing or stale
([`userland/capsule_policy/src/server/handle_set.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/handle_set.rs#L41)).

### A change shows `policy timeout` or `ipc send failed`

The request did not get a reply within 500 ms, or the send itself failed
([`src/settings/ipc/timeout.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/ipc/timeout.rs#L17), [`src/settings/ipc/error.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/ipc/error.rs), [`src/settings/event/report.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/report.rs#L24)). This
points at the policy service being wedged or gone, not at the settings UI.

### The hostname or domain editor drops keystrokes

Only `[A-Za-z0-9._-]` are accepted while editing; any other printable byte is silently ignored by
`push_text_char` ([`src/settings/event/push_text_char.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/push_text_char.rs#L33)). This is by design and matches the server-side
re-validation, so a character the editor drops would have been rejected by the store anyway.

### Rows respond to keys but the frame is blank or stale

If the model changes (a toggle reports `updated`, the cursor moves) but the window shows nothing or a stale
frame, the split is between the model and the renderer. The event layer mutates `State`; `paint` projects
that `State` into the surface ([`src/settings/paint/paint.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/paint/paint.rs#L31)). A blank frame with a live model points at
the paint path, not the event or IPC layer. If keys do nothing at all, that is an input-path problem
(compositor, wm, input router) rather than a settings bug, because `on_event` returns `Idle` for anything
that is not a key-down or a button-down ([`src/settings/event/on_event.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/on_event.rs#L29)).

## Source map

```
  src/userspace/init/spawn_plan/apps_tools.rs   the APP-SETTINGS fleet entry
  src/userspace/init/capsule_boot/run.rs        [APP-SETTINGS] capsule spawned / error path
  src/userspace/capsule_settings/spawn.rs       verified spawn, requested capabilities
  userland/capsule_settings/src/settings/ipc/lookup.rs     policy service resolution
  userland/capsule_settings/src/settings/app.rs            ensure_ready: retry lookup, hydrate once
  userland/capsule_settings/src/settings/ipc/call.rs       reply validation, Status error
  userland/capsule_settings/src/settings/event/report.rs   IpcError -> status message
  userland/capsule_settings/src/settings/event/push_text_char.rs  the editor character filter
  userland/capsule_settings/src/settings/paint/paint.rs    the frame projection
  userland/capsule_policy/src/server/handle_set.rs         the trusted-setter gate (E_ACCES)
```

Every reference above is verified against those trees.
