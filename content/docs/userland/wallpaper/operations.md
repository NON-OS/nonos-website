---
title: "The control protocol"
description: "This page covers the protocol the wallpaper capsule serves and the server that answers it: the wire header and its parser under src/protocol/, the drain-and-dispatch loop and th..."
weight: 3
---
This page covers the protocol the wallpaper capsule serves and the server that answers it: the wire
header and its parser under `src/protocol/`, the drain-and-dispatch loop and the five operation handlers
under `src/server/`, the reply framing, the write gate on `SET_WALLPAPER`, and the fade pacer. For how
the capsule selects and paints an image on its own initiative, read the [pipeline](/docs/userland/wallpaper/pipeline/) page; for
the capability mask and identity, read the [README](/docs/userland/wallpaper/).

## The wire header

Requests arrive on the service inbox and are parsed against a 20-byte header carrying magic `NWLP`
(`0x4E574C50`) and version 1 ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17), [`src/protocol/header.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L19)). The header is
`magic u32`, `version u16`, `op u16`, `flags u16`, `_pad u16`, `request_id u32`, `payload_len u32`; the
parser reads the op, flags, and request id, then validates magic, version, and that the declared
`payload_len` exactly matches the remaining bytes ([`src/protocol/decode.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L21)). A short frame is rejected
with `E_BAD_LEN`, a wrong magic with `E_BAD_MAGIC`, a wrong version with `E_BAD_VERSION`, and a body
length that does not match the header with `E_BAD_LEN` ([`src/protocol/decode.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L22),
[`src/protocol/decode.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L38)). Even a rejected frame carries back the op, flags, and request id it could
read, so the error reply is correlatable ([`src/protocol/decode.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L28)).

## The five operations

Five ops dispatch ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17), [`src/server/runner/dispatch.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/dispatch.rs#L24)):

```
  OP_HEALTHCHECK    = 0x0001   reply status 0
  OP_SET_WALLPAPER  = 0x0002   set a flat color or paint an inline image
  OP_GET_WALLPAPER  = 0x0003   report color, policy, dimensions, alpha
  OP_SET_POLICY     = 0x0004   select the fit style
  OP_FADE           = 0x0005   start an alpha ramp
```

| Op | Body | Effect | Handler |
|---|---|---|---|
| `OP_HEALTHCHECK` | empty | reply status 0 | [`handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/health.rs#L20) |
| `OP_SET_WALLPAPER` | 8-byte `argb, _pad`, or a decode-client image | set color or paint image, commit damage | [`handlers/set_wallpaper.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/set_wallpaper.rs#L43) |
| `OP_GET_WALLPAPER` | empty | reply `argb, policy, width, height, alpha, _pad` (24 bytes) | [`handlers/get_wallpaper.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/get_wallpaper.rs#L21) |
| `OP_SET_POLICY` | 8-byte `policy, _pad` | record the fit style, or `E_INVAL` for an unknown one | [`handlers/set_policy.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/set_policy.rs#L21) |
| `OP_FADE` | 8-byte `target_alpha, duration_ms` | start a ramp, or `E_INVAL` if alpha exceeds 255 | [`handlers/fade.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/fade.rs#L25) |

The request body lengths are fixed constants: `SET_WALLPAPER` and `SET_POLICY` and `FADE` each take an
8-byte body, and the `GET_WALLPAPER` reply body is 24 bytes ([`src/protocol/limits.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L21),
[`src/protocol/limits.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L24), [`src/protocol/limits.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L27), [`src/protocol/limits.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L30)). The inbox and
reply buffers are each sized `HDR_LEN + IPC_PAYLOAD_MAX` with `IPC_PAYLOAD_MAX` at 256 bytes
([`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17), [`src/server/runner/entry.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/entry.rs#L28)).

### HEALTHCHECK

`OP_HEALTHCHECK` with an empty body replies status 0 and nothing else ([`handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/health.rs#L20)). The
empty-body condition is enforced in the dispatch: a `HEALTHCHECK` op carrying a body falls through to the
unknown arms below ([`src/server/runner/dispatch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/dispatch.rs#L26)).

### SET_WALLPAPER and its write gate

`SET_WALLPAPER` is the one op that changes what is painted from outside, and it is gated. Before it does
anything it resolves the sender's pid against the service names `desktop_shell` and `policy` through the
registry; a sender that matches neither gets `E_ACCES` and the handler returns without touching the
surface ([`handlers/set_wallpaper.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/set_wallpaper.rs#L26), [`handlers/set_wallpaper.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/set_wallpaper.rs#L39), [`handlers/set_wallpaper.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/set_wallpaper.rs#L44)).

A trusted caller sending an 8-byte body sets a flat color: the first `u32` is stored as the ARGB, its top
byte becomes the current alpha, and `fill_argb` writes the composed color across the whole backing surface
([`handlers/set_wallpaper.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/set_wallpaper.rs#L48), [`src/state/context.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/context.rs#L43), [`src/paint/fill.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/paint/fill.rs#L20)). Any other body length
is handed to the decode client, which parses an inline image header and paints the decoded pixels; a
malformed inline image returns `E_INVAL` ([`handlers/set_wallpaper.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/set_wallpaper.rs#L56)). Either way the handler issues a
fresh request id, commits damage over the whole surface to the compositor, and replies status 0
([`handlers/set_wallpaper.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/set_wallpaper.rs#L60)). The inline decode path is described on the [pipeline](/docs/userland/wallpaper/pipeline/) page.

### GET_WALLPAPER

`OP_GET_WALLPAPER` with an empty body replies a 24-byte payload: the current composed ARGB, the stored
fit policy as a `u32`, the surface width and height, the current alpha widened to a `u32`, and four
padding bytes ([`handlers/get_wallpaper.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/get_wallpaper.rs#L22)). It is read-only and open to any caller with IPC rights.
Note that the policy it reports is the stored fit style, which the paint paths do not yet consult; see the
[pipeline](/docs/userland/wallpaper/pipeline/) page for that gap.

### SET_POLICY

`OP_SET_POLICY` takes an 8-byte body whose first `u32` selects a fit style. The handler rejects a wrong
length, an unreadable word, or a value outside the enum with `E_INVAL`, and otherwise records the style
([`handlers/set_policy.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/set_policy.rs#L22), [`handlers/set_policy.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/set_policy.rs#L30), [`handlers/set_policy.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/set_policy.rs#L34)). `Policy` has
`Fill` (0), `Fit` (1), `Stretch` (2), `Center` (3), and `Tile` (4) ([`src/state/policy.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/policy.rs#L19)). Recording
is all it does: the value is stored on the context and reported back through `GET_WALLPAPER`, but neither
paint path reads it. That gap lives on the [pipeline](/docs/userland/wallpaper/pipeline/) page.

### FADE and the pacer

`OP_FADE` takes an 8-byte body of `target_alpha` and `duration_ms`. The handler rejects a wrong length, an
unreadable field, or a target alpha above 255 with `E_INVAL` ([`handlers/fade.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/fade.rs#L26), [`handlers/fade.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/fade.rs#L38)).
Otherwise it samples the vsync clock as the start time and arms a linear alpha ramp from the current alpha
to the target over the requested duration ([`handlers/fade.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/fade.rs#L42), [`src/state/fade.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/fade.rs#L35)). A zero-duration
fade is defined to snap: the timeline is left inactive, the handler sets the alpha directly, fills, commits
damage, and returns ([`src/state/fade.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/fade.rs#L36), [`handlers/fade.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/fade.rs#L46)).

An armed ramp is driven not by the handler but by the runner's pacer tick. Each loop iteration
`tick::tick` checks whether a fade is active; if so it reads the current vsync time, samples the
interpolated alpha, and only when that alpha differs from the last one does it repaint the flat color at
the new alpha and commit damage ([`src/server/tick.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tick.rs#L25), [`src/server/tick.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tick.rs#L33), [`src/state/fade.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/fade.rs#L53)).
The tick returns `true` when it actually painted a frame, which tells the runner to skip the idle vsync
wait so the ramp keeps pace; when the ramp completes, `sample` clears the active flag and the runner falls
back to waiting on vsync ([`src/server/tick.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tick.rs#L42), [`src/state/fade.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/fade.rs#L57), [`src/server/runner/entry.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/entry.rs#L33)).

## Dispatch and unknown ops

The drain loop receives from the service inbox non-blocking, stops when a recv returns nothing or a zero
sender pid, parses the frame, and either replies the parse error or dispatches
([`src/server/runner/drain.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/drain.rs#L27), [`src/server/runner/drain.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/drain.rs#L40)). Dispatch matches the op; a known op
runs its handler, an unknown op with an empty body replies `E_BAD_OP`, and an unknown op that carries a
body replies `E_INVAL` ([`src/server/runner/dispatch.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/dispatch.rs#L33), [`src/server/runner/dispatch.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/dispatch.rs#L36)).

## Reply framing and the errno set

Every reply is framed by `respond`. `respond::status` writes the response header reusing the request's op,
flags, and request id, writes a 4-byte little-endian status word, and replies `HDR_LEN + 4` bytes;
`respond::payload` does the same but reserves room for a status word plus a body and replies the full
length ([`src/server/respond.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L21), [`src/server/respond.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L27), [`src/protocol/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L19)). The full
errno set is ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)):

```
  E_ACCES        = -13   sender is not desktop_shell or policy
  E_INVAL        = -22   bad body, bad field, or unknown policy value
  E_BAD_OP       = -38   unknown op with an empty body
  E_BAD_MAGIC    = -71   header magic is not NWLP
  E_BAD_LEN      = -90   short frame or payload_len mismatch
  E_BAD_VERSION  = -93   header version is not 1
```

## Source map

```
  userland/capsule_wallpaper/src/protocol/header.rs        NWLP magic, version, header shape
  userland/capsule_wallpaper/src/protocol/decode.rs        the request parser and its errors
  userland/capsule_wallpaper/src/protocol/encode.rs        response header and status writer
  userland/capsule_wallpaper/src/protocol/ops.rs           the five op codes
  userland/capsule_wallpaper/src/protocol/errno.rs         the errno set
  userland/capsule_wallpaper/src/protocol/limits.rs        body lengths and IPC payload cap
  userland/capsule_wallpaper/src/server/runner/drain.rs    non-blocking inbox drain
  userland/capsule_wallpaper/src/server/runner/dispatch.rs op match, unknown-op arms
  userland/capsule_wallpaper/src/server/runner/entry.rs    the loop: drain, subscriber, fade pacer, vsync
  userland/capsule_wallpaper/src/server/handlers/          health, set_wallpaper, get_wallpaper, set_policy, fade
  userland/capsule_wallpaper/src/server/respond.rs         status and payload reply framing
  userland/capsule_wallpaper/src/server/tick.rs            the fade pacer tick
  userland/capsule_wallpaper/src/state/fade.rs             the linear alpha ramp
  userland/capsule_wallpaper/src/state/policy.rs           the fit-style enum
  userland/capsule_wallpaper/src/state/context.rs          set_argb, current_argb, request-id issue
```

Every reference above is verified against those trees.
