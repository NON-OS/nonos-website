---
title: "Debugging capsule_driver_rtl8139"
description: "This page lists the log marker the driver's boot path emits, the bring-up exit codes, and the concrete runtime failure modes with where to look for each."
weight: 10
---
This page lists the log marker the driver's boot path emits, the bring-up exit codes, and the concrete runtime
failure modes with where to look for each. For the shape of the driver see the [README](/docs/userland/driver-rtl8139/), the
[operations](/docs/userland/driver-rtl8139/operations/) page, the [bring-up](/docs/userland/driver-rtl8139/bring-up/) page, and the [buffers](/docs/userland/driver-rtl8139/buffers/) page.

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel prints
`[DRIVER-RTL8139] capsule spawned`: the NIC spawn plan calls `boot::capsule` with the tag `DRIVER-RTL8139`
([`src/userspace/init/spawn_plan/drivers_nic.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_nic.rs#L40)), whose `Ok` arm calls `boot_log::ok(prefix, "capsule
spawned")` ([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)), which formats `[` + tag + `] ` + message
([`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). An absent line means the capsule never started, usually a signature,
manifest, or capability failure; the `Err` arm prints an `[ERROR]` line instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)). The RTL8139 spawn is feature-gated on
`nonos-capsule-driver-rtl8139`, so a build without that feature spawns nothing at all
([`src/userspace/init/spawn_plan/drivers_nic.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/drivers_nic.rs#L46)).

## Bring-up exit codes

If the capsule spawns but heap init, `setup::run`, or `init::bring_up` fails, the process exits with a distinct
code, which is the fastest way to tell how far bring-up got ([`src/main.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L36)).

| Exit | Stage | Meaning and where it comes from |
|---|---|---|
| 1 | heap | `heap_init` failed before any device work ([`src/main.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L36)). |
| 2 | setup | A grant step failed: no device matched, or the claim, bus-master write, PIO grant, INTx bind, or DMA map was refused, or a DMA region came back above 32 bits ([`src/main.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L40), and the failure points in `src/setup/`). |
| 3 | init | The grants were taken but device programming failed: reset never cleared, the MAC was all-zero or all-ones, or a register write was refused; `main` releases every grant first ([`src/main.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L43)). |

Exit `2` is a family of grant failures. Discovery finding no RTL8139 ([`src/setup/sequence.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/sequence.rs#L25),
[`src/discover.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/discover.rs#L36)) looks the same at the exit-code level as a refused claim ([`src/setup/claim.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/claim.rs#L19)), a
refused PIO grant ([`src/setup/pio_grant.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pio_grant.rs#L24)), a refused INTx bind ([`src/setup/irq.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/irq.rs#L24)), or a refused or
over-32-bit DMA map ([`src/setup/dma.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/dma.rs#L53)). The specific `&'static str` returned names which
(`"no rtl8139 device"`, `"device claim failed"`, `"pio grant failed"`, `"irq bind failed"`, `"rx dma failed"`,
`"tx dma failed"`, `"rtl8139 requires 32-bit dma"`), so the error string distinguishes them where the exit
code does not.

Exit `3` is a device-programming failure. The three causes are a reset that never cleared its bit within a
million polls (`"rtl8139 reset timeout"`, [`src/init/reset.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/reset.rs#L28)), a MAC that read back all-zero or all-ones
and so is not a real address (`"rtl8139 invalid mac"`, [`src/init/mac.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/mac.rs#L26)), or a `Pio` write that the broker
refused while programming `RBSTART`, `CAPR`, `RCR`, the `TXADDR` registers, `TCR`, `ISR`, `IMR`, or the
command register ([`src/init/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/init/run.rs#L29)).

## Runtime failure modes

After a successful boot, the failures surface as errno words in the reply, not exit codes.

### The receive ring is empty (`E_AGAIN`)

`OP_RX_PACKET` returns `E_AGAIN` (`-11`) when the NIC reports the receive buffer empty, which is the normal
idle case, not an error ([`src/rx/recv_one.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L35), [`src/server/handlers/rx_packet.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/rx_packet.rs#L31)). A stack that polls
the driver expects this constantly; it means "no frame right now, ask again," and no device fault has
occurred. This is the load-bearing distinction for a NIC: an empty ring is not the same as a broken ring.

### A receive returns `E_IO`

`OP_RX_PACKET` returns `E_IO` (`-5`) on a real receive fault: an `ISR` RX-error, RX-overflow, or
RX-FIFO-overflow bit was set ([`src/rx/recv_one.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/recv_one.rs#L31)), or a ring descriptor failed validation, meaning its
receive-OK status bit was clear, its raw length was four or fewer bytes, or the frame length exceeded the
Ethernet maximum or the reply buffer ([`src/rx/read_frame.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/rx/read_frame.rs#L37), `read_frame.rs:42`). An overflow points at a
consumer that is not draining the ring fast enough; a descriptor error points at a corrupt ring, which on real
hardware usually means the buffer address or the `CAPR` cursor arithmetic is off.

### A transmit returns `E_MSGSIZE` or `E_INVAL`

`OP_TX_PACKET` returns `E_MSGSIZE` (`-90`) when the request body length does not match the header's
`payload_len` field, and `E_INVAL` (`-22`) when the frame is shorter than 60 or longer than 1514 bytes
([`src/server/handlers/tx_packet.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L24), `tx_packet.rs:28`). These are request-validation errors; no byte
reaches the NIC. Check that the client's declared payload length equals the bytes it actually sent and that
the frame is a legal Ethernet size.

### A transmit returns `E_IO`

`OP_TX_PACKET` returns `E_IO` (`-5`) when the send reached the NIC but the slot completed with an abort or
underrun, or never completed within the poll budget ([`src/tx/poll_done.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tx/poll_done.rs#L28), `poll_done.rs:36`,
[`src/server/handlers/tx_packet.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/tx_packet.rs#L37)). An underrun points at DMA starvation, an abort at excessive
collisions or a link problem, and a timeout at a NIC that never raised its transmit-OK bit, which on real
hardware usually means bus mastering did not take effect or the slot address is wrong.

### Link reports down

`OP_LINK_STATUS` returns a `0` byte when the `MSR` link-bad bit is set ([`src/server/handlers/link_status.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/link_status.rs#L29)).
That is a cable or peer condition, not a driver fault; the driver is up and reading the register correctly. A
status of `-5` from that op instead means the `MSR` port read itself failed, which is a grant or port problem,
not a link problem. `OP_STATS` is the companion probe: its 48-byte snapshot exposes `CMD`, `MSR`, `ISR`, `RCR`,
`TCR`, `CAPR`, the four transmit-status words, and the software `rx_offset` and `tx_cur`, all without touching
a clear-on-read register, so it is safe to poll while diagnosing ([`src/server/handlers/stats.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/stats.rs#L47)).

## The IOMMU caveat

On the current target there is no IOMMU, so bus mastering is enabled but nothing in hardware confines the
NIC's DMA to the ring and slots the driver programmed ([`src/setup/pci.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup/pci.rs#L23)). The driver mitigates in
software by requiring 32-bit DMA addresses and only ever programming broker-issued addresses, but a
misbehaving NIC that DMAs outside its buffers is a class of failure the broker cannot catch without an IOMMU.
This is the universal DMA caveat shared by every hardware driver capsule, described in full on the
[bring-up](/docs/userland/driver-rtl8139/bring-up/) page.

## Source map

```
  src/userspace/init/spawn_plan/drivers_nic.rs        the DRIVER-RTL8139 spawn entry and feature gate
  src/userspace/init/capsule_boot/run.rs              the capsule-spawned / error boot markers
  src/sys/boot_log/output.rs                          the [TAG] message formatting
  userland/capsule_driver_rtl8139/src/main.rs         the exit codes 1, 2, 3
  userland/capsule_driver_rtl8139/src/setup/          the claim, bus-master, PIO, IRQ, and DMA failures behind exit 2
  userland/capsule_driver_rtl8139/src/init/reset.rs   the reset-timeout behind exit 3
  userland/capsule_driver_rtl8139/src/init/mac.rs     the invalid-MAC behind exit 3
  userland/capsule_driver_rtl8139/src/rx/recv_one.rs  the E_AGAIN empty case and the E_IO interrupt errors
  userland/capsule_driver_rtl8139/src/rx/read_frame.rs the E_IO descriptor validation
  userland/capsule_driver_rtl8139/src/tx/poll_done.rs the E_IO abort/underrun/timeout paths
  userland/capsule_driver_rtl8139/src/server/handlers/tx_packet.rs  the E_MSGSIZE and E_INVAL bounds
  userland/capsule_driver_rtl8139/src/server/handlers/link_status.rs  the link-down and read-failure paths
  userland/capsule_driver_rtl8139/src/server/handlers/stats.rs  the side-effect-free snapshot
  userland/capsule_driver_rtl8139/src/setup/pci.rs    the bus-master enable behind the IOMMU caveat
```

Every reference above is verified against those trees.
