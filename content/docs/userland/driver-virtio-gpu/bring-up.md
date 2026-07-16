---
title: "Bring-up: discovery, broker grants, and the primary surface"
description: "This page mirrors the boot path of the capsule: src/discover/ finds the device, src/setup/ claims it through the broker and stands up every grant, and src/init/ runs the virtio ..."
weight: 1
---
This page mirrors the boot path of the capsule: `src/discover/` finds the device, `src/setup/` claims it
through the broker and stands up every grant, and `src/init/` runs the virtio negotiation. By the time
this pillar returns, the driver owns a live control queue and a primary framebuffer, and the
[client/protocol](/docs/userland/driver-virtio-gpu/client-protocol/) layer can start serving. For identity and the capability mask see the
[README](/docs/userland/driver-virtio-gpu/); for the virtqueue and control commands this path uses, see the [engine](/docs/userland/driver-virtio-gpu/engine/)
page.

`_start` runs this whole path in a retry loop: it calls `setup::run()`, and on `Err` it yields 64 times
and tries again, so a device that is not ready yet never panics the capsule
([`src/main.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L39)). `setup::run` is the ordered sequence ([`src/setup/sequence.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L24)).

## Discovery

`find_virtio_gpu` lists devices via `mk_device_list` and matches the first usable virtio-gpu function
([`src/discover/search.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/search.rs#L25)). A match is vendor `0x1AF4` on the PCI bus with device id `0x1010`
(transitional) or `0x1050` (modern), and usable additionally requires a real IRQ pin and a line that is
neither 0 nor `0xFF` ([`src/discover/match_device.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/match_device.rs#L21), `:27`, [`src/constants/mod.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L16)). The register
BAR is then selected: for the modern id the code prefers an MMIO BAR inside the `0x4000..0x10000` config
window, otherwise it takes the first MMIO BAR, otherwise the first PIO BAR ([`src/discover/bar_select.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/bar_select.rs#L24)).
The result is a `Found` record carrying the device id, PCI address, IRQ line, and chosen BAR
([`src/discover/found.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover/found.rs)).

## The broker grant quartet

Everything after discovery is a broker syscall, one per authority bit in the mask. The sequence claims the
device once, then hangs every later grant off the returned claim epoch, and every phase rolls back the
grants it already holds if a later phase fails, so a partial bring-up never leaves a device claimed or an
interrupt bound ([`src/setup/sequence.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L24)).

1. Claim the device. `mk_device_claim` returns a `claim_epoch` that authorizes every later grant on this
   device ([`src/setup/claim.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L17)). A failure is `virtio-gpu: claim failed` ([`src/setup/claim.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L20)).
2. Enable bus mastering. `mk_pci_config_write` sets the PCI command bus-master bit so the device can DMA,
   releasing the claim on failure ([`src/setup/pci.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L20)).
3. Map the register BAR. The modern id maps its modern capability window ([`src/setup/mmio/map_modern.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio/map_modern.rs));
   otherwise an MMIO BAR is mapped page-rounded with `mk_mmio_map` at `BAR_OFFSET 0`
   ([`src/setup/mmio/map_mmio.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio/map_mmio.rs#L22), [`src/constants/mod.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L19)), or a PIO BAR is granted a port-IO window
   with `mk_pio_grant` ([`src/setup/mmio/grant_pio.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio/grant_pio.rs)). The grant is wrapped in a `RegisterGrant` whose
   `release()` tears the mapping back down on rollback ([`src/setup/mmio/grant.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/mmio/grant.rs#L23)).
4. Bind the interrupt. `mk_irq_bind` tries INTx on the device's IRQ line first, then MSI-X; a device that
   reports no usable line yields a zero grant rather than an error, and both attempts failing is still not
   fatal ([`src/setup/irq.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L19), `:28`). The grant is acked once after negotiation
   ([`src/setup/sequence.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L35)).
5. Allocate the control-queue DMA. `mk_dma_map` allocates the `VQ_REGION_SIZE` 16 KiB queue region; on
   failure it unbinds the IRQ, releases the register map, and releases the device claim in reverse order,
   each with its own specific rollback error string ([`src/setup/dma.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L19), [`src/constants/mod.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L20)).

The broker owns each grant, validates it against the claim epoch, and revokes it on capsule exit. The four
facets are documented in `docs/subsystems/hardware-broker/{claim,mmio,dma,irq}.md`.

## The virtio negotiation

With the queue DMA mapped, `bring_up` picks the modern or legacy path by device id and hands it the
register accessor and the queue's physical address ([`src/init/bring_up.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/bring_up.rs#L23), [`src/setup/sequence.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L32)).
Both paths perform the same virtio handshake and clear every optional feature bit.

The modern path ([`src/init/modern.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/modern.rs#L28)):

1. Reset status to 0, then write `STATUS_ACKNOWLEDGE`, then OR in `STATUS_DRIVER`
   ([`src/constants/mod.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L52)).
2. Read the device feature pages. It reads the low page for the record, then reads the high page and
   requires the `VIRTIO_F_VERSION_1` bit; if that bit is absent it sets `STATUS_FAILED` and returns
   `virtio-gpu: modern feature missing` ([`src/init/modern.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/modern.rs#L36)).
3. Write the driver features: zero on the low page, and only the version-1 bit on the high page. It never
   advertises `VIRTIO_GPU_F_VIRGL` or any other optional feature ([`src/init/modern.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/modern.rs#L40)).
4. Set `STATUS_FEATURES_OK` and read it back; if the device cleared it, set `STATUS_FAILED` and return
   `virtio-gpu: features rejected` ([`src/init/modern.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/modern.rs#L44)).
5. Select control queue 0, read its max size, reject a zero size with `virtio-gpu: missing control queue`,
   clamp the size to `VQ_MAX_SIZE` (256), program the descriptor/driver/device ring physical addresses at
   the fixed queue offsets, enable the queue, and finish with `STATUS_DRIVER_OK`
   ([`src/init/modern.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/modern.rs#L49), [`src/constants/mod.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/constants/mod.rs#L21)).

The legacy path is the transitional register layout with the same shape: reset, ACKNOWLEDGE, DRIVER, read
host features, write zero guest features, FEATURES_OK and verify, select queue 0, reject a zero
`QUEUE_NUM`, program `QUEUE_PFN` as `queue_phys >> 12`, and DRIVER_OK ([`src/init/legacy.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/legacy.rs#L24)). Both paths
return an `InitOut` with the negotiated queue size, the host feature word, and the register accessor to use
([`src/init/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/types.rs)).

## Seeding scanouts and building the primary surface

After DRIVER_OK, `setup::run` constructs the empty resource, scanout, and fence tables, then seeds the
scanout table from the device ([`src/setup/sequence.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L41)). `scanouts::seed` issues `GET_DISPLAY_INFO` and
records every enabled scanout; a scanout smaller than 1280x720 is promoted to the 1920x1080 default, and if
the device reports none it seeds a single default scanout 0 ([`src/setup/scanouts.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/scanouts.rs#L24), `:61`).

It then builds the primary surface for scanout 0 ([`src/setup/primary_surface/create.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/primary_surface/create.rs#L23)):

1. Derive the geometry: stride is width times 4, byte length is stride times height capped at `u32::MAX`
   ([`src/setup/primary_surface/geometry.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/primary_surface/geometry.rs#L22)). A zero-area scanout yields no surface.
2. Map a page-rounded DMA region for the backing store with `mk_dma_map`
   ([`src/setup/primary_surface/dma.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/primary_surface/dma.rs#L19)).
3. Allocate a resource id, issue `RESOURCE_CREATE_2D` and `RESOURCE_ATTACH_BACKING`, then prime the display
   with `TRANSFER_TO_HOST_2D`, `SET_SCANOUT`, and `RESOURCE_FLUSH`
   ([`src/setup/primary_surface/create.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/primary_surface/create.rs#L37), [`src/setup/primary_surface/prime.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/primary_surface/prime.rs)).
4. Register the surface with the kernel via `mk_surface_register` and share it via `mk_surface_share`,
   recording the returned handle; any failure at register, share, or the resource-table insert rolls back
   the DMA grant and returns a specific error ([`src/setup/primary_surface/create.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/primary_surface/create.rs#L48), `:53`, `:58`).

The `Primary` record it returns carries the surface handle, the resource id, the geometry, and the backing
address range ([`src/setup/primary_surface/state.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/primary_surface/state.rs)). That backing range is what the
[client/protocol](/docs/userland/driver-virtio-gpu/client-protocol/) layer bounds every `ATTACH_BACKING` request against. The DMA path is
what makes this a real backend: the backing store is a broker-owned physical region the device reads by
physical address, and the transfer and flush commands copy the compositor's finished pixels from that
region to the host framebuffer.

## The no-IOMMU caveat

The broker returns a raw physical `device_addr` and the shipping builds do not engage an IOMMU backend, so
a device programmed with a physical address can in principle DMA anywhere regardless of the grant; the
broker bounds what a capsule may allocate, not where a compliant device actually reads
(`docs/subsystems/hardware-broker/dma.md`). This capsule narrows that surface as far as software can: it
clears every optional virtio feature bit, drives only the fixed control commands it builds itself, and
refuses any `ATTACH_BACKING` address outside the surface region it owns. The residual trust is in the
virtio-gpu device honoring the descriptor bounds, the same trust every DMA-capable driver carries until the
IOMMU backend is enabled.

## Source map

```
  src/main.rs                              _start; the setup::run retry loop
  src/setup/sequence.rs                    the ordered bring-up: claim, bus-master, map, irq, dma, negotiate, primary
  src/discover/                            mk_device_list enumeration, vendor/device match, register BAR select
  src/setup/claim.rs src/setup/pci.rs      the brokered device claim and bus-master enable
  src/setup/mmio/                          the register BAR map (mmio/modern/pio) and the RegisterGrant rollback
  src/setup/irq.rs src/setup/dma.rs        the INTx/MSI-X bind and the control-queue DMA with reverse rollback
  src/init/bring_up.rs                     the modern-vs-legacy path selector
  src/init/modern.rs src/init/legacy.rs    the virtio ACK/DRIVER/FEATURES_OK/DRIVER_OK handshake, version-1 only
  src/setup/scanouts.rs                    seed the scanout table from GET_DISPLAY_INFO, promote/default modes
  src/setup/primary_surface/               geometry, DMA, create/attach/prime, surface register and share
  src/constants/mod.rs                     device ids, queue offsets, virtio status and feature constants
  docs/subsystems/hardware-broker/         the claim, mmio, irq, dma broker facets
```

Every reference above is verified against those trees.
