---
title: "The unlock flow"
description: "This is the pillar that makes login a gate rather than a screensaver."
weight: 3
---
This is the pillar that makes login a gate rather than a screensaver. It covers the two-state session
machine under `src/state/`, the keyring client that is the real credential gate
([`src/clients/keyring.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/keyring.rs)), and the desktop-shell notify that hands the desktop off
([`src/clients/desktop_shell.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/desktop_shell.rs)). For the wire and dispatch that deliver a request here, see
[the protocol page](/docs/userland/login/protocol/); for the overlay repaint that follows an unlock, see
[the rendering page](/docs/userland/login/rendering/).

## The honest shape: no credential lives here

Login never sees a passphrase, a PIN, or any secret bytes. The `START_SESSION` body is a bare 4-byte key id
and nothing else, and the `Context` holds no secret field to protect ([`src/protocol/limits.rs:4`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L4),
[`src/state/context/types.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/types.rs#L16)). The thing that decides whether an unlock succeeds is the
[keyring](/docs/userland/keyring/), which owns the key material and applies its own owner-pid check on
`UNLOCK`. Login carries the key id to the keyring and records the resulting session; it is the overlay and
the session record, and the keyring is the lock. A compromise of login cannot forge an unlock, because
login never held the key or the check.

## The session machine

The session state is a two-variant enum on the `Context` ([`src/state/context/types.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/types.rs#L28)). `Locked` carries
nothing; `Unlocked` carries the `owner_pid` that opened the session, the `key_id` it opened, and a per-session
`serial` ([`src/state/context/types.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/types.rs#L28), `:30`). The `Context` also holds a monotonic `serial` counter that
survives across sessions and starts at 0 ([`src/state/context/types.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/types.rs#L24), [`src/state/context/new.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/new.rs#L36)). At
construction the machine is `Locked` ([`src/state/context/new.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/new.rs#L37)).

Three methods move and read the machine:

- `start_session(owner_pid, key_id)` refuses a second concurrent unlock with `E_BUSY`, then bumps the
  wrapping 32-bit `serial`, stamps the new `Unlocked` variant with the owner, key, and serial, and returns
  the serial ([`src/state/context/start_session.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/start_session.rs#L22), `:25`, `:27`, `:28`).
- `end_session(caller_pid)` is owner-checked. It returns `Ok` as a no-op if already `Locked`, returns
  `E_AUTH` if the caller is not the pid that opened the session, and otherwise sets `Locked`
  ([`src/state/context/end_session.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/end_session.rs#L23), `:24`, `:26`).
- `current_key_id()` returns the open session's key id, or `None` when locked, so the relock path knows
  which key to lock ([`src/state/context/current_key_id.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/current_key_id.rs#L20), `:22`).
- `state_words()` projects the machine to `(state, owner_pid, serial)`, all zeros when locked, for
  `GET_STATE` ([`src/state/context/state_words.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/state_words.rs#L21), `:22`).

## The keyring client is the gate

Login's keyring client speaks the keyring's own wire: an 8-byte header with no magic, then an 8-byte body
([`src/clients/keyring.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/keyring.rs#L6), `:12`). The header is the request id, the op, and a reserved `u16`; the body is
the caller pid and the key id ([`src/clients/keyring.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/keyring.rs#L13), `:14`, `:15`, `:16`, `:17`). Two ops are used:
`OP_UNLOCK` is `5` and `OP_LOCK` is `4` ([`src/clients/keyring.rs:8`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/keyring.rs#L8), `:9`).
These are the same op numbers the [keyring](/docs/userland/keyring/) documents on its side.

The client returns the keyring's status verbatim. A short reply, fewer bytes than the 8-byte header plus a
4-byte status, is mapped to `-11` rather than unwrapped; a well-formed reply returns the keyring's status
word, and a nonzero status is passed back as an error ([`src/clients/keyring.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/keyring.rs#L21), `:24`, `:28`, `:32`).
So a login unlock that fails because the keyring refused it carries the keyring's errno, not a
login-specific one.

## The desktop signal hands off the desktop

After an unlock and the state flip, login tells the desktop shell the gate is open. The desktop-shell client
uses magic `NDSH` (`0x4E44_5348`), version 1, and `OP_NOTIFY` `0x0005`, over a 20-byte header plus a
136-byte notify body (a `u32` level, a `u32` length, and up to 128 message bytes)
([`src/clients/desktop_shell.rs:6`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/desktop_shell.rs#L6), `:7`, `:9`, `:11`, `:16`, `:17`, `:18`). The message is the fixed text
`login:session_unlocked` ([`src/server/handlers/start_session.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs#L7), `:31`). That notify is the handoff that
tells the shell to bring the desktop up. `END_SESSION` sends the mirror message `login:session_locked`
([`src/server/handlers/end_session.rs:7`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/end_session.rs#L7), `:18`). The client returns the shell's status and maps a short
reply to `-11` ([`src/clients/desktop_shell.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/desktop_shell.rs#L32), `:35`).

## START_SESSION in order

The `start_session` handler runs these steps in order, and it is transactional
([`src/server/handlers/start_session.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs)):

```
  start_session(req, sender_pid, body):
      len(body) == 4                                              else E_INVAL      :10
      key_id = u32_le(body[0..4])                                 else E_INVAL      :14
      keyring::unlock(keyring_port, req.request_id, sender_pid, key_id)             :20
          -> on nonzero keyring status, return that status verbatim
      serial = ctx.start_session(sender_pid, key_id)             else E_BUSY        :24
      desktop_shell::notify_info(shell_port, req.request_id ^ serial,
                                 "login:session_unlocked")                          :31
          -> on failure: end_session, keyring::lock, return E_NOTREADY              :34
      render::paint_unlocked(ctx)                                                   :39
      compositor::ping_damage(compositor_port, req.request_id ^ serial)            :40
          -> on failure: end_session, keyring::lock, return E_NOTREADY              :41
      status 0                                                                      :46
```

The rollback is the point. If either follow-on call fails, the shell notify or the compositor damage ping,
login ends the session it just started and relocks the key through the keyring before returning `E_NOTREADY`,
so a session is never left open with a dead overlay ([`src/server/handlers/start_session.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs#L34), `:41`). Each
outbound call carries a request id of `req.request_id ^ serial`, which a peer can correlate back to the
session by xor ([`src/server/handlers/start_session.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/start_session.rs#L31), `:35`, `:40`).

## END_SESSION in order

`end_session` is the reverse and does not roll back, because relocking is the safe direction
([`src/server/handlers/end_session.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/end_session.rs)):

```
  end_session(req, sender_pid):
      key_id = ctx.current_key_id()                                                :10
      ctx.end_session(sender_pid)                                else E_AUTH        :11
      if key_id: keyring::lock(keyring_port, req.request_id, sender_pid, key_id)    :16
      desktop_shell::notify_info(shell_port, req.request_id, "login:session_locked"):18
          -> on failure return E_NOTREADY                                          :19
      render::paint_locked(ctx)                                                     :22
      compositor::ping_damage(compositor_port, req.request_id)                     :23
          -> on failure return E_NOTREADY                                          :24
      status 0                                                                      :27
```

The owner-pid check is enforced inside `ctx.end_session`, so a second capsule cannot close or hijack the
first one's session over the port; a caller that did not open the session gets `E_AUTH`
([`src/state/context/end_session.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/end_session.rs#L24)). Reading the key id before ending the session is deliberate: once
the state is `Locked`, `current_key_id` would return `None`, so the handler captures it first and relocks
exactly that key ([`src/server/handlers/end_session.rs:10`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/end_session.rs#L10), `:16`).

## What the unlock actually authorizes

The unlock authorizes exactly two things and no more. It moves login's own state to `Unlocked` for one owner
pid and one key id, and it asks the keyring to flip that key's lock so the key becomes usable
([`src/state/context/start_session.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context/start_session.rs#L27), [`src/clients/keyring.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/clients/keyring.rs#L27)). It hands no key material to login.
What an unlocked session unlocks downstream is the keyring's decision, not login's. Login is the visible
gate and the session bookkeeper: there is no session timeout, no rate limiting on start attempts, and the
serial is a wrapping counter, so it is not a second factor.

## Source map

```
  userland/capsule_login/src/state/context/types.rs         the Locked/Unlocked enum and Context fields
  userland/capsule_login/src/state/context/new.rs           starts Locked with serial 0
  userland/capsule_login/src/state/context/start_session.rs E_BUSY guard, wrapping serial, Unlocked stamp
  userland/capsule_login/src/state/context/end_session.rs   Locked no-op, E_AUTH owner check, relock
  userland/capsule_login/src/state/context/current_key_id.rs  the key id captured before relock
  userland/capsule_login/src/clients/keyring.rs             OP_UNLOCK (5) / OP_LOCK (4), status passthrough
  userland/capsule_login/src/clients/desktop_shell.rs       NDSH OP_NOTIFY (5), the session messages
  userland/capsule_login/src/server/handlers/start_session.rs  the ordered, transactional unlock
  userland/capsule_login/src/server/handlers/end_session.rs    the ordered relock
```

Every reference above is verified against those trees.