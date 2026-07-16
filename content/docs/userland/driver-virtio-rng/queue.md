---
title: "The request virtqueue"
description: "Once the device is up (claimed, mapped, negotiated, DRIVEROK), every byte the capsule serves comes through a single split virtqueue."
weight: 4
---
Once the device is up (claimed, mapped, negotiated, `DRIVER_OK`), every byte the capsule serves comes
through a single split virtqueue. This page covers the ring layout under `src/queue/`, how a fill posts one
descriptor and notifies the device, how it waits for completion, and the DMA buffer the device writes into.
For the bring-up that allocates the two DMA regions and programs the queue PFN see the
[hardware bring-up](/docs/userland/driver-virtio-rng/hardware/); for the IPC op that drives a fill see [operations](/docs/userland/driver-virtio-rng/operations/); for the
identity and mask see the [overview](/docs/userland/driver-virtio-rng/).

virtio-rng needs exactly one virtqueue and, in this driver, exactly one descriptor in flight at a time. The
device fills the buffer that descriptor 0 points at and posts the used ring with a byte count. There is no
descriptor chaining and no batching: the server loop holds one request in flight, so the queue never has to
track more than a single outstanding slot.

## The region and its layout

The queue lives in the two-page DMA region the broker granted at setup (`VQ_REGION_SIZE = 8192`,
[`src/constants/queue.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L27)). The legacy virtio-pci transport mandates one physically contiguous region with
the used ring page-aligned, which is the whole reason the region is two pages rather than one
([`src/queue/layout.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/layout.rs#L17)). The three virtqueue structures sit at fixed offsets inside it:

```
  page 0, offset 0      descriptor table   VQ_DESC_OFFSET = 0       queue.rs:25
  page 0, after desc    available ring     avail_offset (computed)  layout.rs:50
  page 1, offset 4096   used ring          VQ_USED_OFFSET = 4096    queue.rs:26
```

The descriptor table starts at offset 0. The available ring follows it, at `queue_size * 16` bytes past the
base, because each descriptor is 16 bytes and the ring begins right after the last descriptor; `Queue::new`
computes `avail_offset = queue_size as usize * DESC_BYTES` with `DESC_BYTES = 16` and stores it so the post
path never recomputes it ([`src/queue/layout.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/layout.rs#L43), `layout.rs:50`). The negotiated queue size is `QUEUE_SIZE
= 16`, the hint the capsule passes into the handshake, clamped down to whatever the device advertises
([`src/constants/queue.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L22), [`src/init.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init.rs#L55)). The used ring sits on the second page at `VQ_USED_OFFSET =
4096`, the page-aligned offset the legacy layout requires ([`src/constants/queue.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L26)).

The `Queue` struct is the shared handle every phase reads. It carries the region virtual and physical
addresses, the entropy buffer virtual and physical addresses, the buffer length, the precomputed
`avail_offset`, and a `last_used` counter ([`src/queue/layout.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/layout.rs#L24)). It is `Copy` so the post and used paths
can take it by value rather than borrowing the outer `Driver`, which keeps the fill path free of aliasing on
the driver state ([`src/queue/layout.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/layout.rs#L18)).

## Posting a descriptor

`post_request` writes a single descriptor and publishes it into the available ring
([`src/queue/post.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post.rs#L39)). A legacy `VirtqDesc` is sixteen bytes: a `u64` device address, a `u32` length, a
`u16` flags word, and a `u16` next index. The post writes descriptor 0 at the descriptor base
(`region_va + VQ_DESC_OFFSET`):

```
  desc[0].addr  = buf_phys                 the device-visible physical address of the buffer   post.rs:43
  desc[0].len   = buf_len                  4096, the whole entropy page                        post.rs:44
  desc[0].flags = VRING_DESC_F_WRITE (2)   device-writable: the device fills, does not read     post.rs:45
  desc[0].next  = 0                         no chaining; single-descriptor request              post.rs:46
```

The address the device sees is `buf_phys`, the device-visible physical address the broker returned from the
buffer DMA map, not the capsule's own virtual address ([`src/queue/post.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post.rs#L43), [`src/setup/sequence.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L45)).
The `VRING_DESC_F_WRITE` flag (`= 2`) marks the descriptor device-writable, which is correct for an entropy
source: the device writes the page, the capsule reads it ([`src/constants/queue.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L23), [`src/queue/post.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post.rs#L45)).

Publishing is a two-step write that respects the ring's publication contract. A legacy `VirtqAvail` is a
`u16` flags word, a `u16` idx, then the `ring[]` of slot indices. The post writes slot 0 of the ring to point
at descriptor 0 (`avail.ring[0] = 0`, at `avail_offset + 4`, reached as `avail.add(2)` in `u16` units), then
increments `avail.idx` ([`src/queue/post.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post.rs#L52), `post.rs:55`). The idx bump happens after the ring slot is
written, so the device never observes a partial ring update: it either sees the old idx and no new work, or
the new idx with the ring slot already valid ([`src/queue/post.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post.rs#L54)). Every access is a `write_volatile` so
the compiler cannot reorder or drop the stores the device depends on ([`src/queue/post.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/post.rs#L40)).

## Notify and wait

With the descriptor published, `fill` pokes the queue-notify register and then waits for the device to post a
completion ([`src/fill.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fill.rs#L25)). The notify is a 16-bit write of the queue index (0) to `LEG_QUEUE_NOTIFY`
(offset `0x10`), which tells the device there is new work in queue 0 ([`src/fill.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fill.rs#L28),
[`src/constants/regs.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/regs.rs#L25)). The write goes through the same `Regs` accessor that hides MMIO versus PIO, so
the notify is transport-uniform ([`src/regs/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/regs/state.rs)).

The wait is a bounded spin that watches two independent completion signals and yields the CPU between checks
([`src/fill.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fill.rs#L35)):

```
  target = last_used + 1                                     the used idx we expect after this request
  prev_seq = irq poll seq                                    the interrupt sequence before we wait
  loop:
      if used_idx() == target:            break              the device advanced the used ring
      if irq poll seq != prev_seq:        break              the device raised its interrupt
      if tries >= MAX_YIELDS (100000):    return Err         the device never responded
      mk_yield(); tries += 1
```

`used_idx` reads the `idx` field of the used ring (`VQ_USED_OFFSET + 2`), and completion is when it reaches
`last_used + 1` ([`src/queue/used.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L36), [`src/fill.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fill.rs#L32), `fill.rs:36`). The loop also breaks if the
interrupt sequence changes: `read_seq` calls `mk_irq_poll` on the bound grant and compares the returned `seq`
to the value sampled before the wait, so a device that raises its IRQ wakes the wait even if the used-idx read
races ([`src/fill.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fill.rs#L39), `fill.rs:54`). Either signal is sufficient; the driver does not depend on the
interrupt firing, which is why a platform whose GSI is unrouted still completes a fill (see the INTx-then-MSI-X
fallback in [hardware bring-up](/docs/userland/driver-virtio-rng/hardware/)).

The spin is bounded. After `MAX_YIELDS = 100000` yields with neither signal, `fill` returns
`Err("virtio-rng: device did not respond")`, which the fill handler turns into `E_IO` on the wire
([`src/fill.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fill.rs#L23), `fill.rs:43`, [`src/server/handlers/fill.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/fill.rs#L40)). There is no unbounded wait and no busy
loop without a yield: `mk_yield` hands the CPU back on every iteration so a stuck device cannot monopolise the
core ([`src/fill.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fill.rs#L45)).

On completion the capsule records the new `last_used`, reads the byte count the device wrote, and acknowledges
the interrupt so the source is unmasked for the next request ([`src/fill.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fill.rs#L48), `fill.rs:50`). The
acknowledged count is `used_len`, the `len` field of used-elem 0 (`VQ_USED_OFFSET + 4 + 4`)
([`src/queue/used.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L42)).

## The DMA buffer

The entropy buffer is a separate one-page DMA grant, distinct from the queue region. Its length is
`ENTROPY_BUF_LEN = 4096`, one page, which is also the fill ceiling on the wire so a single request can never
ask for more than the buffer holds ([`src/constants/queue.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/queue.rs#L29), [`src/protocol/limits.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs)). `Queue` holds both
the buffer's user virtual address (`buf_va`, for the capsule's own reads) and its device-visible physical
address (`buf_phys`, the address written into the descriptor) ([`src/queue/layout.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/layout.rs#L27), `layout.rs:28`).

Reading the filled bytes goes through `Queue::buffer`, which is the one bounds check that stands between a
misbehaving device and an out-of-bounds read. It caps the slice length at `buf_len` regardless of what the
device reported, so a device that writes a `used_len` larger than the page cannot induce a read past the
grant ([`src/queue/used.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L55), `used.rs:56`). Its `# Safety` note requires that `len` be the value returned by
`used_len` for the most recent completion and that the caller not alias the buffer with a concurrent device
write; the single-threaded server loop guarantees the second condition, since no fill is in flight while the
handler copies the bytes out ([`src/queue/used.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/queue/used.rs#L51), [`src/server/handlers/fill.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/fill.rs#L48)).

The bytes never leave the capsule as raw device memory. The fill handler takes `min(want, n)` where `want` is
the caller's request and `n` is what the device wrote, copies exactly that many bytes out of the DMA buffer
into the response, and sends; a short device write yields fewer bytes rather than padding
([`src/server/handlers/fill.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/fill.rs#L44), `fill.rs:53`). The DMA page itself is never mapped to any caller; it stays
inside the capsule's grant, and only a copy crosses the IPC boundary.

## Source map

```
  userland/capsule_driver_virtio_rng/src/queue/layout.rs      Queue: region/buffer pointers, avail_offset, last_used
  userland/capsule_driver_virtio_rng/src/queue/post.rs        write descriptor 0, publish avail slot 0, bump idx
  userland/capsule_driver_virtio_rng/src/queue/used.rs        used_idx, used_len, bounded buffer() read
  userland/capsule_driver_virtio_rng/src/fill.rs              notify, dual-signal bounded wait, irq ack, byte count
  userland/capsule_driver_virtio_rng/src/constants/queue.rs   QUEUE_SIZE, ring offsets, VQ_REGION_SIZE, ENTROPY_BUF_LEN
  userland/capsule_driver_virtio_rng/src/constants/regs.rs    LEG_QUEUE_NOTIFY and the other legacy offsets
  userland/capsule_driver_virtio_rng/src/setup/sequence.rs    where buf_dma.device_addr reaches Queue::new
  userland/capsule_driver_virtio_rng/src/server/handlers/fill.rs   the copy-out and short-write bound
```

Every reference above is verified against those trees.
</content>
</invoke>
