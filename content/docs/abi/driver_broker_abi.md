---
title: "Driver Broker ABI"
description: "The driver broker ABI is the kernel boundary used by driver capsules to claim a device and request the narrow hardware grants needed to drive it."
weight: 500
---
The driver broker ABI is the kernel boundary used by driver capsules to claim a
device and request the narrow hardware grants needed to drive it. It is not a
general physical-memory API and it is not a kernel driver framework.

## Authority model

Every broker operation is capability checked and device scoped. A driver must
first claim a device. The claim records the owner process and an epoch. Later
grant calls must present the current claim and epoch, which prevents replaying a
grant against a device that has been released and claimed by another capsule.

## Capabilities

| Capability | Authority |
|---|---|
| `DeviceEnum` | enumerate visible devices |
| `Driver` | claim and release a device |
| `Mmio` | map and unmap vetted device BAR ranges |
| `Irq` | bind, poll, acknowledge, and release interrupt grants |
| `Dma` | pin driver buffers and expose broker-vetted DMA addresses |
| `Pio` | x86_64-only port IO grants and port access |

## Claim lifecycle

```text
MkDeviceList(out)
MkDeviceClaim(device) -> claim_id, epoch
MkDeviceRelease(device, claim_id, epoch)
```

Release invalidates the ownership epoch and drops grants owned by the claim.
Grant handlers reject calls from processes that do not own the claim or present a
stale epoch.

## MMIO grants

```text
MkMmioMap(device, claim_id, epoch, bar, offset, length, out: MmioMapOut)
MkMmioUnmap(grant)
```

The broker validates the requested region against the claimed PCI device record
before mapping it into the caller. A driver can map only BAR space belonging to
the device it owns.

## IRQ grants

```text
MkIrqBind(device, claim_id, epoch, gsi, flags, vector_count, out: IrqBindOut)
MkIrqPoll(grant, out: IrqPollOut)
MkIrqAck(grant)
MkIrqUnbind(grant)
```

INTx grants route a GSI to a broker vector and keep the line masked between
delivery and acknowledgement. MSI-X grants allocate a contiguous vector/grant
range for the requested vector count.

## DMA grants

```text
MkDmaMap(device, claim_id, epoch, user_buffer, length, flags, out: DmaMapOut)
MkDmaUnmap(grant)
```

The broker pins the caller buffer, bounds the mapping by device class, and
returns the DMA address. Unmap releases the pin and invalidates the grant.

## PIO grants

```text
MkPioGrant(device, claim_id, epoch, base, length, out)
MkPioRead(grant, port, width, out)
MkPioWrite(grant, port, width, value)
MkPioRelease(grant)
```

PIO exists only on x86_64. Reads and writes are rejected unless the target port
falls inside the caller's grant and uses a supported width.

## Security invariants

- No broker call grants access without both capability and current device
  ownership.
- Grants are scoped to one owner process and one device claim epoch.
- MMIO grants are constrained to the claimed device BARs.
- IRQ grants are owned, polled, acknowledged, and released by grant id.
- DMA grants pin bounded caller memory and are explicitly unmapped.
- PIO grants are x86_64-only and range checked on every access.

## Non-goals

The broker ABI does not parse device protocols, implement NIC/storage/GPU
drivers in the kernel, persist hardware state, or allow arbitrary physical
memory access. Protocol state belongs in driver capsules and higher service
capsules.

## Debugging a driver against the broker

The claim is where most bring-up problems surface, because every grant call
checks it. A driver whose claim never succeeds is being refused one of two ways.
`EBUSY` on `MkDeviceClaim` means the device is already claimed: either two drivers
were spawned for the same hardware, or a previous instance did not release it on
exit, which is a spawn-plan question rather than a hardware one. `EINVAL` with an
unknown device id means the device is not in the broker table at all, which is a
discovery problem one layer down; the device was never enumerated, so no `device`
argument will ever name it. A `NONOS_DEVICE_CENSUS=1` build renders the broker
device table to the framebuffer and holds, so the device list can be read off
before any driver runs.

Once claimed, the common grant failure is `EPERM`, and it has two independent
causes that look identical from the return value. Either the capsule's manifest
did not declare the capability the call needs, `Mmio` for a map, `Irq` for a bind
or poll, `Dma` for a pin, so the capability gate refused it; or the manifest
declared the bit but the call named a grant or claim it does not own, or presented
a stale epoch after a release-and-reclaim cycle. When a driver gets `EPERM` on
`MkIrqPoll`, check both that the manifest carried `Irq` and that the poll names
the grant id the bind returned. Interrupts that bind cleanly but never seem to
arrive are usually a poll-and-ack question rather than a routing one: the line
stays masked between delivery and acknowledgement, so a driver that binds and
polls but never calls `MkIrqAck` sees the sequence advance once and then stall.
`MkIrqWait` is reserved and has no handler, so a driver written against it gets
`ENOSYS` and makes no progress; the poll-and-ack loop is the supported path today.

## Source map

```
  src/hardware/broker/claim.rs      the claim table, the epoch, claim/release,
                                    and release_all_for_pid from process exit
  src/hardware/broker/mmio/         MkMmioMap/Unmap and the BAR range validation
  src/hardware/broker/irq/          MkIrqBind/Poll/Ack/Unbind and the mask policy
  src/hardware/broker/dma/          MkDmaMap/Unmap and the buffer pin
  src/hardware/broker/pio/          the x86_64-only port grants (cfg-gated)
  src/syscall/microkernel/irq/out.rs   IrqBindOut and IrqPollOut, the reply shapes
  src/hardware/broker/device/record.rs the DeviceRecord returned by MkDeviceList
```

The capability each broker call requires is on [the syscall page](/docs/abi/syscalls/);
the claim and epoch model these grants hang off is on
[the hardware broker page](/docs/subsystems/hardware-broker/claim/).
