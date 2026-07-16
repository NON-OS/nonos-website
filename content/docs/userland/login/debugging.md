---
title: "Debugging capsule_login"
description: "This page lists the log markers login and its boot path emit, and the concrete failure modes with where to look for each."
weight: 6
---
This page lists the log markers login and its boot path emit, and the concrete failure modes with where to
look for each. The two questions that bring people here are "the unlock keeps failing" and "the desktop
never launches", and both have specific signatures. For how login works, see the [README](/docs/userland/login/),
[the protocol page](/docs/userland/login/protocol/), [the unlock flow](/docs/userland/login/unlock/), and [the rendering page](/docs/userland/login/rendering/).

## Did login even come up

Login is spawned in the desktop-services fleet as `boot::capsule("LOGIN", "login", ...)`
([`src/userspace/init/spawn_plan/desktop_services.rs:66`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_services.rs#L66)). On success the capsule boot path calls
`boot_log::ok(prefix, "capsule spawned")`, which prints `[LOGIN] capsule spawned`
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29), [`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). An absent line means the
capsule never started, and the `Err` arm printed an `[ERROR]` line instead through `boot_log::error`, which
is the usual signature, manifest, or capability failure ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)). Login
is also one of the names the spawn tracer emits `[SPAWN]` install-stage lines for, so a stall during its
install shows on the console ([`src/kernel_core/process_spawn/capsule_spawn/runner/install/trace.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/install/trace.rs#L20),
`:24`).

## The overlay never appears (setup stalls)

Setup is order-dependent. Login must find three peers by name before it can serve: the keyring, the desktop
shell, and the compositor ([`src/setup/run.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L22)). If any lookup returns a negative code, a zero port, or a
zero pid, `lookup_port` returns `"service lookup failed"`, `setup::run` returns an `Err`, and
`wait_for_setup` retries in a yield loop rather than finishing ([`src/setup/discover/lookup_port.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/discover/lookup_port.rs#L24),
[`src/wait_for_setup.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wait_for_setup.rs#L20), `:23`). So a login that never paints its lock overlay is usually a peer that has
not registered yet: the keyring, desktop shell, and compositor must come up first. The compositor in
particular is health-checked and queried for dimensions during setup, so a compositor that is up but not
answering shows as `"compositor health failed"` or `"display dimensions unavailable"` inside the retry loop
([`src/setup/run.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/run.rs#L25), [`src/setup/display.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/display.rs#L23)). Login holds no `Debug` capability and prints none of
these strings to the console itself; they are the `Err` values that drive the silent retry, so the visible
symptom is simply no overlay.

## The unlock keeps failing

The unlock returns the failing layer's own errno, so read the status word the caller got back.

- The keyring refused it. If the keyring returns a nonzero status on `OP_UNLOCK`, login returns that status
  verbatim, unchanged ([`src/server/handlers/start_session.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs#L20), [`src/clients/keyring.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/keyring.rs#L28), `:32`). A
  denial here is the keyring's decision, typically its owner-pid check on the key, so debug it on the
  [keyring](/docs/userland/keyring/) side, not in login. Login never held the key or the check.
- Wrong body length. A `START_SESSION` whose body is not exactly 4 bytes is `E_INVAL` before the keyring is
  even called ([`src/server/handlers/start_session.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs#L10)). Only a 4-byte little-endian key id is accepted;
  there is no passphrase or text field to get wrong.
- A session is already open. A second `START_SESSION` while `Unlocked` is `E_BUSY`
  ([`src/state/context/start_session.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/start_session.rs#L22)). End the first session before starting another.
- A short reply from the keyring. If the keyring reply is shorter than its 8-byte header plus a 4-byte
  status, login's client maps it to `-11` rather than trusting a partial frame ([`src/clients/keyring.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/keyring.rs#L21)).

## The desktop never launches after a successful unlock

This is the case where the keyring authorized the unlock but the desktop still does not come up. The signal
that launches the desktop is the desktop-shell notify carrying `login:session_unlocked`, and login is
transactional around it ([`src/server/handlers/start_session.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs#L31)).

- If the shell notify fails, login rolls back: it ends the session it just started, relocks the key through
  the keyring, and returns `E_NOTREADY` ([`src/server/handlers/start_session.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs#L34), `:36`). An `E_NOTREADY`
  from a `START_SESSION` that got past the keyring means the shell was not ready to receive the notify,
  which is the desktop coming up out of order. Check that the desktop shell registered before the unlock.
- If the compositor damage ping fails after the repaint, login rolls back the same way and also returns
  `E_NOTREADY` ([`src/server/handlers/start_session.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs#L40), `:43`). The overlay repaint to the unlocked color
  happens, but without the damage ping the compositor may not present it, so a stuck locked-looking screen
  with an `E_NOTREADY` reply points at the compositor.
- A rolled-back unlock is fully undone. Because login relocks the key and ends the session on either
  failure, a retried `START_SESSION` starts clean rather than hitting `E_BUSY`
  ([`src/server/handlers/start_session.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs#L34), `:41`).

## END_SESSION problems

- An `END_SESSION` from a pid that did not open the session is `E_AUTH`; only the owner can close its own
  session ([`src/state/context/end_session.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/end_session.rs#L24)). An `END_SESSION` while already locked is a no-op that
  returns `Ok` ([`src/state/context/end_session.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/end_session.rs#L23)).
- Like the unlock, a failed shell notify or compositor ping on relock returns `E_NOTREADY`, but relock does
  not roll back, because moving to `Locked` is the safe direction ([`src/server/handlers/end_session.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/end_session.rs#L19),
  `:24`).

## Malformed frames

A frame that fails to parse is rejected before dispatch with the parser's errno echoed on the recovered
request: `E_BAD_MAGIC` for a wrong magic, `E_BAD_VERSION` for a wrong version, and `E_BAD_LEN` for a
too-short or length-mismatched frame ([`src/protocol/decode.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L23), `:29`, `:36`, [`src/server/runner.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L38)).
A known op with a body it should not carry, or an unknown op with a body, is `E_INVAL`; an unknown op with
an empty body is `E_BAD_OP` ([`src/server/runner.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L52), `:54`, `:55`).

## Source map

```
  src/userspace/init/spawn_plan/desktop_services.rs   the LOGIN spawn entry
  src/userspace/init/capsule_boot/run.rs              [LOGIN] capsule spawned / [ERROR] path
  src/sys/boot_log/output.rs                          the boot_log::ok marker format
  src/kernel_core/process_spawn/capsule_spawn/runner/install/trace.rs   the [SPAWN] install trace for login
  userland/capsule_login/src/setup/run.rs             the ordered peer discovery and setup errors
  userland/capsule_login/src/setup/discover/lookup_port.rs   "service lookup failed"
  userland/capsule_login/src/wait_for_setup.rs        the silent retry loop
  userland/capsule_login/src/server/handlers/start_session.rs   the unlock errnos and rollback
  userland/capsule_login/src/server/handlers/end_session.rs     the relock errnos
  userland/capsule_login/src/clients/keyring.rs       the keyring status passthrough
  userland/capsule_login/src/protocol/decode.rs       the parser errnos
```

Every reference above is verified against those trees.