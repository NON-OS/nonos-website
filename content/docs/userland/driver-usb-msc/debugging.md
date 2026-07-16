---
title: "Debugging capsule_driver_usb_msc"
description: "This page lists the log marker the capsule and its boot path emit, the errno failure modes with where to look for each, and how to read the counter snapshot."
weight: 4
---
This page lists the log marker the capsule and its boot path emit, the errno failure modes with where to
look for each, and how to read the counter snapshot. For the operations and the command wrappers see the
[overview](/docs/userland/driver-usb-msc/), the [operations reference](/docs/userland/driver-usb-msc/operations/), and the [BOT and SCSI page](/docs/userland/driver-usb-msc/bot-scsi/).

## The one boot marker, and why there is only one

The first thing to confirm is that the capsule ran. On a successful boot the kernel prints
`[DRIVER-USB-MSC] capsule spawned`: the spawn plan passes the tag `DRIVER-USB-MSC`, and the boot path's
`Ok` arm calls `boot_log::ok(prefix, "capsule spawned")`, which writes `[<tag>] <msg>`
([`src/userspace/init/spawn_plan/drivers_usb.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_usb.rs#L55), [`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29),
[`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). If that line is absent the capsule never started, and the `Err` arm
logged an `[ERROR]` line with the specific spawn reason instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32), [`src/userspace/init/capsule_boot/error.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/error.rs#L21),
[`src/sys/boot_log/output.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L49)).

That marker is the only serial signal the capsule ever produces. It holds no `Debug` capability by design,
so bulk-transfer payloads never reach the serial surface and there is no per-operation logging
(`userland/capsule_driver_usb_msc/Capsule.mk:17`). Everything else you diagnose comes back over IPC as an
errno or through `OP_GET_STATE`, not through the log.

## Failure modes

### Spawn absent or `[ERROR]` at boot

Usually the feature is off, so the binary is not embedded, or the signature, manifest, cert, or
attestation failed verification. The spawn is gated behind `nonos-capsule-driver-usb-msc`; without it the
plan compiles a no-op `spawn_usb_msc` and nothing is attempted
([`src/userspace/init/spawn_plan/drivers_usb.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_usb.rs#L51), `:62`). The specific error text comes from the spawn
reason mapper ([`src/userspace/init/capsule_boot/error.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/error.rs#L21)). Because the plan runs
`spawn_xhci` first, a missing xHCI marker upstream is worth checking too
([`src/userspace/init/spawn_plan/drivers_usb.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_usb.rs#L18)).

### Probe answers `E_NO_MSC` (-61)

The descriptor parsed cleanly but held no SCSI-transparent BOT interface with both bulk directions. Check
the class triple `0x08 / 0x06 / 0x50` on the interface and that both a bulk-in and a bulk-out endpoint are
present, since a binding is only emitted when both directions are filled
([`src/descriptors/visitor.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/visitor.rs#L34), `:47`, [`src/descriptors/parse.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/parse.rs#L41)). The endpoint snapshot is left
untouched on this answer.

### Probe answers `E_INVAL` (-22)

The descriptor is malformed: shorter than 9 bytes, a wrong type byte in `raw[1]`, a `wTotalLength` under 9
or past the buffer, or a record whose length runs past the total
([`src/descriptors/parse.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/descriptors/parse.rs#L23), `:27`, `:35`). The endpoint snapshot is left untouched. Note this errno
also comes back for a malformed NUMS envelope, so confirm the header framing before blaming the
descriptor.

### A build read or write answers `E_INVAL` or `E_OVERFLOW`

The 6-byte block-request guard failed. `E_INVAL` is a body that is not exactly 6 bytes or a zero block
count; `E_OVERFLOW` is a count above `MAX_TRANSFER_BLOCKS` (128)
([`src/scsi/validate.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/scsi/validate.rs#L20), `:25`, `:28`, [`src/protocol/limits.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L23)). The request body carries the LBA
and count little-endian; if the caller sent them big-endian the count will read as a huge value and trip
`E_OVERFLOW` ([`src/scsi/validate.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/scsi/validate.rs#L23)).

### A CSW answers `E_INVAL` or `E_PHASE`

`E_INVAL` is a wrong length or a bad `USBS` signature; `E_PHASE` is a status byte above 2
([`src/bot/csw.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bot/csw.rs#L29), `:33`, `:39`). A tag that does not match the last issued tag does not error: it
silently bumps the phase-error counter, which you read back with `OP_GET_STATE`
([`src/state/ops.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/ops.rs#L37), [`src/state/snapshot.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/snapshot.rs#L24)). So a caller that reuses or reorders tags will see
climbing phase errors, not a rejection.

### An unknown opcode

An unknown opcode answers `E_BAD_OP` (-38) only if its body was empty; with a non-empty body it answers
`E_INVAL` instead, because the malformed-input catch-all wins over the bad-op arm
([`src/server/dispatch.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L35), `:38`). If you are getting `E_INVAL` for an op you expect to exist, check
both the opcode value and whether you are sending a stray body.

## Reading the counter snapshot

`OP_GET_STATE` is the introspection probe. It returns a 48-byte little-endian snapshot: `probes`,
`csw_ok`, `csw_failed`, `phase_errors`, then `binding_count`, `residue_bytes`, and `last_tag`
([`src/state/snapshot.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/snapshot.rs#L20)). It is how you separate the two big classes of failure without any serial
output:

- `binding_count == 0` means no successful probe has bound an interface. The transport was never
  classified; look at the descriptor path above, not at transfers.
- `binding_count > 0` with a climbing `csw_failed` or `phase_errors` means the transport bound but its
  transfers are failing. Since this capsule never runs a transfer, that points at the caller's xHCI path
  or at tag handling, not at the framing here.
- `probes` climbing without `binding_count` settling means repeated probes that keep failing to bind;
  each `OP_PROBE_CONFIG` bumps `probes` even on a match, so compare it against `binding_count` over time
  ([`src/state/ops.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/ops.rs#L23), `:26`).

## Source map

```
  src/userspace/init/spawn_plan/drivers_usb.rs   DRIVER-USB-MSC tag, feature gate, spawn order
  src/userspace/init/capsule_boot/run.rs         [DRIVER-USB-MSC] capsule spawned / [ERROR] path
  src/userspace/init/capsule_boot/error.rs       the spawn reason mapper for the error line
  src/sys/boot_log/output.rs                     the [<tag>] <msg> boot-log format
  userland/capsule_driver_usb_msc/Capsule.mk     Debug deliberately absent (no serial diagnostics)
  userland/capsule_driver_usb_msc/src/descriptors/parse.rs    E_INVAL / E_NO_MSC descriptor answers
  userland/capsule_driver_usb_msc/src/descriptors/visitor.rs  the class triple and bulk binding
  userland/capsule_driver_usb_msc/src/scsi/validate.rs        E_INVAL / E_OVERFLOW block guard
  userland/capsule_driver_usb_msc/src/bot/csw.rs              E_INVAL / E_PHASE CSW parse
  userland/capsule_driver_usb_msc/src/server/dispatch.rs      E_BAD_OP vs E_INVAL fall-through
  userland/capsule_driver_usb_msc/src/state/ops.rs            phase-error and tag accounting
  userland/capsule_driver_usb_msc/src/state/snapshot.rs       the 48-byte counter snapshot
```

Every reference above is verified against those trees.
