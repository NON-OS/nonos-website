---
title: "Storage"
description: "How NØNOS stores files. The kernel's live filesystem is in RAM, zeroed as it is freed; the modern path for capsule clients is an IPC-routed filesystem capsule; and underneath, f..."
weight: 15
---
How NØNOS stores files. The kernel's live filesystem is in RAM, zeroed as it is freed; the modern
path for capsule clients is an IPC-routed filesystem capsule; and underneath, for the code that asks
for persistence, is a uniform block-device layer over real NVMe, AHCI, and virtio-blk drivers. The
disk drivers and the higher-level filesystem both run as capsules, not in the kernel.

| Page | What it covers |
|------|----------------|
| [block-device.md](/docs/subsystems/storage/block-device/) | The `Backend` abstraction, the NVMe -> AHCI -> virtio probe, and the block operations dispatched to the driver capsules over IPC. |
| [ramfs.md](/docs/subsystems/storage/ramfs/) | The in-kernel RAM filesystem, the `NonosFile`, and the zero-on-drop wipe that ties it to ZeroState. |
| [vfs-and-paths.md](/docs/subsystems/storage/vfs-and-paths/) | The prefix router (`/ram`, `/data`, else RAMFS), the dormant on-disk blockfs store, and the path-traversal defenses. |
| [vfs-capsule.md](/docs/subsystems/storage/vfs-capsule/) | The IPC-routed filesystem capsules, the wire protocol, kernel-attested callers, the read-only `/capsules` tree, and the proofs. |

Two honest framings run through the section. First, live versus dormant: the RAM filesystem and the
IPC-routed capsule are the runtime path, while the on-disk `blockfs` and its `cryptoblock` encryption
are built and correct but off the normal boot path (served only when something reads `/data`), and the
legacy `devfs` / `ext4` / `sysfs` surfaces are not on the microkernel path at all. Second, the
filesystem is a capsule, not the kernel: the disk drivers are capsules reached through the
[hardware broker](/docs/subsystems/hardware-broker/), and the modern filesystem is a capsule reached through
[IPC](/docs/subsystems/ipc/), so a driver or filesystem bug is contained in a capsule. The path and access
rules of that capsule are machine-tested against the real source in `userland/fs_proofs/`.

## Sources

The block layer is `src/hardware/block_device/` over the driver capsules under `src/hardware/`. The
in-kernel filesystem is `src/fs/ramfs/`, the dispatcher and paths are `src/fs/vfs/`, `src/fs/fd/`, and
`src/fs/path/`, and the on-disk store is `src/fs/blockfs/` with `src/fs/cryptoblock/`. The IPC
filesystem is `src/fs/ramfs_capsule/` and `src/fs/vfs_capsule/` with the userland source in
`userland/capsule_vfs/`, and the verification is `userland/fs_proofs/`. Every page is verified against
those trees with `file:line` references.
