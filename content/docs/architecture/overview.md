---
title: "Architecture Overview"
description: "This page is the map of the whole system. It describes what NØNOS is, how it comes up, how memory and privilege are arranged, what a capsule is, how a capsule is admitted and ru..."
weight: 500
---
This page is the map of the whole system. It describes what NØNOS is, how it
comes up, how memory and privilege are arranged, what a capsule is, how a
capsule is admitted and run, and how the kernel mediates every privileged
action through capabilities and the hardware broker. Every section points at
the source that implements it.

Read this top to bottom once. After that, the per-subsystem pages assume you
know the vocabulary established here.

---

## 1. What NØNOS is

NØNOS is a microkernel. The kernel itself does the minimum that only ring 0 can
do: physical memory, paging, the scheduler, interrupt routing, the syscall
boundary, capability enforcement, and a small set of brokered hardware
primitives. Everything a user would recognise as the operating system, the
drivers, the window system, the network stack, the shell, the applications,
runs in user mode as a **capsule**.

A capsule is not a process image read off a disk. There is no disk in the trust
path. A capsule is a signed bundle compiled ahead of time and embedded directly
into the kernel binary. At spawn time the kernel verifies the bundle against a
baked-in trust anchor before a single instruction of capsule code executes. The
system is RAM-resident: it boots, verifies, and runs entirely from memory.

NØNOS is multi-architecture by construction. The kernel targets three
instruction sets: x86_64, aarch64, and riscv64. x86_64 is production-first and
the most exercised path; aarch64 and riscv64 are architecture-ready backends
that compile against the same generic kernel. Architecture-specific machinery
sits behind a single boundary, the `ArchOps` trait, so the scheduler, the
syscall layer, the broker, and the capsule machinery are written once and run
on every backend. Section 2 describes that boundary. Where a later section names
an x86_64 mechanism such as the IO-APIC or the `SYSCALL` instruction, that is
the x86_64 realisation of an arch-neutral primitive, and the equivalent on the
other backends is noted alongside it.

The three properties that shape every design decision:

```
  +---------------------------------------------------------------+
  |  Capability based  | A capsule can only perform an action if   |
  |                    | it holds the capability bit for it. The   |
  |                    | kernel checks on every syscall.           |
  +--------------------+-------------------------------------------+
  |  Verified spawn    | No capsule runs until its certificate and |
  |                    | manifest verify against the trust anchor  |
  |                    | and its payload hash matches.             |
  +--------------------+-------------------------------------------+
  |  RAM resident      | Code and trust material live in memory.   |
  |                    | The boot path never trusts a mutable store.|
  +--------------------+-------------------------------------------+
```

---

## 2. Architecture boundary

Generic kernel code never reaches into a per-arch module directly. It calls
through one type alias, `Arch`, which the build selects by target
([`src/arch/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/mod.rs)):

```
  #[cfg(target_arch = "x86_64")]  pub type Arch = x86_64::abi::X86_64;
  #[cfg(target_arch = "aarch64")] pub type Arch = aarch64::abi::Aarch64;
  #[cfg(target_arch = "riscv64")] pub type Arch = riscv64::abi::Riscv64;
```

`Arch` implements the `ArchOps` trait ([`src/arch/abi.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/arch/abi.rs#L36)), the set of leaf
primitives that only the silicon can provide. The current boundary is eight
calls:

```
  halt()                      stop the calling CPU forever
  enable_interrupts()         unmask interrupts on this CPU
  disable_interrupts()        mask interrupts on this CPU
  interrupts_enabled()        report the mask state
  current_cpu_id()            stable id of the executing CPU
  read_time_counter()         monotonic per-CPU counter
                                (TSC on x86_64, generic timer on aarch64,
                                 mtime on riscv64)
  flush_tlb_one(addr)         invalidate one TLB entry on this CPU
  switch_address_space(root)  load a new page-table root on this CPU
```

```
   generic kernel
   scheduler, syscall layer, broker, capsule machinery
          |
          |  <Arch as ArchOps>::method()
          v
   +------------+   +------------+   +------------+
   |  X86_64    |   |  Aarch64   |   |  Riscv64   |
   |  TSC, APIC |   |  GIC, gen  |   |  PLIC,     |
   |  ACPI, PIO |   |  timer, FDT|   |  mtime, FDT|
   |  SYSCALL   |   |            |   |            |
   +------------+   +------------+   +------------+
```

Adding an architecture means writing one backend type that implements
`ArchOps`. The trait is deliberately infallible: a backend that cannot implement
a primitive yet must simply not provide the impl, so a build for that target
fails to link rather than silently doing the wrong thing. The boundary widens in
phases. The eight primitives above are the first set; IRQ vector allocation, the
MMIO, PIO and DMA grants, the syscall entry path, and the per-arch timer device
move behind their own boundaries next, with x86_64 leading and the other
backends following through emulation and then hardware.

One concrete divergence to keep in mind while reading: x86_64 discovers its
platform through ACPI tables, while aarch64 and riscv64 use a flattened device
tree (`src/arch/fdt`, compiled only for those targets). Port IO is an x86_64
concept and the PIO broker is compiled only on x86_64; the other backends reach
their devices entirely through MMIO.

## 3. Privilege and address space layout

The machine runs with a hard split between the kernel half and the user half of
the virtual address space. The kernel lives in the upper half and never executes
from the lower half once boot finishes. Each capsule gets its own address space;
the kernel half is shared and mapped identically into every one of them, the
lower half is private to the capsule. The diagram below is the x86_64 layout;
the upper-half kernel and lower-half capsule split is the same on every backend,
only the exact addresses and the page-table shape differ.

```
  Virtual address space (per capsule)

  0xFFFF_FFFF_FFFF_FFFF  +-----------------------------+
                         |  kernel text   (PML4[511])  |
                         |  direct map    (PML4[256])  |  ring 0 only
                         |  per-pid kernel stacks      |  shared mapping
                         |  LAPIC MMIO (uncached)      |
  0xFFFF_8000_0000_0000  +-----------------------------+
                         |                             |
                         |        non-canonical        |
                         |                             |
  0x0000_7FFF_FFFF_FFFF  +-----------------------------+
                         |  capsule code and data      |  ring 3
                         |  user stack                 |  private per capsule
                         |  mapped surfaces, dma bufs  |
  0x0000_0000_0000_0000  +-----------------------------+
```

The canonical boundary at `0x0000_7FFF_FFFF_FFFF` is enforced when a user
context is built. [`arch/x86_64/context/setup.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/arch/x86_64/context/setup.rs#L36) rejects any entry point or
user stack pointer above that line before it will construct the `iretq` frame,
so a malformed capsule cannot be set up to start executing in kernel space.

---

## 4. Boot sequence

Control flow from the entry point to the first capsule is a fixed, ordered
sequence. Three phases: bring up the core CPU and interrupt machinery, bring up
the microkernel services, then create the init process and drop to user mode.

```
  kernel_entry                         src/nonos_main.rs:39
        |
        v
  init_core_systems                    src/boot/main/core_init.rs:21
    serial, TSC, boot timer
    GDT                                arch/x86_64/gdt
    SYSCALL MSRs (STAR/LSTAR/CSTAR)    arch/x86_64/syscall
    early IDT, then full IDT
    heap bootstrap allocator           memory/heap/manager
    ACPI tables (RSDP from handoff)
    LAPIC init
    preemption timer @ 100 Hz          arch/.../apic/preemption/install.rs:25
    sti  (interrupts on)
    PCI enumeration, entropy, nonces
        |
        v
  microkernel_init(handoff)            src/kernel_core/init/entry.rs:26
    physical memory from EFI map       kernel_core/init/memory.rs
    framebuffer + boot log
    RNG, IPC secret
    SMP bring-up of the BSP
    scheduler init                     process/scheduler/core.rs:36
    clock init
    init_unified_vm                    memory/unified/init/run.rs:35
    IO-APIC routing from ACPI          arch/.../ioapic/init_from_acpi
    process management, ELF loader
    kernel keys
    start secondary CPUs
        |
        v
  microkernel_main                     src/kernel_core/init/entry.rs:112
    create init process (pid 1)
    create init address space
    allocate init kernel stack
    run_init                           src/userspace/init/entry.rs:20
        |
        v
  spawn all system capsules, enter the supervisor loop
```

Two ordering facts matter and have bitten us before, so they are called out
here.

The IO-APIC routing table is initialised in `microkernel_init`, **after**
`init_unified_vm`, not during early core init. Programming an IO-APIC
redirection entry is an MMIO write, and the MMIO window only becomes mappable
once unified paging is established. Initialise it earlier and the write page
faults. This is why device IRQ binds depend on `init_from_acpi` having run at
the right point in the order above.

The preemption timer is armed at 100 Hz (`TICK_HZ = 100`, one tick every 10 ms)
during core init, but it only does useful work once the scheduler exists and
there is more than one runnable entity. Until `run_init` populates the
runqueue, ticks fall through.

---

## 5. Memory model

Physical memory is managed by a bitmap frame allocator over 4 KiB frames, seeded
from the EFI memory map handed to the kernel at boot
([`kernel_core/init/memory.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/kernel_core/init/memory.rs)). Allocation hands out single frames; the higher
level page allocator (`memory/page_allocator`) carves kernel virtual ranges for
things like per-pid kernel stacks.

Paging is driven through a paging manager (`memory/paging/manager`). The pivotal
step is `init_unified_vm` at [`memory/unified/init/run.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/memory/unified/init/run.rs#L35), which does the
following in order:

```
  1. register the active PML4 (read from CR3) as the kernel address space
  2. confirm the bootloader populated the kernel half, PML4[256..511]
       PML4[256] = direct map        PML4[511] = kernel text
  3. probe the frame allocator (allocate then free one frame)
  4. bring up the page allocator for kernel virtual ranges
  5. remap the LAPIC MMIO page into the upper half as uncached, and
       rebind LAPIC_BASE to that virtual address
  6. tear down the bootloader's low half, PML4[0..255], but only once the
       kernel half is confirmed to hold its own mappings
```

After step six the kernel executes purely from the upper half. The identity map
the bootloader used to get into Rust is gone. This is what RAM-resident means
in practice: there is no lower-half scratch the kernel falls back on, and a
stray lower-half pointer dereferenced in kernel mode faults instead of
silently reading boot leftovers.

The heap is a global allocator bootstrapped very early
(`memory/heap/manager`), so `alloc` and `Vec` are available for the rest of
init.

---

## 6. The capsule

A capsule is three artifacts produced at build time:

```
  +------------------------+   the executable, compiled for the
  |  ELF                   |   x86_64-nonos-user target
  +------------------------+
  +------------------------+   NØNOS-ID certificate: the capsule's
  |  nonos_id_cert.bin      |   identity, signed by a trust anchor
  +------------------------+
  +------------------------+   manifest: payload hash, required caps,
  |  manifest.bin           |   endpoints, publisher signatures
  +------------------------+
```

All three are embedded into the kernel with `include_bytes!`. For example the
PS/2 input driver pulls its ELF, certificate, and manifest in at
[`src/hardware/ps2_kbd_capsule/embed.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/ps2_kbd_capsule/embed.rs#L24). The signed certificate and manifest
for every capsule live under `nonos-data/trust/capsules/`.

### Manifest

[`src/security/capsule_manifest/schema/manifest.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/capsule_manifest/schema/manifest.rs#L28), schema version 3:

```
  CapsuleManifest
    schema_version       u16
    nonos_id_cert_id     [u8; 32]    BLAKE3 of the certificate it binds to
    namespace            [u8; 96]    plus length
    version              Version
    target_triple        [u8; 64]    plus length
    payload_hash         [u8; 32]    BLAKE3 of the ELF
    required_caps        u64         capability bits that must be granted
    optional_caps        u64         capability bits that may be granted
    endpoints            Vec<EndpointDecl>          up to 16
    publisher_signatures Vec<PublisherSignature>    up to 4
```

An endpoint declaration ([`schema/endpoint.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/schema/endpoint.rs)) is a kind (Service or Reply), a
port number, and a name. Endpoints are how a capsule advertises the IPC ports it
will serve and reply on. The set declared here is checked against the set the
kernel is asked to register at spawn, so a capsule cannot quietly open a port it
did not declare.

A publisher signature ([`schema/publisher_sig.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/schema/publisher_sig.rs)) carries an algorithm id, a key
id, and the signature bytes. The production algorithms are Ed25519 and ML-DSA-65,
used together: a classical signature and a post-quantum signature over the same
material.

### Certificate

[`src/security/nonos_id_cert/schema/cert.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/nonos_id_cert/schema/cert.rs#L25), schema version 2:

```
  NonosIdCertificate
    nonos_id                 [u8; 32]   BLAKE3 derived identity
    namespace_globs          Vec<..>    up to 8, the namespaces this id may use
    allowed_caps_ceiling     u64        the most this id may ever be granted
    valid_from_ms / until_ms u64        validity window
    trust_anchor_epoch       u64
    publisher_keys           Vec<..>    up to 4
    trust_anchor_signatures  Vec<..>    up to 4, the anchor's signatures
```

The certificate is the durable identity. It sets a hard ceiling on capabilities
(`allowed_caps_ceiling`) that no manifest can exceed, names the namespaces the
capsule is allowed to operate in, and is itself signed by the trust anchor. The
manifest is the per-build statement that binds to a certificate and declares
exactly what this build needs.

---

## 7. Verified spawn

Spawning a capsule is a gate, not a load. Nothing runs until verification
passes. The entry point is `spawn_verified` at
[`kernel_core/process_spawn/capsule_spawn/runner/verified.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/kernel_core/process_spawn/capsule_spawn/runner/verified.rs#L26), which runs
preflight, then install.

```
  spawn_verified
        |
        v
  preflight  (verify_with_publisher)   security/capsule_manifest/verify/mod.rs:36
        |
        |   decode certificate, verify against the baked trust anchor
        |   decode manifest
        |   check manifest is bound to this certificate
        |   check namespace is within the certificate's globs
        |   check required caps are within allowed_caps_ceiling
        |   verify every required signature algorithm over the signed region
        |   hash the ELF, check it equals manifest.payload_hash
        |   check target triple
        |   check declared endpoints match what is being registered
        |   -> returns the verified capability bits to install
        |
        v
  install                              .../runner/install/install.rs:30
        create process (state Ready, not Running)
        register the process inbox  proc.<pid>
        load the ELF into the process address space
        install the verified capability bits into the PCB
        allocate kernel stack and user stack
        build the initial user context (the iretq frame)   context.rs
        register the capsule's service endpoint
        add the pid to the runqueue
```

The capability bits installed are exactly the ones preflight returned, the
intersection of what the manifest asked for and what the certificate ceiling
allows. The process is created in `Ready` state and added to the tail of the
runqueue; it does not run until the scheduler reaches it.

The signature verification itself lives at
[`crypto/asymmetric/alg_id/verify.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/crypto/asymmetric/alg_id/verify.rs#L23) and dispatches on algorithm: Ed25519
through the in-tree ed25519 implementation, ML-DSA-65 through the post-quantum
module. Both must pass for a production capsule.

---

## 8. Capability model

A capability is a single bit. There are 22 of them, defined as an enum whose
discriminants are the bit values themselves
([`src/capabilities/types.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L18)):

```
  CoreExec              1          IPC                   8
  IO                    2          Memory                16
  Network               4          Crypto                32
  FileSystem            64         Hardware              128
  Debug                 256        Admin                 512
  RegisterService       1024       GraphicsDisplayQuery  2048
  GraphicsSurfaceCreate 4096       GraphicsSurfaceMap    8192
  GraphicsPresent       16384      DeviceEnum            32768
  Driver                65536      Mmio                  131072
  Irq                   262144     Dma                   524288
  Pio                   1048576    InputSource           2097152
```

A capsule declares the bits it needs in its manifest. After verified spawn those
bits are installed into the process control block and minted into a capability
token. From then on the bits are not a suggestion; they are checked on the way
into every syscall.

### Enforcement

The check happens before any syscall does work
([`syscall/contract/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/syscall/contract/dispatch.rs#L31)):

```
  dispatch(number, args)
      cap = Capability::resolve(number, args)
      if cap is None:
          log the denial, return EPERM
      invoke(number, args)
```

`resolve` runs a chain ([`syscall/contract/resolver/resolve.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/syscall/contract/resolver/resolve.rs#L31)): the token's
MAC must verify, it must be bound to this session and address space, its
revocation epoch must be current, and the syscall must be permitted for the held
capabilities. The mapping from syscall to required capability is an explicit
table at [`syscall/contract/cap_table/mk.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/syscall/contract/cap_table/mk.rs#L20). A few rows from it:

```
  MkMmap                 -> can_allocate_memory
  MkSpawn, MkIpc*        -> can_ipc
  MkDeviceClaim/Release  -> can_driver
  MkMmioMap/Unmap        -> can_mmio
  MkIrqBind/Unbind       -> can_irq
  MkDmaMap/Unmap         -> can_dma
  MkPioGrant/Read/Write  -> can_pio
  MkSurfacePresent       -> can_present
  MkInputEventPost       -> can_input_source
```

### Tokens

A capability token ([`capabilities/token/types.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capabilities/token/types.rs#L23)) is not a bearer secret
that can be replayed. It carries the owner, the permission set, an expiry, a
nonce, the subject capsule id and address space id, a measurement of the
capsule, the boot session nonce, a revocation epoch, and a delegation depth.
Authenticity is a keyed MAC over all of that material.

```
  verify_token(tok)                    capabilities/token/verify.rs:24
      key      = signing key minted at boot
      material = token_material(tok, bits)        128 bytes, all fields
      computed = mac64(key, material)             two keyed BLAKE3 hashes
      return ct_eq_64(computed, tok.signature)    constant time compare
```

`mac64` is two keyed BLAKE3 hashes concatenated to 64 bytes
([`capabilities/token/material.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capabilities/token/material.rs)). The comparison is constant time
([`crypto/util/constant_time/compare.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/crypto/util/constant_time/compare.rs)) so verification does not leak the
signature through timing. Binding the token to the boot session nonce means a
token minted in one boot is worthless in the next. Revocation is a set of
`(owner, nonce)` pairs checked on every validation.

---

## 9. Syscall ABI

The boundary is the `SYSCALL` instruction. `LSTAR` is programmed during core
init to the kernel entry stub (`arch/x86_64/syscall`). Arguments follow the
System V register order, with `R10` standing in for `RCX` because `SYSCALL`
clobbers `RCX`:

```
  a0 -> RDI    a1 -> RSI    a2 -> RDX
  a3 -> R10    a4 -> R8     a5 -> R9
  return value -> RAX
```

Syscall numbers are four-character ASCII tags packed into a word, so they read
as mnemonics in a trace. The families:

```
  Crypto*     random, hash, encrypt, ed25519 verify, x25519, hmac, hkdf,
              keccak256, secp256k1 sign and recover
  Admin*      reboot, shutdown, policy push
  Graphics*   display dimensions
  Mk*         the microkernel surface: ipc, memory, spawn and exit, time,
              capabilities, device claim, mmio, irq, dma, pci config, pio,
              surfaces, and input events
```

A call travels entry stub, number lookup, contract dispatch (the capability
check from section 8), then the router that dispatches to the handler:

```
  SYSCALL  ->  syscall_handler           arch/x86_64/syscall/manager/entry.rs:22
           ->  SyscallNumber::from_u64    syscall/numbers/convert.rs
           ->  contract dispatch          syscall/contract/dispatch.rs:31   (cap gate)
           ->  router                      syscall/dispatch/router
           ->  handler                     per family
```

The exhaustive per-call table, with numbers, arguments, capability, and error
codes, is the [ABI reference](/docs/abi/). This section is the shape; that page is
the contract.

---

## 10. IPC

Capsules talk to each other and to kernel services through message passing.
There is no shared memory between capsules except surfaces, which are explicit
and brokered. An inbox is a named MPSC ring. Names are stable: `proc.<pid>` for
a process's own inbox, `endpoint.<n>` for a fixed endpoint, or a service name
registered in the service registry.

```
  IpcMessage
    from         envelope identifying the sender
    data         the payload bytes
    correlation  id used to match a reply to its call
```

The primitives (`syscall/microkernel/ipc/`):

```
  MkIpcSend       post a message to a named endpoint, do not wait
  MkIpcRecv       block on an endpoint until a message arrives or timeout
  MkIpcRecvFrom   like Recv, and also return the sender's pid
  MkIpcCall       synchronous request and reply over a private reply inbox
  MkIpcReply      reply to the caller currently pending on a private inbox
  MkIpcSendToPid  send straight to a pid's own inbox
```

`MkIpcCall` is the workhorse for client and server. It mints a private reply
inbox for the caller, pushes it onto the caller's pending-reply stack, sends the
request to the service endpoint, and blocks on the private inbox with a default
five second timeout. The server handles the request and answers with
`MkIpcReply`, which the kernel routes to that private inbox. This keeps replies
from racing across concurrent callers of the same service.

```
  client                         kernel routing                server
    |  MkIpcCall(ep, req) ----------->  mint reply inbox
    |                                   send to ep ------------>  MkIpcRecvFrom
    |  (blocked on reply inbox)                                   handle request
    |                                <----------- MkIpcReply  ----|
    |  <----- reply delivered to private inbox
    v
```

Blocking is implemented with the scheduler: a receiver with no message available
calls `sleep_until` on a deadline and yields, and the sender's delivery path can
wake it.

---

## 11. Scheduler

The scheduler is cooperative and preemptive at once. Capsules yield voluntarily
at natural wait points, and a 100 Hz timer preempts a capsule that overruns its
slice. Selection walks five priority classes in a fixed order and takes the
first class that has a runnable process
([`process/scheduler/selection/select.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/process/scheduler/selection/select.rs)):

```
  RealTime  >  High  >  Normal  >  Low  >  Idle
```

Within a class, selection is round-robin: it remembers the last pid it scheduled
(`LAST_SCHEDULED_PID`) and picks the next runnable pid after it, so no process in
a class is starved by its neighbours. The runnable set is backed by a `VecDeque`
([`scheduler/dispatch/run_queue.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/scheduler/dispatch/run_queue.rs)), appended at the back as processes become
ready. A separate deadline module exists in the tree but is not wired into this
selection path today; the live policy is the five-class priority walk above.

```
  every 10 ms:  timer IRQ -> tick()        scheduler/preemption/tick.rs:21
                  decrement the current slice
                  if it hits zero and preemption is enabled,
                    set NEED_RESCHEDULE
                  if any realtime task is runnable, set NEED_RESCHEDULE

  yield_now()                               scheduler/preemption/yield_impl.rs:22
    disable interrupts
    save context, move current Running -> Ready, back onto the runqueue
    select_next_process: the priority walk above
    switch, or stay if it is the same pid
```

Sleeping and waking ([`scheduler/dispatch/sleep.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/scheduler/dispatch/sleep.rs)):

```
  sleep_until(pid, wake_ms)       record wake time, state Sleeping, off runqueue
  wake_process(pid)               clear sleep, state Ready, back on runqueue
  check_sleeping_processes()      wake every pid whose wake time has passed
```

This is the machinery underneath IPC blocking, IRQ waiting, and the input
router. A capsule that calls `MkIpcRecv` with nothing waiting does not spin; it
sleeps until a deadline or until a delivery wakes it.

The transition into a freshly spawned capsule is a first entry: the install path
left an `iretq` frame in the PCB, and the dispatcher
([`arch/x86_64/context/switch/dispatch.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/arch/x86_64/context/switch/dispatch.rs#L39)) loads it and executes `iretq` to
drop from ring 0 to ring 3 at the capsule's ELF entry point with its user stack.
Subsequent switches restore saved user or kernel context as appropriate.

---

## 12. Hardware broker

Drivers are capsules, and a capsule cannot touch hardware directly. The kernel
exposes a narrow broker that hands out grants for the four things a driver
needs: interrupts, memory-mapped IO, DMA, and on x86_64, port IO. Every grant is
gated by first claiming the device, which establishes an ownership epoch.

```
  driver capsule                     kernel broker
    |  MkDeviceClaim(device) -------->  record owner pid + epoch
    |  <----- claim id, epoch
    |
    |  MkIrqBind(device, epoch, ...) -> verify claim and epoch
    |                                   allocate a LAPIC vector
    |                                   program the IO-APIC route
    |                                   mask the GSI, return grant + vector
    |  MkMmioMap(device, bar) -------->  vet the BAR, grant phys range
    |  MkDmaMap(buffer) ------------->  pin pages, return dma address
    |  MkPioGrant(ports) ------------>  grant a port range
```

### Interrupts

For a line-based (INTx) interrupt the broker allocates a vector from its pool
(`0x81..0xC0`), programs the IO-APIC redirection entry to deliver that vector to
the current CPU, and masks the line. Programming the route claims the GSI for
the capsule ([`arch/x86_64/interrupt/ioapic/ops_route.rs:94`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/arch/x86_64/interrupt/ioapic/ops_route.rs#L94),
`program_route_external`). GSI ownership is a per-line atomic state machine,
Free to Kernel or Free to Capsule by compare-and-swap, with release back to Free
(`ioapic/gsi_owners/`). A line owned by one capsule cannot be stolen by another.

The driver then runs an event loop on the grant:

```
  MkIrqPoll(grant)   read { seq, overflow }
                       seq increments once per delivered interrupt
                       overflow counts interrupts dropped if the driver fell behind
  MkIrqAck(grant)    I have handled up to seq N, unmask the line, deliver N+1
```

On the kernel side, the interrupt arriving on the allocated vector bumps that
grant's sequence and masks the line so it does not re-fire before the driver
acknowledges. `MkIrqAck` unmasks. This is level-safe: the line stays quiet
between the interrupt and the driver's acknowledgement.

MSI-X follows the same grant model but allocates a contiguous block of vectors
and programs the device's MSI-X table instead of an IO-APIC line. The driver
derives per-vector grant ids as `grant + i`.

### MMIO, DMA, PIO

MMIO grants vet the requested BAR against the claimed device's PCI record and
map the physical range; the capsule can only reach ranges it was granted. DMA
grants pin user pages and translate to physical addresses so a device can read
or write a driver's buffer. PIO (x86_64 only) grants a port range and brokers
`IN` and `OUT` through `MkPioRead` and `MkPioWrite`, with width validation, so a
driver cannot touch ports outside its grant.

---

## 13. Input path

Input is one of the clearest end-to-end paths in the system and a good way to
see the pieces working together. An input event is a fixed struct
([`kernel_core/surface_registry/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/kernel_core/surface_registry/types.rs)): kind, flags, code, absolute x and y,
relative deltas, and a nanosecond timestamp.

The kernel owns one multi-producer single-consumer ring
([`kernel_core/surface_registry/input_ring.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/kernel_core/surface_registry/input_ring.rs)). Many driver capsules post into
it; exactly one router capsule drains it.

```
  driver capsules                kernel input ring             input router
   kbd / mouse / hid                (MPSC, cap 1024)
        |                                                          |
        |  MkInputEventPost(ev)                                    |
        +----------------->  post_input(ev)            line :56    |
                              push to ring                         |
                              SEQ.fetch_add(1)                     |
                              wake the armed waiter ---------------+ wake_process
                                                                   |
                                                  MkInputEventWait  |  arm_input_waiter
                                                    sleep until seq |  moves, then return
                                                  MkInputEventDrain |  drain_input(), up to 64
                                                    parse and route |
                                                    via IPC to the  |
                                                    desktop shell    v
```

`post_input` takes the ring lock only long enough to copy one event, then bumps
a release-ordered sequence counter and wakes the router if one is parked. The
router blocks in `MkInputEventWait` until the sequence moves, drains a batch with
`MkInputEventDrain`, turns raw events into pointer and key events, and forwards
them over IPC to the desktop shell. The router is the single point that fans one
shared ring out to subscribers, so drivers never need to know who is listening.

---

## 14. Graphics and surface path

A surface is a framebuffer a capsule owns, described to the kernel so it can be
shared and presented. The descriptor
([`kernel_core/surface_registry/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/kernel_core/surface_registry/types.rs)) is width, height, stride in bytes,
pixel format, byte length, the capsule's virtual base address, and flags.

```
  producer capsule                 kernel surface registry        consumer / display
    |  allocate framebuffer in own VA
    |  MkSurfaceRegister(desc) ------>  translate VA to PA frames
    |                                   store in a slot, return surface id
    |                                   and a handle = (slot << 32) | epoch
    |  MkSurfaceShare(sid) ---------->  bump refcount, return a handle
    |                                       the consumer can attach
    |                                                 ------------->  MkSurfaceAttach
    |                                                                   map frames into
    |                                                                   consumer VA, return
    |                                                                   the VA and descriptor
    |  MkSurfacePresent(handle) ----->  route the framebuffer to the
    |                                   display backend, flip
    |  MkDisplayVsyncWait(0) -------->  block until the next vblank
```

Handles encode a slot index and an epoch. The epoch increments when a slot is
reused, so a stale handle to a freed surface is detected rather than silently
pointing at someone else's buffer. `MkSurfaceRegister` translates the capsule's
virtual pages to physical frames and records them, so presentation and attach
work from the kernel's record rather than trusting a raw pointer at flip time.
Vsync is a 60 Hz cadence; `MkDisplayVsyncWait` returns the next vblank deadline.

---

## 15. Crypto stack

The cryptography is in-tree, `no_std`, and split by purpose. The table below is
what each primitive is actually used for, not just what exists
(`src/crypto/`):

```
  Ed25519           classical half of capsule signatures
  ML-DSA-65         post-quantum half of capsule signatures (FIPS 204)
  BLAKE3            NØNOS-ID derivation, capsule payload (ELF) hash,
                      keyed MAC for capability tokens
  secp256k1         Ethereum-compatible signing, application layer
  Keccak256         Ethereum hashing, application layer
  Groth16 / BN254   zero knowledge proofs, application layer
  Halo2             alternative proof system, feature gated
  AES-GCM           authenticated symmetric encryption
  ChaCha20-Poly1305 authenticated symmetric encryption
```

The split worth remembering: capsule admission and capability tokens are the
critical path and use Ed25519, ML-DSA-65, and BLAKE3. The secp256k1,
Keccak256, and zero-knowledge machinery target the application layer and the
chain-facing work; they are not in the boot or spawn trust path. BN254 is the
same pairing-friendly curve used by Ethereum's alt_bn128 precompiles, so proofs
built here verify in that ecosystem.

---

## 16. Source map

Where each subsystem lives, for jumping straight into the tree:

```
  boot and init           src/nonos_main.rs, src/boot/, src/kernel_core/init/
  memory                  src/memory/  (phys, paging, unified, heap, page_allocator)
  scheduler and process   src/process/  (scheduler, core)
  syscall boundary        src/syscall/  (numbers, contract, dispatch, microkernel)
  capabilities            src/capabilities/  (types, token)
  capsule security        src/security/  (capsule_manifest, nonos_id_cert, trust_anchor)
  crypto                  src/crypto/  (asymmetric, pqc, hash, zk, symmetric, util)
  hardware broker         src/hardware/broker/  (irq, mmio, dma, pio)
  interrupt routing       src/arch/x86_64/interrupt/  (ioapic, apic)
  surfaces and input      src/kernel_core/surface_registry/
  arch x86_64             src/arch/x86_64/  (gdt, syscall, context, time)
  capsules                userland/capsule_*/  and  src/userspace/
```

This is the whole map. The pages under `abi/`, `security/`, and `subsystems/`
zoom into each box with the same standard: cite the code, draw the real shape,
no claims that the tree does not back.

## Where to go deeper

Each numbered section above has a matching deep page. The pointers below route
from a section to the page that expands it.

| Section | Deep page |
|---------|-----------|
| 4 Boot sequence | [subsystems/boot/](/docs/subsystems/boot/) |
| 5 Memory model | [subsystems/memory/](/docs/subsystems/memory/) |
| 6 The capsule, 7 Verified spawn | [security/capsules-and-trust.md](/docs/security/capsules-and-trust/), [subsystems/elf-loader/](/docs/subsystems/elf-loader/) |
| 8 Capability model | [security/capabilities-and-tokens.md](/docs/security/capabilities-and-tokens/) |
| 9 Syscall ABI | [subsystems/syscall/](/docs/subsystems/syscall/), [abi/](/docs/abi/) |
| 10 IPC | [subsystems/ipc/](/docs/subsystems/ipc/) |
| 11 Scheduler | [subsystems/scheduler/](/docs/subsystems/scheduler/), [subsystems/process/](/docs/subsystems/process/) |
| 12 Hardware broker | [subsystems/hardware-broker/](/docs/subsystems/hardware-broker/), [subsystems/interrupts/](/docs/subsystems/interrupts/) |
| 13 Input path | [subsystems/input/](/docs/subsystems/input/) |
| 14 Graphics and surface path | [subsystems/graphics/](/docs/subsystems/graphics/) |
| 15 Crypto stack | [subsystems/crypto/](/docs/subsystems/crypto/), [subsystems/proof-system/](/docs/subsystems/proof-system/) |

The [subsystems index](/docs/subsystems/) lists every deep page, and the
[security index](/docs/security/) covers the admission and enforcement
pipeline in full.
