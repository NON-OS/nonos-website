---
title: "Contributing to capsule_driver_virtio_gpu"
description: "This page is for a contributor who wants to change the virtio-gpu driver."
weight: 4
---
This page is for a contributor who wants to change the virtio-gpu driver. It covers where the source lives,
which folder owns which behaviour, the exact steps to add an IPC op or a device command, how to build and
sign the capsule, and the code standards a change has to meet. For what the driver does and its identity and
capability mask, read the [README](/docs/userland/driver-virtio-gpu/); for how the three pillars fit together see the
[bring-up](/docs/userland/driver-virtio-gpu/bring-up/), the [engine](/docs/userland/driver-virtio-gpu/engine/), and the [client/protocol](/docs/userland/driver-virtio-gpu/client-protocol/) pages in
this folder.

## Where the source lives

The capsule is at `userland/capsule_driver_virtio_gpu/`. It is a `no_std`/`no_main` capsule: `_start`
initializes the heap, retries `setup::run()` until the device comes up, registers `driver.virtio_gpu0` on
service port 4226, and enters the blocking server loop ([`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35)). The nine top-level modules are
declared there ([`src/main.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L19)).

## Module map

The tree is a wire layer over three engine pillars. Each doc page mirrors one region of it.

| Folder | Owns | Touch it when |
|---|---|---|
| `src/discover/` | PCI enumeration, vendor/device match, register BAR select | you change how the device is found |
| `src/setup/` | the brokered claim/bus-master/map/irq/dma quartet, scanout seeding, the primary surface | you change bring-up or rollback |
| `src/init/` | the virtio ACK/DRIVER/FEATURES_OK/DRIVER_OK negotiation | you change feature handling or the queue program |
| `src/device/` | the split virtqueue and the six virtio-gpu control commands | you add or change a device command |
| `src/regs/` | the volatile MMIO/PIO register accessor and the queue notify | you change how registers are read or written |
| `src/state/` | the resource, scanout, and fence tables | you change the runtime tables or the owner-pid model |
| `src/protocol/` | the `NVGP` frame format, opcodes, errno, per-op lengths | you add an op or change the wire format |
| `src/server/` | the receive loop, the dispatcher, and the twelve handlers | you add or change an IPC op |
| [`src/driver.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/driver.rs) | the `Driver` struct that ties grants, queue, regs, and tables together | you add per-driver state |

Inside `src/server/`, `runner/` holds the receive loop and the dispatch match, `handlers/` holds one file
per op, and `respond.rs` holds the reply encoders. Inside `src/device/`, `virtqueue/` is the split queue
and `cmd/` is the six control commands, one file each.

## Adding an IPC op

An op is a wire opcode plus one handler file plus one dispatch arm. There are four edits.

1. Reserve the opcode. Add a `pub const OP_...: u16` to [`src/protocol/ops.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L16), next to the existing
   twelve, and add its fixed request or response length to [`src/protocol/limits.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L16) if it carries a
   fixed body. The header, magic, and version do not change; a new op only adds a match value.

2. Write the handler as one file under `src/server/handlers/` and declare it in
   [`src/server/handlers/mod.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L16). A handler takes `(driver, sender_pid, req, tx)` for an empty-body op
   or `(driver, sender_pid, req, body, tx)` for a command op, validates its own body length first, and
   replies through `respond::status` for a status-only reply or `respond::payload` for a body reply
   ([`src/server/respond.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L20), `:26`). `create_resource` is the reference shape for a command op: it
   rejects a wrong length with `E_INVAL`, decodes its fields with `le_u32`, validates, calls the device,
   and replies ([`src/server/handlers/create_resource.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/create_resource.rs#L24)).

3. Wire it into the dispatch match ([`src/server/runner/dispatch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/dispatch.rs#L26)). A read-only or empty-body op is
   gated behind `if body.is_empty()`, the way the seven state ops are, so a stray body falls through to the
   `E_INVAL` arm ([`src/server/runner/dispatch.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/dispatch.rs#L43)). A command op that carries a fixed body is matched
   unconditionally and validates its own length in the handler ([`src/server/runner/dispatch.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/dispatch.rs#L46)). An
   opcode no arm matches is answered `E_BAD_OP` on an empty body and `E_INVAL` on a non-empty body
   ([`src/server/runner/dispatch.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/dispatch.rs#L53)).

4. If the op mutates a resource, enforce the two invariants the other command ops enforce: re-check
   `owner_pid == sender_pid` after the length and resource-lookup checks and return `E_BUSY` to anyone
   else, and validate every rect against the resource's own width and height before issuing a device
   command ([`src/server/handlers/get_primary_surface.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_primary_surface.rs#L39) for ownership). A client-supplied physical
   address must be bounded against the surface's own DMA region before it reaches the device, the way
   `attach_backing` does it.

## Adding a device command

The six control commands under `src/device/cmd/` are the whole device-facing vocabulary. To add one:

1. Write the command as one file under `src/device/cmd/` and declare and re-export it in
   [`src/device/cmd/mod.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/cmd/mod.rs#L16). Build the 24-byte control header with `Hdr::write`
   ([`src/device/cmd/hdr.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/cmd/hdr.rs#L16)), append the command body, and call `q.submit_sync` with a response buffer.

2. Add the virtio-gpu command type and its accepted response type to [`src/constants/mod.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L60), then check
   the returned header type with `Hdr::parse` and reject a wrong type with a specific error string, the way
   `create_resource_2d` returns `virtio-gpu: create_resource_2d rejected` when the device does not answer
   `RESP_OK_NODATA` ([`src/device/cmd/create_resource_2d.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/cmd/create_resource_2d.rs#L42)). Validate arguments before touching the
   queue, as `create_resource_2d` rejects a zero id or dimension first
   ([`src/device/cmd/create_resource_2d.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/cmd/create_resource_2d.rs#L29)).

## Build and sign

The per-slug make targets are generated from the `NONOS_CAPSULE_RULES` template in
`nonos-mk/capsule.mk:156` and pulled in through `userland/capsule_driver_virtio_gpu/Capsule.mk`, which sets
`CAPSULE_SLUG := driver-virtio-gpu` (`Capsule.mk:5`).

```
  make nonos-mk-driver-virtio-gpu              build the capsule ELF            capsule.mk:182
  make nonos-mk-driver-virtio-gpu-sign         id cert, manifest, attestation   capsule.mk:261
  make nonos-mk-driver-virtio-gpu-verify       verify artifacts vs trust anchor capsule.mk:263
  make nonos-mk-check-driver-virtio-gpu-keys   assert the per-capsule signing keys exist  capsule.mk:184
```

The manifest re-signs whenever the ELF changes, so `payload_hash` stays in sync with the binary
(`nonos-mk/capsule.mk:221`). For a bootable image that includes the driver:

```
  make nonos-mk-driver-virtio-gpu-prod         desktop GUI image with the driver feature  Makefile:945
```

That target sets `KERNEL_FEATURES := microkernel-driver-virtio-gpu` and depends on the signed
`driver-virtio-gpu` artifacts before building the kernel (`Makefile:945`, `:946`). There is no
driver-only or autorun-selftest image target for this capsule; the four generated targets above and the
one `-prod` image target are the whole set.

## Code standards

- `cargo fmt` clean and `cargo clippy` clean.
- No panics in capsule code. No `unwrap`, `expect`, or `panic!`. Bring-up returns `Result<_, &'static
  str>` and every handler reports an error as a negative status word, never a panic; a failed bring-up is
  retried rather than aborted ([`src/main.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L39)).
- One unit per file. A new op is one handler file under `src/server/handlers/`, a new device command is
  one file under `src/device/cmd/`, and `mod.rs` is used only for re-exports, matching the existing tree
  ([`src/device/cmd/mod.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/device/cmd/mod.rs#L16)).
- The AGPL header sits at the top of every source file, byte for byte the same as the header on
  [`src/main.rs:1`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L1) and every other module.

## Source map

```
  userland/capsule_driver_virtio_gpu/src/main.rs         _start -> setup::run -> register -> server::run; the nine modules
  userland/capsule_driver_virtio_gpu/src/discover/       src/setup/ src/init/   the bring-up pillar
  userland/capsule_driver_virtio_gpu/src/device/ src/state/ src/regs/ src/driver.rs   the engine pillar
  userland/capsule_driver_virtio_gpu/src/protocol/ src/server/   the wire and server pillar
  userland/capsule_driver_virtio_gpu/src/protocol/ops.rs   the opcode constants
  userland/capsule_driver_virtio_gpu/src/protocol/limits.rs   the per-op fixed lengths
  userland/capsule_driver_virtio_gpu/src/server/runner/dispatch.rs   the opcode match and body gate
  userland/capsule_driver_virtio_gpu/src/server/handlers/   one file per op
  userland/capsule_driver_virtio_gpu/src/device/cmd/       the six control commands and their mod.rs
  userland/capsule_driver_virtio_gpu/Capsule.mk           slug, handle, ports, capability mask, kernel mirror
  nonos-mk/capsule.mk                                     the nonos-mk-driver-virtio-gpu[-sign|-verify] target templates
  Makefile                                                the -prod image target
```

Every reference above is verified against those trees.
