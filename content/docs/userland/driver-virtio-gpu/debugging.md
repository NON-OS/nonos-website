---
title: "Debugging capsule_driver_virtio_gpu"
description: "This page lists the boot marker the driver's spawn path emits and the concrete failure modes with where to look for each."
weight: 5
---
This page lists the boot marker the driver's spawn path emits and the concrete failure modes with where to
look for each. For the driver's identity see the [README](/docs/userland/driver-virtio-gpu/); for the bring-up sequence a failed
boot walks through see the [bring-up](/docs/userland/driver-virtio-gpu/bring-up/) page; for the ops that return the runtime `E_*` statuses
see the [client/protocol](/docs/userland/driver-virtio-gpu/client-protocol/) page.

## The boot marker

The one thing to confirm first is that the capsule spawned. On a successful boot the kernel logs

```
  [DRIVER-VIRTIO-GPU] capsule spawned
```

The spawn plan calls the boot helper with the prefix `DRIVER-VIRTIO-GPU`
([`src/userspace/init/spawn_plan/drivers_virtio_display.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_virtio_display.rs#L26)); the `Ok` arm calls `boot_log::ok(prefix,
"capsule spawned")`, which prints `[<prefix>] <msg>` to the serial line
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29), [`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). If that line is absent the
capsule never started, and the `Err` arm logged a spawn error through `boot_log::error` instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)), which is the usual signature, manifest, capability, or
attestation failure on the kernel side of the spawn.

The marker only fires when the feature is compiled in. `spawn_gpu` is gated behind
`nonos-capsule-driver-virtio-gpu`, so a kernel built without that feature never attempts the spawn and
logs nothing for the driver ([`src/userspace/init/spawn_plan/drivers_virtio_display.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_virtio_display.rs#L22)). The
`nonos-mk-driver-virtio-gpu-prod` image sets that feature (see the [contributing](/docs/userland/driver-virtio-gpu/contributing/) page).

Note that the marker confirms the kernel spawned the capsule, not that bring-up succeeded. The device-side
bring-up runs inside the capsule after spawn, and its outcome is not logged from the capsule itself, which
is the subject of the next section.

## Failure modes

### No display: bring-up never completes

`_start` runs the whole bring-up in a retry loop: it calls `setup::run()`, and on any `Err` it discards the
error string, yields 64 times, and tries again ([`src/main.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L39)). The error strings returned all through
`setup/` and `init/` are therefore never printed; a device that cannot be stood up spins in this loop
silently, and the driver never reaches `mk_service_register` ([`src/main.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L50)). The observable signature
is that `[DRIVER-VIRTIO-GPU] capsule spawned` is present but `driver.virtio_gpu0` never appears in the
service registry and the compositor's resolve of it never returns.

Where to look, in the order the sequence runs ([`src/setup/sequence.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L24)):

- Device not found. `find_virtio_gpu` matched no usable function: vendor `0x1AF4` with device id `0x1010`
  or `0x1050`, a real IRQ pin, and a line that is neither 0 nor `0xFF`
  ([`src/discover/match_device.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/match_device.rs#L21), [`src/setup/sequence.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L26)). A device present but with no usable IRQ
  line fails the usable check, not the vendor check.
- Broker grant denied. The claim, bus-master, register map, and queue DMA are each a broker syscall, and
  each phase rolls back the grants it already holds on failure ([`src/setup/claim.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L17),
  [`src/setup/pci.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L20), [`src/setup/mmio/map_mmio.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio/map_mmio.rs#L22), [`src/setup/dma.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L19)). The mmio and pio map
  errno is decoded to a specific label ([`src/setup/mmio/labels.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio/labels.rs#L18)), which is the string the failing
  attempt would carry.
- Virtio negotiation rejected. The modern path requires `VIRTIO_F_VERSION_1` and returns `virtio-gpu:
  modern feature missing` if the device does not offer it, `virtio-gpu: features rejected` if the device
  clears `FEATURES_OK`, and `virtio-gpu: missing control queue` on a zero-size queue
  ([`src/init/modern.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/modern.rs#L38), `:47`, `:53`); the legacy path returns the matching strings
  ([`src/init/legacy.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/legacy.rs#L34), `:40`).

Because none of these are logged, isolating which one fires means reading the sequence against the device
QEMU or the hardware presents; the [bring-up](/docs/userland/driver-virtio-gpu/bring-up/) page walks the same order in detail.

### Blank scanout: driver runs but there is no primary surface

Bring-up can succeed and still produce no primary surface. `geometry::derive` returns `Ok(None)` for a
scanout that is disabled or zero-width or zero-height, and `create_primary::create` propagates that as
`Ok(None)`, so `setup::run` returns a live `Driver` whose `primary` is `None`
([`src/setup/primary_surface/geometry.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/primary_surface/geometry.rs#L23), [`src/setup/primary_surface/create.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/primary_surface/create.rs#L33)). In that state the
service registers and answers IPC, but `OP_GET_PRIMARY_SURFACE` returns `E_DEVICE` because
`driver.primary` is `None` ([`src/server/handlers/get_primary_surface.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_primary_surface.rs#L23)). The compositor gets a live
driver it cannot draw to.

The scanout seed is where the geometry comes from. `scanouts::seed` issues `GET_DISPLAY_INFO`, promotes any
scanout smaller than 1280x720 to the 1920x1080 default, and seeds a single default scanout 0 if the device
reports none, so a device that reports at least one enabled scanout should not land here
([`src/setup/scanouts.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/scanouts.rs#L24), `:61`). If it does, the suspect is `GET_DISPLAY_INFO` returning all scanouts
disabled or zero-area, not the geometry math. The surface can also fail to register even with valid
geometry: `mk_surface_register` or `mk_surface_share` returning negative rolls back the DMA grant and
returns `virtio-gpu: surface register rejected` or `virtio-gpu: surface share rejected`, which sends
bring-up back into the retry loop rather than leaving a `None` primary
([`src/setup/primary_surface/create.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/primary_surface/create.rs#L49), `:54`).

### Resource errors: a command op is refused

Once the driver serves, a rejected command op surfaces as a negative status word in the reply, not a log
line. The codes are POSIX-style negatives ([`src/protocol/errno.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L16)), and each names a distinct cause:

- `E_INVAL -22`. A wrong body length, a bad field, a zero dimension, a wrong format, or an out-of-bounds
  rect. `create_resource` returns it on a wrong length and on a zero width or height or a format other
  than `VG_FORMAT_B8G8R8A8_UNORM` ([`src/server/handlers/create_resource.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/create_resource.rs#L25), `:45`); the rect-carrying
  ops return it when `x + width` or `y + height` exceeds the resource. `attach_backing` returns it when the
  requested address range falls outside the surface's own DMA region, which is the deliberate bounds
  rejection, not a bug.
- `E_BUSY -16`. The caller is not the owner of the resource. `GET_PRIMARY_SURFACE` makes the first caller
  the owner and returns `E_BUSY` to any other pid; every later command op re-checks `owner_pid ==
  sender_pid` ([`src/server/handlers/get_primary_surface.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_primary_surface.rs#L39)). A second capsule trying to drive a
  resource it does not own lands here, which is the isolation working, not a fault.
- `E_NOMEM -12`. The resource table is full. `create_resource` returns it when `insert` finds no free slot
  in the `MAX_RESOURCES` (64) array ([`src/server/handlers/create_resource.rs:67`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/create_resource.rs#L67),
  [`src/protocol/limits.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L29)).
- `E_DEVICE -110`. The device rejected the control command, or there is no primary surface.
  `create_resource` returns it when `create_resource_2d` does not get `RESP_OK_NODATA` from the device
  ([`src/server/handlers/create_resource.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/create_resource.rs#L51)), and `get_primary_surface` returns it when `driver.primary`
  is `None` (the blank-scanout case above). This is the code that points at the device or the queue rather
  than the request.
- `E_BAD_OP -38`. The opcode is unknown and the body was empty; an unknown opcode with a body is answered
  `E_INVAL` instead ([`src/server/runner/dispatch.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner/dispatch.rs#L53)).

To tell a client-side rejection from a device-side one, `E_INVAL` and `E_BUSY` are decided in the handler
before any device command runs, while `E_DEVICE` is only returned after the device answered wrong or a
primary is missing.

## Source map

```
  src/userspace/init/spawn_plan/drivers_virtio_display.rs   the DRIVER-VIRTIO-GPU prefix and feature gate
  src/userspace/init/capsule_boot/run.rs                    the ok/error boot-log arms
  src/sys/boot_log/output.rs                                the [<prefix>] <msg> serial format
  userland/capsule_driver_virtio_gpu/src/main.rs            the silent setup::run retry loop
  userland/capsule_driver_virtio_gpu/src/setup/sequence.rs  the bring-up order the no-display case walks
  userland/capsule_driver_virtio_gpu/src/discover/match_device.rs   the device match check
  userland/capsule_driver_virtio_gpu/src/init/modern.rs src/init/legacy.rs   the virtio negotiation errors
  userland/capsule_driver_virtio_gpu/src/setup/primary_surface/geometry.rs   the zero-area Ok(None) path
  userland/capsule_driver_virtio_gpu/src/setup/primary_surface/create.rs     the None primary and register rollback
  userland/capsule_driver_virtio_gpu/src/setup/scanouts.rs  the scanout seed, promote, and default
  userland/capsule_driver_virtio_gpu/src/server/handlers/   the handlers that return the E_* statuses
  userland/capsule_driver_virtio_gpu/src/protocol/errno.rs  the E_INVAL/E_NOMEM/E_BUSY/E_BAD_OP/E_DEVICE values
  userland/capsule_driver_virtio_gpu/src/server/runner/dispatch.rs   the unknown-op E_BAD_OP/E_INVAL fallthrough
```

Every reference above is verified against those trees.
