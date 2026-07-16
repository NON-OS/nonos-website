---
title: "The policy client and write gate"
description: "This page mirrors src/settings/ipc/. It is the only way settings reaches the rest of the system: a policy client that resolves the policy service, reads every field once at star..."
weight: 1
---
This page mirrors `src/settings/ipc/`. It is the only way settings reaches the rest of the system: a
policy client that resolves the `policy` service, reads every field once at startup, and sends a single
`OP_SET` when the user changes a control. The right to write is not a token the capsule carries; it is the
policy service recognising, per message, that the caller is the settings pid. That gate lives on the
server side and is documented here too, because it is what makes settings safe. For the controls that
trigger these writes see [panels.md](/docs/userland/settings/panels/); for the wider capsule see the
[settings overview](/docs/userland/settings/).

## The protocol

Settings speaks the policy protocol defined in the shared `nonos_policy_proto` crate. The service is
`policy` on port 4108 with reply port 4109 ([`userland/policy_proto/src/service.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/service.rs#L17)). Each message is a
12-byte header (`op`, `field`, `kind`, a status word, and a payload length) followed by the payload
([`userland/policy_proto/src/hdr.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/hdr.rs#L17)). There are two operations: `OP_GET` (0x0001) and `OP_SET` (0x0002)
([`userland/policy_proto/src/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/ops.rs#L17)).

## Resolving the service

`lookup_policy_port` calls `mk_service_lookup` for the shared `POLICY_SERVICE_NAME` and fails with
`NotFound` if the returned port is zero ([`src/settings/ipc/lookup.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/ipc/lookup.rs#L24)). `Settings::new` calls it once
at construction and, if it fails, `ensure_ready` retries on each later event until it succeeds
([`src/settings/app.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/app.rs#L42)). Until it does, the status bar shows the policy service as unavailable and the
rows display static defaults.

## Reading the store

`op_get` sends an `OP_GET` with an empty payload and decodes the reply by the field's kind: a bool byte, a
u8, an i8, or a string, checking first that the reply's kind matches what was requested and returning
`KindMismatch` if not ([`src/settings/ipc/op_get.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/ipc/op_get.rs#L26), `:30`). Each decoder rejects an empty payload as a
short reply, and the string decoder clamps to the local `STRING_CAP` ([`src/settings/ipc/op_get.rs:63`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/ipc/op_get.rs#L63)).

Hydration reads the whole store once. `hydrate` walks `ALL_FIELDS` in order, calls `op_get` for each, and
stores whatever comes back; it yields the CPU between reads with `mk_yield` so the read burst does not
starve the scheduler, and it is a no-op if the port is not ready ([`src/settings/ipc/hydrate.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/ipc/hydrate.rs#L24)). The
`App` layer runs it exactly once, guarded by a `hydrated` flag ([`src/settings/app.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/app.rs#L49)).

## Writing the store

The four setters `op_set_bool`, `op_set_u8`, `op_set_i8`, and `op_set_str` each encode the value and send
an `OP_SET` with the field's kind ([`src/settings/ipc/op_set_bool.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/ipc/op_set_bool.rs#L22), `op_set_u8.rs`, `op_set_i8.rs`,
`op_set_str.rs`). None of them talk to IPC directly; they all go through one `call` function.

`call` frames the header, appends the payload, sends the request with `mk_ipc_call_timeout` and a 500 ms
reply timeout ([`src/settings/ipc/timeout.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/ipc/timeout.rs#L17)), and validates the reply in order: a non-positive length
is a timeout, a length under the header size is a short reply, a header that will not decode is a bad
header, a body that runs past the frame is a short reply, and a status other than `E_OK` is returned as a
`Status(code)` error ([`src/settings/ipc/call.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/ipc/call.rs#L28)). Only a clean `E_OK` reply returns `Ok`, and only
then does the caller update the cache. Requests too large to frame are refused before any send
([`src/settings/ipc/call.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/ipc/call.rs#L36)).

The full error set is `NotFound`, `SendFailed`, `RecvTimeout`, `ShortReply`, `BadHeader`, `KindMismatch`,
and `Status(u16)` ([`src/settings/ipc/error.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/ipc/error.rs#L17)). `report` maps each to a specific red status-bar line:
a timeout to `policy timeout`, a send failure to `ipc send failed`, a returned status to `policy
rejected`, and so on ([`src/settings/event/report.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/report.rs#L22)).

## The shell toast

After any successful `OP_SET`, `call` calls `notify_applied` ([`src/settings/ipc/call.rs:73`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/ipc/call.rs#L73)). That looks
up the `desktop_shell` service and, if present, sends a single `NDSH` notify frame (magic `0x4E44_5348`,
op `0x0005`, level info, body `settings applied`) so the shell can surface a toast
([`src/settings/ipc/notify_shell.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/ipc/notify_shell.rs#L32)). The send is best-effort: if the shell is not registered or the
send fails, the write still counts and the failure is ignored. This is the only service settings talks to
other than `policy`.

## The write gate on the server

The gate that authorises a write lives in the policy service, not in settings. When the policy server
receives an `OP_SET`, it reads the sender pid the kernel attested on the message out of `mk_ipc_recv_from`
([`userland/capsule_policy/src/server/recv.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/recv.rs#L21)) and hands it to `dispatch`. `dispatch` calls
`is_trusted_setter` first; if the sender is not trusted it replies `E_ACCES` and returns without touching
the store, otherwise it routes by kind to the matching store handler
([`userland/capsule_policy/src/server/handle_set.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/handle_set.rs#L40), `:41`).

`is_trusted_setter` holds a two-entry allow list, `app.settings` and `app.setup_wizard`, looks up the pid
currently registered for each name, and returns true only if the sender pid matches one of them
([`userland/capsule_policy/src/server/handle_set.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/handle_set.rs#L23), `:36`). So the right to write policy is not a
capability settings carries and could leak; it is the registry recognising, per message, that the caller
is the pid that owns `app.settings` (or `app.setup_wizard`, the first-boot setup wizard). A capsule that
forged the wire format but ran under a different pid is still rejected, because the check is on the
attested sender, not on anything in the payload.

Even as a trusted setter, settings cannot bypass the store's own validation. A bad-length or out-of-range
value is rejected by the matching store handler with `E_INVAL` or `E_BAD_LEN`, and settings only shows
`policy rejected`; it has no way to force the write ([`userland/capsule_policy/src/server/handlers/set_str.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/handlers/set_str.rs#L24),
`:29`, [`src/settings/event/report.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/settings/event/report.rs#L29)). Hostname and domain name are re-validated against the same
`[A-Za-z0-9._-]` set the capsule filters on ([`userland/capsule_policy/src/store/str_validate.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/store/str_validate.rs#L17)), so
the two checks must agree.

## Source map

```
  src/settings/ipc/lookup.rs             resolve the policy service (NotFound on port 0)
  src/settings/ipc/op_get.rs             read one field, decode by kind, check kind matches
  src/settings/ipc/hydrate.rs            read every field once, yield between reads
  src/settings/ipc/{op_set_bool,op_set_u8,op_set_i8,op_set_str}.rs   the four OP_SET encoders
  src/settings/ipc/call.rs               frame, send with 500 ms timeout, validate reply, toast on OP_SET
  src/settings/ipc/timeout.rs            REPLY_TIMEOUT_MS = 500
  src/settings/ipc/error.rs              the IpcError set
  src/settings/ipc/notify_shell.rs       best-effort NDSH toast after a successful write
  src/settings/event/report.rs           IpcError -> status-bar line
  userland/policy_proto/src/{service,hdr,ops}.rs   the policy service name, port, header, and ops
  userland/capsule_policy/src/server/recv.rs        the attested sender pid
  userland/capsule_policy/src/server/handle_set.rs  the trusted-setter gate (app.settings, app.setup_wizard)
  userland/capsule_policy/src/store/str_validate.rs the server-side hostname/domain re-validation
```

Every reference above is verified against those trees.
