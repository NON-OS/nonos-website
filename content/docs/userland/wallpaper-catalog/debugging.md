---
title: "Debugging capsule_wallpaper_catalog"
description: "This page lists the markers the catalog and its boot path emit, and the concrete failure modes with where to look for each."
weight: 4
---
This page lists the markers the catalog and its boot path emit, and the concrete failure modes with where
to look for each. For the wire protocol and the catalog layout see the [README](/docs/userland/wallpaper-catalog/) and the
[protocol and catalog](/docs/userland/wallpaper-catalog/protocol/) page; for how to add an image see the [contributing](/docs/userland/wallpaper-catalog/contributing/)
page.

## Boot marker and exit codes

The catalog is spawned by the desktop fleet plan ([`src/userspace/init/spawn_plan/desktop_fleet.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_fleet.rs#L59))
with the prefix `WALLPAPER-CATALOG`. On a successful spawn the kernel logs
`[WALLPAPER-CATALOG] capsule spawned` from the capsule boot path: the `Ok` arm calls
`boot_log::ok(prefix, "capsule spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). If that line is
absent the capsule never started, and the `Err` arm logged an error line through `boot_log::error`
instead ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)), which is the usual signature, manifest, or
capability failure.

The capsule also fails itself early with two exit codes before the loop begins. Exit code 1 means
`heap_init` failed ([`src/main.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L31)). Exit code 2 means `bootstrap::register` returned false, that is,
`mk_service_register` did not return 0 ([`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35), [`src/bootstrap/register.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bootstrap/register.rs#L22)). Either exit
means the service `wallpaper_catalog` on port 4110 never came up, so a client's `mk_service_lookup` for
it returns nothing.

## Failure modes

The catalog is a leaf service. When the desktop comes up with a blank or fallback background, walk the
chain from the catalog outward.

### The service does not resolve

Confirm the service is registered. The name is `wallpaper_catalog` on port 4110
([`src/bootstrap/service_name.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bootstrap/service_name.rs#L17), [`src/bootstrap/port.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/bootstrap/port.rs#L17)). If registration failed, the capsule
exited with code 2 before the loop, so the service will not resolve through `mk_service_lookup` and the
wallpaper client's `lookup_catalog` returns `None`
([`userland/capsule_wallpaper/src/catalog_client/lookup.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/catalog_client/lookup.rs#L23), `lookup.rs:32`).

### Every image lookup fails with an index mismatch

If the client gets a count but every image fails, suspect an index mismatch. The policy default is 52
([`userland/capsule_policy/src/store/defaults/store.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/store/defaults/store.rs#L45)); if the catalog were rebuilt with fewer than
53 entries, that index would be out of range and `OP_GET_SIZE` would answer `E_NOT_FOUND`. Cross-check the
served count from `OP_GET_COUNT` against the policy value: the count is the saturating sum of the group
lengths ([`src/catalog/count.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/count.rs#L19)), currently 62.

### A large image arrives truncated

The fault is usually in the client's chunk loop, not the server. The server returns exactly
`min(offset + 4096, len) - offset` bytes and expects the client to advance `offset` by the reply's
`payload_len` ([`src/server/handlers/op_get_chunk.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/op_get_chunk.rs#L31)). The wallpaper client aborts if the running
total ever exceeds the declared size or if the reassembled length does not match the size
([`userland/capsule_wallpaper/src/catalog_client/fetch_image.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_wallpaper/src/catalog_client/fetch_image.rs#L26)), so a truncated result means a
dropped or reordered reply between the two, not a short read on the server.

### Reading the errno on a reply

The `status` field in the reply header tells the client what went wrong.

- `E_RANGE` (93) on a chunk means the client asked for an offset strictly past the image end
  (`op_get_chunk.rs:28`). An `offset` exactly equal to the length is legal and returns an empty body,
  which is the end-of-image signal, not an error.
- `E_NOT_FOUND` (91) on size, slug, or chunk means the index is out of the `0..count` range: the accessor
  returned `None` ([`src/catalog/entries/entry_at.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/catalog/entries/entry_at.rs#L28)).
- `E_INVAL` (22) means the op code was not one of the four, so the dispatch fell to the default arm
  ([`src/server/runner.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L45)). Check the header's `op` field encoding, remembering the header is
  little-endian ([`src/protocol/hdr.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/hdr.rs#L29)). Note that the capsule's source `README.md` calls this
  `E_BAD_OP`, a name that does not exist in `errno.rs`; the code you will see on the wire is `E_INVAL`.
- `E_BAD_LEN` (90) comes only from the reply path when a payload would exceed the buffer
  ([`src/server/respond/ok.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond/ok.rs#L25)); a client should never provoke it, since the largest reply is one 4096-
  byte chunk plus the 16-byte header, well under `IPC_PAYLOAD_MAX`.

### Confirming which image an index maps to

To confirm which image an index resolves to without decoding the JPEG, request `OP_GET_SLUG` for that
index and match the returned bytes against the group tables on the [protocol and catalog](/docs/userland/wallpaper-catalog/protocol/)
page. Remember the `network-topology` group skips 12 and `special-variant-6` embeds the `-1080p` file, so
a slug can look off by one against the disk filenames.

## Source map

```
  src/userspace/init/spawn_plan/desktop_fleet.rs                       WALLPAPER-CATALOG prefix, spawn
  src/userspace/init/capsule_boot/run.rs                               [WALLPAPER-CATALOG] capsule spawned / error
  userland/capsule_wallpaper_catalog/src/main.rs                       exit 1 heap, exit 2 register
  userland/capsule_wallpaper_catalog/src/bootstrap/                    service name, port 4110, register
  userland/capsule_wallpaper_catalog/src/server/runner.rs              dispatch, E_INVAL on unknown op
  userland/capsule_wallpaper_catalog/src/server/handlers/op_get_chunk.rs  E_RANGE and the chunk math
  userland/capsule_wallpaper_catalog/src/catalog/count.rs              the served count
  userland/capsule_wallpaper_catalog/src/catalog/entries/entry_at.rs   None for an out-of-range index
  userland/capsule_wallpaper_catalog/src/protocol/errno.rs             the errno constants
  userland/capsule_wallpaper/src/catalog_client/lookup.rs              lookup that returns None on failure
  userland/capsule_wallpaper/src/catalog_client/fetch_image.rs         the client chunk loop
  userland/capsule_policy/src/store/defaults/store.rs                  default selection index 52
```

Every reference above is verified against those trees.
