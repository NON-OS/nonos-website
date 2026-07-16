---
title: "Debugging capsule_driver_virtio_rng"
description: "This page lists the boot marker the driver's spawn path emits, the early-exit codes the capsule uses when bring-up fails, the broker phases a stall can sit in, and how to read t..."
weight: 6
---
This page lists the boot marker the driver's spawn path emits, the early-exit codes the capsule uses when
bring-up fails, the broker phases a stall can sit in, and how to read the wire error codes. For what the
driver does and how it is put together, read the [overview](/docs/userland/driver-virtio-rng/), the [operations](/docs/userland/driver-virtio-rng/operations/), the
[hardware bring-up](/docs/userland/driver-virtio-rng/hardware/), and the [request queue](/docs/userland/driver-virtio-rng/queue/) pages in this folder.

## Boot marker

The first thing to confirm is that the capsule was spawned. On a successful spawn the kernel logs
`[DRIVER-VIRTIO-RNG] capsule spawned`. The prefix `DRIVER-VIRTIO-RNG` is passed from the driver's spawn plan
entry ([`src/userspace/init/spawn_plan/drivers_virtio_io.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_virtio_io.rs#L26)), and the `capsule spawned` suffix is emitted
by the shared capsule boot path on the `Ok` arm through `boot_log::ok(prefix, "capsule spawned")`
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). If that line is absent the capsule never spawned, and the
`Err` arm logged an error line through `boot_log::error` instead ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)),
which is the usual signature, manifest, or capability failure caught by verified spawn before the ELF is ever
mapped.

The spawn plan only runs the entry at all when the driver feature is compiled in. `spawn_rng` is gated on
`nonos-capsule-driver-virtio-rng`; without it the function is an empty stub and no marker appears because the
driver was never in the image ([`src/userspace/init/spawn_plan/drivers_virtio_io.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_virtio_io.rs#L22), `drivers_virtio_io.rs:32`).
The `-prod` image target sets the matching kernel feature `microkernel-driver-virtio-rng`
(`Makefile:935`), and the QEMU line attaches the backing device with `-device virtio-rng-pci`
(`Makefile:280`). A spawned capsule with no device to claim is a distinct case, covered below.

The kernel-side spawn also carries its own load-error tag, `[DRIVER-VIRTIO-RNG] load_elf_executable error:`,
which the verified spawn path prints if the ELF itself fails to load after the trust checks pass
([`src/hardware/virtio_rng_capsule/spawn.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_rng_capsule/spawn.rs#L59)).

## Early-exit codes

The boot marker means the process started; it does not mean the device came up. Inside the capsule, `_start`
brings the hardware up before it serves anything, and it exits the process with a small integer code if
bring-up cannot be completed ([`src/main.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L35)). The codes are worth reading directly:

```
  exit 1   heap_init failed                                        main.rs:37
  exit 3   the sanity fill returned Err (device never completed)   main.rs:66
  exit 4   the sanity fill returned all-zero bytes                 main.rs:62
```

Exit 1 is a heap failure and means the process could not even set up its allocator. Exit 3 and exit 4 are the
fail-closed posture in action: after the whole broker chain succeeds, the capsule runs one sanity fill and
refuses to serve if the device did not complete it (exit 3) or if every byte it returned was zero (exit 4)
([`src/main.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L51), `main.rs:60`, `main.rs:65`). In both cases the capsule releases every grant before exiting,
so a failed bring-up leaves the broker with a clean slate rather than a half-claimed device
([`src/main.rs:61`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L61), `main.rs:67`). There is no software fallback that fabricates entropy; a device that cannot
be brought up means no service, by design (see the [overview](/docs/userland/driver-virtio-rng/)).

Setup itself does not exit. `_start` loops on `setup::run`, and on any `Err` it yields 64 times and retries
rather than giving up ([`src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L40), `main.rs:44`). So a capsule that spawned but whose device is absent
or held by another claimant will spin in that retry loop, never reaching the sanity fill and never printing an
exit. The symptom is a spawned marker with the service never becoming answerable.

## Broker-phase stalls

When `setup::run` keeps returning `Err`, the phase it fails in narrows the cause. The chain runs in a fixed
order and each phase returns a distinct error string ([`src/setup/sequence.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L26)):

```
  no virtio-rng device       discover found no vendor 0x1AF4 / device 0x1005 or 0x1044 match   sequence.rs:27
  claim refused              mk_device_claim failed; another capsule already holds the device   claim.rs
  register grant failed      the BAR could not be mapped by MMIO or PIO                          registers/grant.rs
  irq bind failed            neither legacy INTx nor MSI-X vector 1 could be bound               irq.rs
  dma map failed (queue)     the two-page virtqueue region could not be mapped                   dma.rs:42
  dma map failed (buffer)    the one-page entropy buffer could not be mapped                     dma.rs:61
  virtio handshake failed    features-ok rejected, or the device advertised no requestq          init.rs:46
```

The discovery miss (`no virtio-rng device`) is the common one and usually means the backing device was not
attached to the VM: check the `-device virtio-rng-pci` line is present (`Makefile:280`). A discovery match
needs a vendor of `0x1AF4`, a device id of `0x1005` or `0x1044`, an interrupt pin and a usable line, and at
least one MMIO or PIO register BAR; a device missing any of these is dropped from the match (see the discovery
section of [hardware bring-up](/docs/userland/driver-virtio-rng/hardware/)). A claim refusal means another capsule holds the device. The
handshake failures come from the device rejecting `FEATURES_OK` or advertising a zero-size requestq, at which
point the capsule writes the `FAILED` status bit and refuses to drive it ([`src/init.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L44), `init.rs:51`).

Because every failing phase rolls back every earlier grant in reverse order before it returns, a stall never
leaves the broker holding a partial setup, and the next retry starts from a clean claim ([`src/setup/dma.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L57),
[`src/setup/registers/grant_mmio.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/registers/grant_mmio.rs)).

## A fill that hangs or fails

Once the service is up, a fill is one virtqueue round trip. Two outcomes surface as errors rather than hangs.

A device that never posts a completion is bounded, not infinite. `fill` spins on the used-idx and the
interrupt sequence, yielding the CPU each iteration, and after `MAX_YIELDS = 100000` yields with neither
signal it returns `Err("virtio-rng: device did not respond")` ([`src/fill.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fill.rs#L23), `fill.rs:43`). The fill
handler turns that into the wire status `E_IO` ([`src/server/handlers/fill.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/fill.rs#L40)). So a wedged device shows up
as an `E_IO` reply, not a caller left waiting forever (see the wait detail in [request queue](/docs/userland/driver-virtio-rng/queue/)).

A caller that asks for zero bytes or more than the 4096 ceiling is refused before the device is touched, with
`E_MSGSIZE` ([`src/server/handlers/fill.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/fill.rs#L33)).

## Reading the wire error codes

Every reply carries an `i32` status in the first four bytes of its payload; zero is success. Three non-zero
codes are defined, mirroring Linux errnos so the kernel client can route them through the same mapper it uses
for the other capsules ([`src/protocol/errno.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L18)):

```
  E_INVAL    -22   malformed envelope, or an unknown op         errno.rs:22
  E_IO        -5   the device did not complete the fill         errno.rs:23
  E_MSGSIZE  -90   a fill request of zero or over 4096 bytes    errno.rs:24
```

`E_INVAL` points at the envelope: a buffer shorter than the 20-byte header, a wrong magic, a wrong version, or
an op the runner does not recognise ([`src/protocol/decode.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs), [`src/server/runner.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L54)). A malformed
envelope is still answered, through a synthetic zero-valued request, so a bad frame never leaves the caller
waiting on a reply that never comes ([`src/server/error.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error.rs#L33), [`src/server/runner.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L47)). `E_IO` is a device
that did not complete a fill within the bounded wait. `E_MSGSIZE` is a request size outside `(0, 4096]`. A
distinct way to separate a dead service from a device fault is the healthcheck op: reaching it proves the
decoder and runner are live even when a fill is failing, which is exactly why the kernel client probes it
before a real fill (see [operations](/docs/userland/driver-virtio-rng/operations/)).

## Source map

```
  src/userspace/init/spawn_plan/drivers_virtio_io.rs   the DRIVER-VIRTIO-RNG spawn entry and feature gate
  src/userspace/init/capsule_boot/run.rs               boot_log::ok "capsule spawned" / error path
  src/hardware/virtio_rng_capsule/spawn.rs             the load-error debug tag
  userland/capsule_driver_virtio_rng/src/main.rs       exit 1/3/4 and the setup retry loop
  userland/capsule_driver_virtio_rng/src/setup/sequence.rs   the ordered chain and its per-phase errors
  userland/capsule_driver_virtio_rng/src/setup/dma.rs        the two dma-map failure strings and rollback
  userland/capsule_driver_virtio_rng/src/init.rs             features-ok and requestq handshake failures
  userland/capsule_driver_virtio_rng/src/fill.rs             the bounded wait and its Err string
  userland/capsule_driver_virtio_rng/src/server/handlers/fill.rs   E_MSGSIZE and E_IO on the wire
  userland/capsule_driver_virtio_rng/src/protocol/errno.rs   E_INVAL, E_IO, E_MSGSIZE
  Makefile                                             the -prod feature and the QEMU virtio-rng device line
```

Every reference above is verified against those trees.
</content>
