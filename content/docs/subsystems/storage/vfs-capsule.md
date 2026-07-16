---
title: "The Filesystem Capsule"
description: "The modern filesystem path in NØNOS is not in the kernel."
weight: 4
---
The modern filesystem path in NØNOS is not in the kernel. A client capsule that opens a file under
`/ram` reaches a filesystem capsule over IPC, and that capsule owns the store, the path rules, and the
per-caller access. This page documents the IPC-routed filesystem. The code is under
`src/fs/ramfs_capsule/`, `src/fs/vfs_capsule/`, and `userland/capsule_vfs/`.

## Two services

There are two filesystem capsules, spawned at boot as signed capsules:

```
  ramfs_capsule   service "ramfs",    ports 4096 / 4097,  caps IPC + Memory + Crypto
  vfs_capsule     service "vfs_pool", ports 4104 / 4105,  caps IPC + Memory
```

`ramfs_capsule` serves the `/ram` tree directly and is the lower-level store; `vfs_capsule` is the
higher-level filesystem service application capsules (a terminal, a file manager) talk to. Both are
reached the same way, through the kernel's [IPC](/docs/subsystems/ipc/) with a named service endpoint and a
reply inbox, and both are ordinary ring-3 capsules the kernel spawns and can tear down.

## The wire protocol

A filesystem operation is an IPC request encoded to a compact wire form. The operations are a small
set ([`ramfs_capsule/protocol/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/ramfs_capsule/protocol/types.rs)):

```
  OP_OPEN = 1   OP_CLOSE = 2   OP_READ = 3   OP_WRITE = 4   OP_TRUNCATE = 5
```

The client side (`ramfs_capsule/client/`) encodes the request, an open carries the path as a
UTF-8 C-string plus flags, a read carries a handle, offset, and length, sends it to the service
endpoint, and reads the reply from its inbox. An open returns a remote handle (a capsule-side file
descriptor plus a generation); a read returns the bytes; a write returns a status. The kernel does not
interpret any of this; it routes the message and enforces that the caller holds the capability the
service requires, and the filesystem semantics live entirely in the capsule.

## Caller attestation

Because the store is a shared service, it must know who is asking, and it cannot trust the payload to
say so. The sender identity comes from the kernel, which stamps `proc.<pid>` into every
[IPC envelope](/docs/subsystems/ipc/envelope/), not from a field the client fills in. The filesystem capsule reads
the attested caller from the message and applies its access rules against that, so a client cannot
impersonate another to reach its files. The `fs_proofs` suite tests exactly this: a caller cannot forge
another's identity in a request.

## The read-only capsule tree

One access rule is worth calling out: the `/capsules` directory, which holds the signed capsule images,
is read-only. The guard ([`userland/capsule_vfs/.../path/is_read_only.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/.../path/is_read_only.rs)) treats `/capsules` and
anything under it as non-writable:

```
  is_read_only(path):  path == "/capsules" or path starts with "/capsules/"
```

This keeps a capsule from rewriting the signed images the system spawns from. The guard is enforced on
the normalized path, and `fs_proofs` proves it cannot be bypassed by a trailing slash (`/capsules//x`)
or a traversal round-trip (`/capsules/../capsules/x`), because the normalization runs first and both
normalize back under `/capsules`. The verified spawn chain still checks every image's
[signatures](/docs/security/capsules-and-trust/) at load, so the read-only tree is defense in depth,
not the only guard.

## Security analysis

The filesystem capsule is the opposite of a block driver in what it holds: it owns a store and path
rules, but it reaches no hardware at all. Its security rests on holding no device authority, on trusting
the kernel rather than the payload for the caller's identity, and on the read-only guard over the signed
images.

The **filesystem capsules hold no hardware capability.** Both are spawned with a narrow mask
([`src/fs/ramfs_capsule/spawn.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fs/ramfs_capsule/spawn.rs#L50), [`vfs_capsule/spawn.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/vfs_capsule/spawn.rs#L51)): `ramfs_capsule` gets IPC, Memory, and
Crypto (`0x38`), and `vfs_capsule` gets IPC and Memory (`0x18`), with no Driver, Mmio, Irq, Dma, or Pio
bit in either (bits from [`src/capabilities/types.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L54)). So the capsule that parses hostile filesystem
requests cannot map an MMIO region, take an interrupt, or program DMA. A bug in its request handling is
contained to the filesystem service, and it has no path to a controller the way the block drivers do.
The store lives entirely in the capsule's own memory and the kernel routes to it; the kernel does not
interpret any filesystem semantics.

The **caller identity comes from the kernel, not the payload.** Because the store is shared, it must
know who is asking, and it cannot trust a field the client fills in. The kernel stamps `proc.<pid>` into
every [IPC envelope](/docs/subsystems/ipc/envelope/), and the filesystem capsule applies its access rules against
that attested caller, so one client cannot impersonate another to reach its files. The `fs_proofs` suite
tests exactly this: a caller cannot forge another's identity in a request.

The **signed capsule tree is read-only.** The `/capsules` directory holds the signed images the system
spawns from, and the guard ([`userland/capsule_vfs/.../path/is_read_only.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/.../path/is_read_only.rs)) treats `/capsules` and
anything under it as non-writable, enforced on the normalized path so a trailing slash (`/capsules//x`)
or a traversal round-trip (`/capsules/../capsules/x`) both normalize back under `/capsules` and stay
blocked. `fs_proofs` proves the guard cannot be bypassed either way. This keeps a capsule from rewriting
the images the system loads, and it is defense in depth: the verified spawn chain still checks every
image's [signatures](/docs/security/capsules-and-trust/) at load, so the read-only tree is a second
line rather than the only guard.

The **honest boundary is that the store trusts the kernel-attested caller, not a cryptographic token.**
Isolation between clients rests on the kernel envelope being unforgeable, which is the IPC layer's
guarantee, not something the filesystem capsule re-verifies. If the IPC attestation were wrong, the
access rules would be applied against the wrong identity. The capsule's contribution is to consult the
attested caller rather than the payload; the strength of that identity is the [IPC](/docs/subsystems/ipc/)
layer's.

## Debugging the filesystem capsule

The filesystem capsule is reached over IPC rather than a device, so its failures look like a service
that will not answer rather than a driver that will not bring a controller up. The boot log and the
proofs are the two tools.

**Did the capsule spawn.** Both filesystem capsules are spawned through `boot::capsule`
([`src/userspace/init/spawn_plan/core.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/core.rs#L19) and `:32`) with the prefixes `RAMFS` and `VFS`, and the same
`capsule_boot::boot` path that the drivers use prints `capsule spawned` on success or the spawn reason
on failure ([`src/userspace/init/capsule_boot/run.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs)). An absent `[RAMFS] capsule spawned` line means
the capsule's ELF failed signature verification or its manifest requested a capability outside policy,
so the `/ram` service never came up and every open under it will fail to route. On a laptop with no
serial port a `NONOS_FBCONSOLE=1` build mirrors those lines to the framebuffer.

**A request that routes but is refused.** If the service is up but a client's operation is denied, the
question is attestation rather than spawn: the capsule applied its access rules against the kernel-stamped
`proc.<pid>`, so a denied read is a caller reaching another's files or writing under `/capsules`, not a
transport failure. The `is_read_only` guard rejects any write under `/capsules` including the obfuscated
forms, so a write that fails there is the guard working, not a bug.

**Confirming the rules hold without a live boot.** The attestation and the `/capsules` guard are both
covered by `fs_proofs` (`userland/fs_proofs/`), which compiles the production handlers via `#[path]` and
proves a caller cannot forge another's identity and cannot bypass the read-only guard by a trailing slash
or a `..` round-trip. Because it builds the real handler source, a green run is evidence about the code
that actually serves requests, which is the check to run when access behavior is in doubt before
touching a live filesystem.

## Source map

```
  src/fs/ramfs_capsule/route.rs, protocol/, client/    the /ram IPC filesystem (ports 4096/4097)
  src/fs/ramfs_capsule/spawn.rs, vfs_capsule/spawn.rs  the capsule spawns and capability masks
  src/fs/vfs_capsule/                                   the vfs_pool service (ports 4104/4105)
  userland/capsule_vfs/src/                             the store, server, path handlers, is_read_only
  src/userspace/init/spawn_plan/core.rs                the RAMFS/VFS spawn markers
  src/capabilities/types.rs                            the capability bits the masks decode to
  userland/fs_proofs/                                  the proofs (attestation, /capsules guard, fuzz)
```

Every reference above is verified against those trees. The kernel-attested caller these rules rest on is
specified on the [IPC envelope](/docs/subsystems/ipc/envelope/) page, the signature check the read-only tree backs up
on the [capsules and trust](/docs/security/capsules-and-trust/) page, and the path normalization the
guard runs first on the [VFS routing](/docs/subsystems/storage/vfs-and-paths/) page.
