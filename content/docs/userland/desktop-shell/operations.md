---
title: "The Served Operations"
description: "This page mirrors src/server/ and src/protocol/: the frame protocol the shell serves on its own port, the six operations other capsules call, the launcher focus path that a dock..."
weight: 2
---
This page mirrors `src/server/` and `src/protocol/`: the frame protocol the shell serves on its own
port, the six operations other capsules call, the launcher focus path that a dock click drives, the
window-manager lifecycle handling, and the loop that ties them together. For the pixels these produce see
[surface.md](/docs/userland/desktop-shell/surface/); for the state they touch see [state.md](/docs/userland/desktop-shell/state/); for the outbound calls the
shell makes in response see [clients.md](/docs/userland/desktop-shell/clients/).

## The NDSH frame protocol

The shell serves its own frame protocol on its inbound port. The magic is `NDSH` (`0x4E44_5348`), the
version is 1, and the header is 20 bytes ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17), `header.rs:18`, `header.rs:19`).
`parse` validates the length, then the magic, then the version, then checks that the declared payload
length plus the header exactly equals the buffer length; a mismatch is `E_BAD_LEN`, a wrong magic is
`E_BAD_MAGIC`, a wrong version is `E_BAD_VERSION` ([`src/protocol/decode.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L20), `decode.rs:39`,
`decode.rs:45`, `decode.rs:51`). Every reply is a 4-byte status word written by `respond::status`, which
builds the response header and calls `mk_ipc_reply` ([`src/server/respond.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L21),
[`src/protocol/limits.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L18)). Error codes are the usual negatives ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)):

```
  E_NOENT        -2    no such owned entry
  E_NOMEM       -12    table full
  E_BUSY        -16    duplicate (pid, tray_id)
  E_INVAL       -22    bad body length or field
  E_BAD_OP      -38    unknown op with empty body
  E_BAD_MAGIC   -71    wrong frame magic
  E_BAD_LEN     -90    header/payload length mismatch
  E_BAD_VERSION -93    wrong frame version
```

## The six operations

The shell serves six operations on its `NDSH` port ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)), routed by `dispatch`
([`src/server/dispatch.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L24)):

```
  OP_HEALTHCHECK     0x0001   liveness probe, empty body      ops.rs:17
  OP_TRAY_REGISTER   0x0002   add an owner-scoped tray entry  ops.rs:18
  OP_TRAY_UPDATE     0x0003   relabel an owned tray entry     ops.rs:19
  OP_TRAY_REMOVE     0x0004   drop an owned tray entry        ops.rs:20
  OP_NOTIFY          0x0005   enqueue a toast                 ops.rs:21
  OP_SPOTLIGHT_OPEN  0x0006   toggle the spotlight panel      ops.rs:22
```

`dispatch` answers an unknown op with an empty body with `E_BAD_OP` and any other malformed op with
`E_INVAL` (`dispatch.rs:34`, `dispatch.rs:37`). Both `OP_HEALTHCHECK` and `OP_SPOTLIGHT_OPEN` require an
empty body (`dispatch.rs:26`, `dispatch.rs:31`).

### Healthcheck

`OP_HEALTHCHECK` replies with status 0 and nothing else ([`src/server/handlers/health.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L21)).

### Tray

The tray is a set of owner-scoped entries other capsules register, update, and remove. Each request
carries a `tray_id`, a label length, and up to 24 label bytes, and each handler validates a fixed body
length ([`src/protocol/limits.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L20), `limits.rs:24`).

- `TRAY_REGISTER` rejects a body of the wrong length or a bad `tray_id`/label length with `E_INVAL`, a
  duplicate `(pid, tray_id)` with `E_BUSY`, and a full table with `E_NOMEM`; it tags the entry with the
  sender pid, then repaints the menu bar and commits damage ([`src/server/handlers/tray_register.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tray_register.rs#L24),
  `tray_register.rs:36`, `tray_register.rs:41`, `tray_register.rs:52`, `tray_register.rs:56`).
- `TRAY_UPDATE` relabels an entry the caller owns via `find_mut`, or returns `E_NOENT`
  ([`src/server/handlers/tray_update.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tray_update.rs#L40)).
- `TRAY_REMOVE` drops an owned entry via `remove`, or returns `E_NOENT`
  ([`src/server/handlers/tray_remove.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tray_remove.rs#L32)).

Ownership is enforced on every write: register tags `owner_pid` with `sender_pid`, and update and remove
match on `(owner_pid, tray_id)`, so a caller can only touch entries it created
(`tray_register.rs:41`, [`src/state/tray/table.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/tray/table.rs#L51), `table.rs:56`).

### Notify

`OP_NOTIFY` validates a body of `NOTIFY_REQ_LEN`, reads a level and a body length, rejects an unknown
level or a body length over 128 with `E_INVAL`, then pushes a toast, repaints, and commits
([`src/server/handlers/notify.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/notify.rs#L26), `notify.rs:38`, `notify.rs:42`, `notify.rs:48`). The level is one of
Info, Warn, or Error ([`src/state/notify.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/notify.rs#L26)). The toast appears above the dock for 4 seconds
([`src/state/toasts.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/toasts.rs#L21)). The shell also raises its own `network connected` toast the first time the
link comes up ([`src/server/runner/refresh_clock.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/refresh_clock.rs#L30)).

### Spotlight

`OP_SPOTLIGHT_OPEN` toggles the spotlight visibility flag, repaints, and commits the spotlight rectangle
([`src/server/handlers/spotlight_open.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/spotlight_open.rs#L24), `spotlight_open.rs:26`). The spotlight is drawn as a
rectangle, but its search UX is not yet wired, so there is no in-panel interaction beyond the toggle
([`src/render/chrome.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/render/chrome.rs#L47)).

## The launcher focus path

A dock click is not an `NDSH` op; it arrives as an input frame and is handled before dispatch (see the
loop below). `launcher_focus::handle` hit-tests the pointer against each entry and, on a hit, calls
`launcher_request::request` ([`src/server/handlers/launcher_focus.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/launcher_focus.rs#L33)). That resolves the target
service to a pid with `mk_service_lookup` and, if it is live, sends an 8-byte `NCTL` focus-self frame
(magic `NCTL`, version 1, op 1) to that pid with `mk_ipc_send_to_pid`
([`src/server/handlers/launcher_request.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/launcher_request.rs#L22), `launcher_request.rs:29`, `launcher_request.rs:32`,
`launcher_request.rs:42`). A missing pid makes the click a no-op (`launcher_request.rs:36`). The shell
never spawns a process; there is no installer call anywhere in it. Contrast the
[terminal](/docs/userland/terminal/), which is the capsule that can ask the installer to spawn a store
capsule.

## Window-manager lifecycle

The wm lifecycle notification is a separate inbound frame, magic `NWMV` (`0x4E57_4D56`), 28 bytes,
carrying an event kind (opened=0, closed=1), the owner pid, and a window id
([`src/server/wm_notify.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/wm_notify.rs#L26), `wm_notify.rs:28`, `wm_notify.rs:31`, `wm_notify.rs:37`). `handle`
ignores its own taskbar window id (`wm_notify.rs:45`). On an app window opening it raises its own taskbar
window over the app (`wm_notify.rs:50`), resolves the owner pid back to a dock index by looking up each
launcher service and matching the pid (`wm_notify.rs:52`, [`src/server/wm_notify_app_index.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/wm_notify_app_index.rs#L21)), flips
that entry's open state, and raises a toast for the event (`wm_notify.rs:53`, `wm_notify.rs:56`,
[`src/server/wm_notify_toast.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/wm_notify_toast.rs#L22)).

## The loop

`server::run` paints the initial chrome, then loops ([`src/server/runner/run.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/run.rs#L30), `run.rs:35`):

1. `drain` receives inbound frames. It blocks for up to 1000 ms when the shell is idle and polls at 16 ms
   while a subscription is still pending ([`src/server/runner/drain.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/drain.rs#L27),
   [`src/server/runner/constants.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/constants.rs#L18), `constants.rs:19`). Each frame is classified: a `NWMV` lifecycle
   notification and a `NINP` input frame are recognised by their own magics and handled first, and
   anything else is parsed as an `NDSH` request and dispatched (`drain.rs:39`, `drain.rs:42`,
   `drain.rs:45`, `drain.rs:52`). A parse error is answered with the parser's status code
   (`drain.rs:47`).
2. Once a second the loop refreshes the clock and indicators, re-subscribes to input and wm if either
   subscription was lost, expires toasts and taskbar pulses, and repaints anything that changed
   (`run.rs:38`, `run.rs:40`, `run.rs:44`, `run.rs:48`, `run.rs:52`).
3. It blocks on the display vsync before the next iteration (`run.rs:59`).

## Source map

```
  src/protocol/header.rs     NDSH magic, version, 20-byte header, Request
  src/protocol/ops.rs        the six op codes
  src/protocol/decode.rs     parse: length, magic, version, payload-length checks
  src/protocol/limits.rs     body-length constants (tray, notify)
  src/protocol/errno.rs      the negative status codes
  src/server/respond.rs      status: response header + mk_ipc_reply
  src/server/dispatch.rs     op routing; E_BAD_OP / E_INVAL for the unknown
  src/server/handlers/       health, tray_register/update/remove, notify, spotlight_open, launcher_focus/request
  src/server/wm_notify.rs    NWMV lifecycle: open/close -> dock state + toast
  src/server/wm_notify_app_index.rs  owner pid -> dock index by service lookup
  src/server/runner/run.rs   the loop (drain, clock, expiry, vsync)
  src/server/runner/drain.rs frame classification and dispatch
  src/server/runner/constants.rs  RECV_BLOCK, RECV_RETRY_MS, CLOCK_REFRESH_MS
```

Every reference above is verified against those trees.
