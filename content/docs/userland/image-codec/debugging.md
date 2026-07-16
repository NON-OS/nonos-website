---
title: "Debugging"
description: "This page covers the boot marker that tells you the codec ran, and the typed failure signatures on the wire that tell you what a request hit."
weight: 6
---
This page covers the boot marker that tells you the codec ran, and the typed failure signatures on the
wire that tell you what a request hit. Because the service is stateless, a codec that decodes one image and
fails the next is behaving correctly on two different inputs, not degrading.

## Did the capsule spawn?

Two markers appear on a successful spawn. The install path prints a `[SPAWN]` line with the name, pid,
installed mask, and entry ([`src/kernel_core/process_spawn/capsule_spawn/runner/install/spawn_log.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/install/spawn_log.rs#L18),
`spawn_log.rs:22`):

```
  [SPAWN] name=image_codec pid=0x... caps=0x1819 entry=0x...
```

Then the boot helper prints `[IMAGE-CODEC] capsule spawned` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29),
[`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). The `caps=0x1819` field is the installed mask; if a build ever changed
the requested or declared caps, that number is where it shows (the mask decomposition is on the
[README](/docs/userland/image-codec/), and how the install resolves it is on the [safety](/docs/userland/image-codec/safety/) page). An absent pair
means the capsule never started, usually a signature, manifest, or capability failure, and the error path
prints an `[ERROR]` line instead ([`capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_boot/run.rs#L32), [`boot_log/output.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/boot_log/output.rs#L49)).

## Failure signatures on the wire

Every failure the codec produces is a typed errno in the reply status word; there are no silent drops. The
error codes and their values are on the [protocol](/docs/userland/image-codec/protocol/) page. Grouped by where they come from:

- Frame rejected before decode. A wrong magic returns `E_BAD_MAGIC` (`-74`), a wrong version returns
  `E_BAD_VERSION` (`-93`), and a short header or a payload length that does not match the buffer returns
  `E_BAD_LEN` (`-90`) ([`src/protocol/decode.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L33), `decode.rs:52`, `decode.rs:26`, `decode.rs:62`). A
  caller that sees these is looking at a malformed frame, not a bad image.

- Unknown or misused op. An opcode outside the known set with an empty body returns `E_BAD_OP` (`-38`); a
  non-empty body on an unknown op, or a healthcheck with a non-empty body, returns `E_INVAL` (`-22`)
  ([`src/server/runner.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L54), `runner.rs:55`).

- Decode failed. A truncated or malformed image, an unsupported feature, or an image that exceeds the
  `MAX_PIXELS` budget returns a typed status and no handle: `E_INVAL` for a bad container magic,
  `E_UNSUPPORTED` for a recognised-but-unsupported feature, and `E_BAD_LEN` for bad dimensions, a too-small
  output, or truncation ([`src/server/handlers/decode.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/decode.rs#L34), `decode.rs:47`, `decode.rs:56`). A caller that
  gets a nonzero status and no surface handle is looking at a bad image, not a dead codec.

- Surface allocation failed. If the decode succeeded but the surface could not be mapped, registered, or
  shared, the reply is `E_NOMEM` (`-12`) or the raw negative registration status
  ([`src/server/handlers/surface.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/surface.rs#L34), `surface.rs:51`, `surface.rs:53`, `surface.rs:56`).

- Payload too large. A request whose framed body would exceed `IPC_PAYLOAD_MAX` (128 KiB) cannot fit the
  receive buffer, so it is bounded at the transport before decode ([`src/server/runner.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L29),
  [`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17)).

## Reading the loop behaviour

The loop blocks when idle and drains when busy ([`src/server/runner.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L36)). If the capsule appears
unresponsive but the `[SPAWN]` line was printed, the loop is almost certainly blocked in
`mk_ipc_recv_from` waiting for the first message, which is the normal idle state, not a hang
(`runner.rs:41`). A reply always goes back to the `sender_pid` the receive reported, so if a caller never
sees a reply, confirm it is sending to service port 4412 with a valid reply inbox; the [server](/docs/userland/image-codec/server/)
page walks the dispatch, and the [protocol](/docs/userland/image-codec/protocol/) page has the frame the caller must send.

## No in-tree caller

At the time of writing no in-tree capsule calls this service over IPC. The wallpaper capsule decodes PNG
in-process with the same toolkit decoder rather than calling port 4412
([`userland/capsule_wallpaper/src/decode_client/wire.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/decode_client/wire.rs#L21)). If you are debugging a new caller, the
[protocol](/docs/userland/image-codec/protocol/) page is the contract to target, and the typed errno in the status word is your
first diagnostic.

## Source map

This page is drawn from the boot markers under
`src/kernel_core/process_spawn/capsule_spawn/runner/install/` and `src/userspace/init/capsule_boot/`
(with [`src/sys/boot_log/output.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs)), the capsule's `src/protocol/` parser and `src/server/` loop and
handlers that produce the typed errnos, and the in-process decode reference in
`userland/capsule_wallpaper/`. Every reference above is verified against those trees.
