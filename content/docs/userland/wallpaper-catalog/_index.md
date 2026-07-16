---
title: "The Wallpaper Catalog Capsule"
description: "The wallpaper catalog is the read-only asset vendor for the built-in wallpaper images."
weight: 400
---
The wallpaper catalog is the read-only asset vendor for the built-in wallpaper images. It reports how
many images exist, each image's slug and byte length, and streams the image bytes back in bounded chunks
so a large JPEG never has to travel in one oversized message. It holds no per-caller state and touches no
hardware: every image is compiled into the capsule binary, so the catalog owns its data and needs no
storage device. It is the source the [wallpaper](/docs/userland/wallpaper/) capsule fetches from.

This is a small capsule, so the documentation is a hub and a single pillar page: the protocol and catalog
page beside the two folders that carry the real work, plus a contributing and a debugging page.

## Identity

| Field | Value | Source |
|-------|-------|--------|
| Slug | `wallpaper_catalog` | `userland/capsule_wallpaper_catalog/Capsule.mk:4` |
| Service handle | `wallpaper_catalog` | `Capsule.mk:5` |
| Service endpoint | `service:4110:wallpaper_catalog` | `Capsule.mk:11` |
| Reply endpoint | `reply:4111:endpoint.wallpaper_catalog.reply` | `Capsule.mk:12` |
| Capability mask | `0x19` | `Capsule.mk:15` |

The service name and port are also fixed in the source: `SERVICE_NAME` is `wallpaper_catalog`
([`src/bootstrap/service_name.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bootstrap/service_name.rs#L17)) and `SERVICE_PORT` is `4110` ([`src/bootstrap/port.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bootstrap/port.rs#L17)).

The mask decomposes into three bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|-----|-------|--------|
| CoreExec | `0x01` | run as a process |
| IPC | `0x08` | send and receive on its endpoints |
| Memory | `0x10` | map its own heap and stack |

`0x01 | 0x08 | 0x10 = 0x19`, exactly as the `Capsule.mk` comment states (`Capsule.mk:14`). The catalog
requests no PCI, MMIO, IRQ, DMA, PIO, filesystem, network, display, or focus-routing grant. It never
picks a wallpaper and never writes anything; it only answers the image a caller asks for by index. A
compromised catalog yields its mask and nothing more, and since the images are public background art
there is nothing to leak.

## Code map

The source under `userland/capsule_wallpaper_catalog/src/` is a handful of top-level modules. `main.rs`
wires them together; `bootstrap/` registers the service; `server/` runs the receive loop, dispatches by
op code, and frames replies; `protocol/` defines the wire header, ops, errnos, and limits; `catalog/`
holds the four embedded image groups and the accessors over them. The two that carry the real behaviour,
the request protocol and the catalog structure, share one page.

```
  request  ->  server/  ->  protocol/  ->  catalog/  ->  reply
  in           poll and    header and     count, size,   out
               dispatch    op codes       slug, bytes
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [protocol.md](/docs/userland/wallpaper-catalog/protocol/) | `src/server/`, `src/protocol/`, `src/catalog/` | The wire header, the four operations and their exact codes, reply framing, the errno set, and the four embedded image groups with the disk-versus-served discrepancy. |
| [contributing.md](/docs/userland/wallpaper-catalog/contributing/) | the whole tree | Where the source lives, how to add a wallpaper, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/wallpaper-catalog/debugging/) | runtime | The exit codes, the failure modes, and where to look when the desktop comes up with a blank or wrong background. |

## Lifecycle

The catalog is spawned through [verified spawn](/docs/security/capsules-and-trust/): its signature and
attestation are checked, its requested capabilities are held against its manifest ceiling, and only then
is its ELF mapped. `_start` ([`src/main.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L30)) initializes the heap, then calls `bootstrap::register`
([`src/bootstrap/register.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bootstrap/register.rs#L21)), which invokes `mk_service_register` with the name, its length, and the
port. A heap failure exits with code 1; a failed registration exits with code 2 ([`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31),
[`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35)). On success it enters `server::run(SERVICE_PORT)` ([`src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L37)), a poll-yield loop
that never returns.

Nothing is loaded at startup. The catalog is four static slices of `Entry`, each an embedded slug and an
`include_bytes!` of a JPEG under `nonos-data/wallpapers/`, so the images are already in the binary by the
time `_start` runs. The [protocol](/docs/userland/wallpaper-catalog/protocol/) page covers the groups and the flat index across them.

## Source map

```
  userland/capsule_wallpaper_catalog/src/main.rs               heap, register, run; exit 1 and 2
  userland/capsule_wallpaper_catalog/src/bootstrap/            service name, port 4110, register
  userland/capsule_wallpaper_catalog/src/server/              poll/decode/dispatch loop and reply framing
  userland/capsule_wallpaper_catalog/src/protocol/            header, ops, errnos, limits
  userland/capsule_wallpaper_catalog/src/catalog/             count/size/slug/bytes accessors and the groups
  userland/capsule_wallpaper_catalog/Capsule.mk               slug, endpoints, caps 0x19, asset deps
  src/capabilities/types.rs                                   the capability bits
  src/userspace/capsule_wallpaper_catalog/                    the kernel spawn mirror
```

Every reference above is verified against those trees.
