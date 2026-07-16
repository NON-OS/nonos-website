---
title: "SMP: TLB Shootdown"
description: "When a mapping is removed on one CPU, every other CPU that shares the address space may still hold that translation cached in its TLB."
weight: 2
---
When a mapping is removed on one CPU, every other CPU that shares the address space may
still hold that translation cached in its TLB. Until those stale entries are
invalidated, another CPU could keep reading or writing through a page that has been
unmapped. A TLB shootdown is the cross-CPU invalidation that closes that window: the CPU
that changed the mapping tells the others to drop the entry and waits for them to
confirm. This page documents the shootdown broadcast, the IPI handler that services it,
and the local invalidation primitives. The code is [`src/smp/tlb.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/smp/tlb.rs).

## The broadcast

`tlb_shootdown` ([`src/smp/tlb.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/smp/tlb.rs#L22)) invalidates one virtual address across every CPU:

```
  tlb_shootdown(addr):
      if only one CPU is online:
          invalidate the page locally and return         no IPI needed
      publish addr, reset the ack count, mark a shootdown active
      send the TLB-shootdown IPI to all other CPUs
      invalidate the page locally
      wait until (cpus_online - 1) CPUs have acked, or a timeout elapses
      mark the shootdown inactive
```

On a single-CPU system it degrades to a plain local `invlpg` with no inter-processor
traffic. With more than one CPU online it publishes the target address, resets the
acknowledgement counter, marks a shootdown active, and sends the shootdown
inter-processor interrupt to every other CPU. It invalidates the address in its own TLB,
then spin-waits until the number of acknowledgements equals the number of other online
CPUs. The wait has a bound: after roughly ten million TSC cycles it logs
`TLB shootdown timeout` and proceeds rather than hanging the CPU forever if one core is
unresponsive. When all others have acked, the shootdown is marked inactive.

## The IPI handler

Each other CPU services the shootdown in its interrupt handler
(`tlb.rs:57`):

```
  handle_tlb_shootdown_ipi():
      if a shootdown is active:
          read the published address
          invalidate that page locally
          increment the ack count
```

The receiving CPU reads the published address, invalidates it in its own TLB, and bumps
the acknowledgement counter that the initiator is waiting on. Because the initiator only
proceeds once every other CPU has acked, the mapping is guaranteed dropped from every
TLB before the initiator continues, so no CPU can use the stale translation afterward.

## The invalidation primitives

Two primitives do the actual work (`tlb.rs:68`). `invalidate_page` executes `invlpg`,
which removes a single page's translation from the TLB, and it is what both the initiator
and the IPI handler call for a targeted flush. `flush_tlb` reloads `CR3` from itself,
which flushes the entire non-global TLB at once, used where a whole-address-space flush
is cheaper than invalidating pages one at a time. The single-page path is the common
case; the full flush is for bulk changes.

## How the address-space scope is decided

`tlb_shootdown` itself sends to every other CPU. The decision of whether a given
unmapping needs a shootdown at all, and against which CPUs, is made a layer up, in the
[paging manager](/docs/subsystems/memory/paging-manager/)'s per-ASID shootdown wrappers, which read
each CPU's [`active_asid`](/docs/subsystems/smp/per-cpu/) to filter targets: a user-address flush skips a CPU
that is not running the affected address space, while a kernel-address flush reaches
every online CPU because kernel mappings are shared by all of them. This file is the
broadcast-and-wait primitive; the paging manager decides when to invoke it.

## Security analysis

A missed TLB shootdown is a memory-safety hole: a CPU that keeps a stale translation can read or write
through a page that was unmapped and possibly handed to another tenant. So the properties here are about
never letting the initiator proceed while a stale entry survives. Three hold.

**The initiator waits for every other online CPU to acknowledge.** `tlb_shootdown`
([`src/smp/tlb.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/smp/tlb.rs#L22)) resets `TLB_SHOOTDOWN_ACK` to zero, sends the IPI, invalidates locally, then
spin-waits until the ack count reaches `cpus_online() - 1`. Each other CPU, in
`handle_tlb_shootdown_ipi` (`tlb.rs:57`), invalidates the published address and does a
`fetch_add` on the ack counter. Because the initiator does not return until every other CPU has bumped
that counter, the mapping is dropped from every TLB before the initiator continues. The publish/ack
handshake uses release/acquire ordering (`store(..., Release)` on the address and active flag,
`load(Acquire)` on the ack), so the receiver sees the published address before it acts and the initiator
sees the acks after they are counted.

**The active flag gates the handler, so a spurious IPI is a no-op.** `handle_tlb_shootdown_ipi` reads
`TLB_SHOOTDOWN_ACTIVE` first and only invalidates and acks when a shootdown is genuinely in progress
(`tlb.rs:57`). An IPI that arrives with no active shootdown does nothing and does not corrupt the ack
count for a later one, so a stray or late-delivered vector cannot desynchronise the handshake.

The honest boundary is the timeout. The wait is bounded: after roughly ten million TSC cycles the
initiator logs `[SMP] TLB shootdown timeout` and proceeds anyway rather than hanging the CPU forever if a
core is unresponsive (`tlb.rs:22`). Proceeding on a timeout means the safety guarantee, that every TLB
dropped the entry, is best-effort under a wedged CPU: the alternative, hanging the initiator forever,
would take the whole system down instead. In practice a timeout means a core is stuck with interrupts
disabled or not servicing the vector, which is itself a bug to chase; the timeout keeps that bug from
freezing the CPU that changed the mapping, and the log line is the signal that it happened.

## Debugging TLB shootdown

The one message this path prints is the timeout, and it is the anchor for the two failure shapes here:

```
  [SMP] TLB shootdown timeout    an ack never arrived within ~10M TSC cycles; the initiator proceeded
```

**A shootdown timeout.** The initiator waited for `cpus_online() - 1` acks and one never came. The usual
cause is a CPU that is not servicing the shootdown vector: it took an exception with interrupts off, it is
spinning in a section with `cli`, or its IDT entry for `IPI_TLB_SHOOTDOWN` is not installed. Because
`init_bsp` registers the IPI handlers before any AP starts ([`src/smp/init/bsp.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/smp/init/bsp.rs)), a timeout on a system
that booted cleanly points at a stuck core rather than a missing handler. The danger sign that follows a
timeout is a later use-after-free-shaped fault on another core, since the initiator proceeded assuming
every TLB was flushed when one was not.

**A stale translation with no timeout.** If a CPU reads through an unmapped page but no timeout was
logged, the shootdown probably was not sent for that unmapping at all, which is a decision made a layer up
in the [paging manager](/docs/subsystems/memory/paging-manager/)'s per-ASID wrappers, not in this file. The filter
there reads each CPU's [`active_asid`](/docs/subsystems/smp/per-cpu/); a CPU whose `active_asid` is wrong (for instance
because a context switch did not update it, or a per-CPU read hit the wrong core through a bad GS base)
would be skipped when it should have been included. So a stale-translation bug with no timeout points at
the ASID filter and the `active_asid` field, whereas a timeout points at delivery and servicing. On a
single-CPU boot neither can occur: `tlb_shootdown` degrades to a plain local `invlpg` with no IPI when
`cpus_online() <= 1`, so a shootdown bug is always a multi-CPU-only symptom.

## Source map

```
  src/smp/tlb.rs        tlb_shootdown, handle_tlb_shootdown_ipi, invalidate_page, flush_tlb
  src/smp/ipi/          the inter-processor interrupt send and vectors
  src/smp/state.rs      the shootdown address, ack, and active flags
  src/smp/init/bsp.rs   init_bsp binds the IPI handlers before any AP starts
  src/smp/ipi_idt.rs    register_ipi_handlers, the shootdown vector binding
```

Every reference above is verified against those trees. The address-space filter that decides when to
invoke this broadcast is in the [paging manager](/docs/subsystems/memory/paging-manager/), the `active_asid` field it
reads to scope targets is on the [per-CPU](/docs/subsystems/smp/per-cpu/) page, and the online-CPU count the wait depends on
is established during AP bring-up in the SMP init path.
