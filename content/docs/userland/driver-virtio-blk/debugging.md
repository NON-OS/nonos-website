---
title: "Debugging capsule_driver_virtio_blk"
description: "This page lists the log markers the driver and its boot path emit, and the concrete failure modes with where to look for each."
weight: 5
---
This page lists the log markers the driver and its boot path emit, and the concrete failure modes with
where to look for each. For the client protocol see the [client](/docs/userland/driver-virtio-blk/client/) page, for the device side the
[bring-up](/docs/userland/driver-virtio-blk/bringup/) page, and for the request engine the [queue](/docs/userland/driver-virtio-blk/queue/) page.

## Log markers

The first thing to confirm is that the capsule ran. On a successful boot the kernel logs
`[DRIVER-VIRTIO-BLK] capsule spawned`: the boot path names the driver, calls
`spawn_driver_virtio_blk_capsule`, and the `Ok` arm logs `boot_log::ok(prefix, "capsule spawned")`
([`src/userspace/init/spawn_plan/drivers_virtio_io.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_virtio_io.rs#L39), [`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). If
that line is absent the capsule never started, and the `Err` arm logged the failure through
`boot_log::error` instead ([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)), which is the usual signature,
manifest, or capability failure.

The load-error debug tag baked into the spawn spec is `[DRIVER-VIRTIO-BLK] load_elf_executable error:`, so
an ELF or mapping failure surfaces under that prefix ([`src/hardware/virtio_blk_capsule/spawn.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/virtio_blk_capsule/spawn.rs)).

## Failure modes

### Bring-up never completes

`_start` retries `setup::run` forever, yielding 64 times between attempts, so a driver that spawned but
serves nothing is stuck in bring-up ([`src/main.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L34)). The usual causes are broker refusals: the claim is
already taken by another instance, or the device is not in the broker table at all. The broker narrates each
on the console, and a `NONOS_DEVICE_CENSUS=1` build renders the device table so you can confirm the device
is present before any driver runs ([claim](/docs/subsystems/hardware-broker/claim/)). A DMA refusal prints
a `[DMA]` line naming the failed check ([dma](/docs/subsystems/hardware-broker/dma/)). If discovery itself
finds nothing, `setup::run` returns `no virtio-blk device`; note that a device with no interrupt pin or an
unrouted line (`irq_line == 0xFF`) is skipped during discovery, so a present-but-unrouted device looks the
same as an absent one ([`src/setup/sequence.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L24), [`src/discover.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L37)).

### Bring-up aborts on negotiation

`bring_up` returns a specific string for each virtio failure: `virtio-blk: features-ok rejected`,
`virtio-blk: requestq missing`, or `virtio-blk: unsupported requestq size` ([`src/init.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L39),
[`src/init.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L45), [`src/init.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L49)). On these paths the driver has already set the device's `FAILED` status
bit. `features-ok rejected` means the device cleared `FEATURES_OK` after the driver set it, usually a
feature-set mismatch; `requestq missing` means queue 0 reported size 0; `unsupported requestq size` means
the queue size was below 3 or above the 256 the driver supports. After a clean handshake, `setup::run`
returns `virtio-blk: zero capacity` if the config capacity register read back zero, which points at the
device model rather than the driver ([`src/setup/sequence.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L52)).

### A request returns an error status

The status word in the reply is the diagnosis ([`src/protocol/errno.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L16)).

- `E_MSGSIZE` (-90): the body length or `payload_len` did not match the declared sector count. Read requires
  a 12-byte body with `payload_len` exactly 12; write requires the body and `payload_len` to be exactly
  `12 + nsectors * 512` ([`src/server/handlers/read/request.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read/request.rs#L33), [`src/server/handlers/write/request.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/write/request.rs#L42)).
- `E_INVAL` (-22): a bad opcode, a header that failed to decode, a zero or over-64 sector count, or a device
  that reported the request unsupported ([`src/server/runner.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L51), [`src/server/handlers/read/request.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read/request.rs#L38),
  [`src/server/handlers/flush.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/flush.rs#L25)).
- `E_NXIO` (-6): the `lba + nsectors` range ran past the probed capacity, or the addition overflowed
  ([`src/server/handlers/read/request.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read/request.rs#L41)).
- `E_IO` (-5): the device reported an I/O error, or the completion wait failed
  ([`src/io/submit.rs:59`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/io/submit.rs#L59), [`src/server/handlers/read/handle.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read/handle.rs#L45)).

### A request hangs

`submit` gives up with `Timeout` after `MAX_YIELDS` = 200000 yields waiting for the used ring index to reach
the target or the interrupt sequence to change ([`src/io/submit.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/io/submit.rs#L44)). A `Timeout` surfaces to the handler
as an `E_IO` reply, but a persistent hang before any reply points at the IRQ binding or the device not
completing rather than at request parsing. The wait polls both the used ring and the interrupt sequence, so
a completion is caught even if the interrupt was coalesced or missed; a hang means neither advanced
([`src/io/submit.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/io/submit.rs#L40)).

### A reply is truncated or wrong-sized

The payload-carrying replies send an exact length, not the whole buffer: capacity sends
`RESP_HDR_LEN + STATUS_LEN + CAPACITY_PAYLOAD_LEN` and read sends `RESP_HDR_LEN + STATUS_LEN + bytes_n`
([`src/server/handlers/capacity.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/capacity.rs#L29), [`src/server/handlers/read/reply.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/read/reply.rs#L28)). If a read reply looks short,
confirm the request's `nsectors` against the bytes returned; the reply length is a direct function of it.
The read copy is bounded to the DMA buffer through `queue.data`, so a mismatch is a request-size issue, not
an overrun ([`src/queue/used.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L27)).

## Source map

```
  src/userspace/init/spawn_plan/drivers_virtio_io.rs   the driver spawn entry and boot marker
  src/userspace/init/capsule_boot/run.rs               [DRIVER-VIRTIO-BLK] capsule spawned / error path
  src/main.rs                         the forever-retry bring-up loop
  src/discover.rs                     the irq-pin/line skip during discovery
  src/setup/sequence.rs               no virtio-blk device / zero capacity
  src/init.rs                         the three negotiation failure strings
  src/protocol/errno.rs               the reply error codes
  src/server/runner.rs                the unknown-opcode E_INVAL
  src/server/handlers/read/request.rs the read bounds checks
  src/server/handlers/write/request.rs the write bounds checks
  src/server/handlers/flush.rs        the flush unsupported mapping
  src/io/submit.rs                    the Timeout and the status-to-error mapping
  src/queue/used.rs                   the bounded data slice
```

Every reference above is verified against those trees.
