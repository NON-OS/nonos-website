---
title: "Syscall ABI Reference"
description: "This is the contract between a capsule and the kernel."
weight: 1
---
This is the contract between a capsule and the kernel. Every privileged action a
capsule can take goes through one of these calls, and every call is gated by the
capability check described in [the capability model](/docs/security/capabilities-and-tokens/).
The authoritative tables in the source are [`src/syscall/numbers/defs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/numbers/defs.rs) for the
numbers and [`src/syscall/contract/cap_table/mk.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/mk.rs) for the capability each call
requires. This page mirrors them and explains the semantics.

---

## Calling convention

The boundary is the `SYSCALL` instruction on x86_64. The kernel entry stub is
installed into the `LSTAR` MSR during core init
(`src/arch/x86_64/syscall`). Arguments follow the System V AMD64 order, with one
substitution: `SYSCALL` overwrites `RCX` with the return address, so the fourth
argument travels in `R10` rather than `RCX`.

```
  argument    register
  ---------   --------
  a0          RDI
  a1          RSI
  a2          RDX
  a3          R10        (SYSV would use RCX; SYSCALL clobbers it)
  a4          R8
  a5          R9
  return      RAX
```

Return values are an `i64`. Non-negative values are success (often a length, a
pid, a handle, or a count). Negative values are errors; their magnitude is one
of the errno constants in `src/syscall`. The common ones:

```
  EPERM       capability denied, or not the owner of a grant
  EFAULT      a user pointer argument was not readable or writable
  ENOENT      the named endpoint, service, or object does not exist
  ETIMEDOUT   a blocking call reached its deadline with no event
  ENOMEM      a ring or table was full, or allocation failed
  EINVAL      an argument was out of range or malformed
```

On aarch64 and riscv64 the same numbers and argument positions apply through
those architectures' supervisor-call instructions; the syscall entry path is one
of the primitives moving behind the arch boundary as those backends mature.

## Number encoding

Syscall numbers are four-character ASCII tags packed into a word
([`src/syscall/abi/tag.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/abi/tag.rs)). The tags read as mnemonics in a trace, which is the
point: `MISD` is an IPC send, `MIRB` is an IRQ bind, `MSPR` is a surface
present. The tables below give the tag for each call. The exact packed integer
is derived from the tag and is not something a caller writes by hand; the
`nonos_libc` bindings wrap each call by name.

## Capability gating

Before a handler runs, `dispatch` resolves the required capability and denies
with `EPERM` if the caller's token does not hold it
([`src/syscall/contract/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/dispatch.rs#L31)). The "Cap" column below names the
capability bit required. A handful of calls require only a valid token and no
specific bit; those are marked "valid token". Calls that operate on a broker
grant additionally check that the caller owns the grant, and return `EPERM` if
not, independent of the capability bit.

---

## Process and time

| Tag | Call | Cap | Semantics |
|-----|------|-----|-----------|
| MSPN | MkSpawn | IPC | Spawn a process. Used by the supervisor and by capsules permitted to launch children. |
| MEXT | MkExit | valid token | Terminate the calling capsule. Does not return. |
| MPAL | MkPidAlive | valid token | Report whether a given pid is still alive. |
| MYLD | MkYield | valid token | Voluntarily yield the CPU to the scheduler. |
| MTMS | MkTimeMillis | valid token | Unix-epoch milliseconds, derived from the RTC boot time plus elapsed TSC. Monotonic, returned as an `i64`. |
| MTRT | MkTimeRtc | valid token | Broken-down wall-clock time read from the RTC, written to a caller-supplied struct. |
| MBAT | MkBatteryStatus | valid token | Battery state, where the platform reports one. |

`MkTimeMillis` returns a signed value; clients that store it must use `i64`, not
`u64`, or wrapping comparisons break.

## Memory

| Tag | Call | Cap | Semantics |
|-----|------|-----|-----------|
| MMAP | MkMmap | Memory | Map a region into the calling capsule's address space. |
| MUMP | MkMunmap | Memory | Unmap a previously mapped region. |

## Capabilities

| Tag | Call | Cap | Semantics |
|-----|------|-----|-----------|
| MCGT | MkCapGrant | IPC | Delegate a subset of held capabilities to another capsule. Delegation depth is bounded by the token. |
| MCRV | MkCapRevoke | IPC | Revoke a previously granted capability. |
| MCCK | MkCapCheck | valid token | Test whether the caller holds a given capability without performing an action. |

## IPC

| Tag | Call | Cap | Semantics |
|-----|------|-----|-----------|
| MISD | MkIpcSend | IPC | Post a message to a named endpoint and return without waiting. |
| MIRC | MkIpcRecv | IPC | Block on an endpoint until a message arrives or the timeout expires. |
| MIRF | MkIpcRecvFrom | IPC | As `MkIpcRecv`, and also write the sender's pid to a caller-supplied pointer. |
| MICL | MkIpcCall | IPC | Synchronous request and reply over a private per-caller reply inbox. |
| MIRY | MkIpcReply | IPC | Reply to the caller currently pending on a private inbox. |
| MISP | MkIpcSendToPid | IPC | Send directly to a process's own inbox by pid. |
| MSVL | MkServiceLookup | IPC | Resolve a service name to an endpoint. |
| MSVR | MkServiceRegister | IPC | Register the calling capsule under a service name. |

`MkIpcCall` argument shape is `(endpoint, req_ptr, req_len, resp_ptr, resp_len,
timeout_ms)`. A `timeout_ms` of zero means use the default of five seconds. The
return is the reply length on success. See [the IPC subsystem
page](/docs/subsystems/ipc/) for the routing and blocking detail.

## Devices and the hardware broker

| Tag | Call | Cap | Semantics |
|-----|------|-----|-----------|
| MDLS | MkDeviceList | DeviceEnum | Enumerate devices visible to the broker. |
| MDCL | MkDeviceClaim | Driver | Claim a device, establishing an ownership epoch used by all later grants. |
| MDRL | MkDeviceRelease | Driver | Release a claimed device and invalidate its grants. |
| MMMP | MkMmioMap | Mmio | Map a claimed device's BAR into the caller's address space. |
| MMUM | MkMmioUnmap | Mmio | Unmap a brokered MMIO range. |
| MIRB | MkIrqBind | Irq | Bind an interrupt (INTx GSI or MSI-X). Returns a grant id and a vector. |
| MIRU | MkIrqUnbind | Irq | Release an interrupt grant. |
| MIRP | MkIrqPoll | Irq | Read `{ seq, overflow }` for an IRQ grant. `seq` advances once per delivered interrupt. |
| MIRA | MkIrqAck | Irq | Acknowledge interrupts up to the last seen `seq` and unmask the line. |
| MIRW | MkIrqWait | Irq | Reserved. The number exists; there is no handler yet. Drivers poll today. |
| MDMM | MkDmaMap | Dma | Pin a buffer and return a DMA address for a claimed device. |
| MDMU | MkDmaUnmap | Dma | Release a DMA mapping. |
| MPCR | MkPciConfigRead | Driver | Read a claimed device's PCI configuration space. |
| MPCW | MkPciConfigWrite | Driver | Write a claimed device's PCI configuration space. |

`MkIrqBind` takes `(device_id, claim_epoch, irq_source, flags, vector_count,
out_ptr)` and writes an `{ grant_id, vector }` pair to `out_ptr`. `flags` selects
INTx or MSI-X. The broker programs the IO-APIC route on x86_64 and masks the
line until the first `MkIrqAck`. The full flow is on [the broker
page](/docs/subsystems/hardware-broker/) and [the interrupt
page](/docs/subsystems/interrupts/).

`MkIrqWait` is documented as reserved on purpose. The number is allocated and the
`nonos_libc` binding exists, but there is no kernel handler, so drivers use the
poll-and-ack loop. This is called out so nobody wires a driver against a wait
that silently never fires.

## Port IO (x86_64 only)

| Tag | Call | Cap | Semantics |
|-----|------|-----|-----------|
| MPGT | MkPioGrant | Pio | Grant a port range for a claimed device. |
| MPRD | MkPioRead | Pio | Execute `IN` on a granted port, with width validation. |
| MPWR | MkPioWrite | Pio | Execute `OUT` on a granted port, with width validation. |
| MPRL | MkPioRelease | Pio | Release a port grant. |

These are compiled only on x86_64. The PIO broker module is gated by
`#[cfg(target_arch = "x86_64")]` ([`src/hardware/broker/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/hardware/broker/mod.rs)). The aarch64 and
riscv64 backends have no port IO; their devices are reached through MMIO grants.

## Surfaces and display

| Tag | Call | Cap | Semantics |
|-----|------|-----|-----------|
| MSRG | MkSurfaceRegister | GraphicsSurfaceCreate | Register a framebuffer the caller owns. Returns a surface id and a handle. |
| MSSH | MkSurfaceShare | GraphicsSurfaceCreate | Share a registered surface to another capsule. |
| MSAT | MkSurfaceAttach | GraphicsSurfaceMap | Map a shared surface into the caller's address space. |
| MSRL | MkSurfaceRelease | GraphicsSurfaceCreate | Release a surface. |
| MSPR | MkSurfacePresent | GraphicsPresent | Present a surface to the display backend. |
| MDVW | MkDisplayVsyncWait | GraphicsDisplayQuery | Block until the next vblank. Returns the vblank deadline. |
| GDIM | GraphicsDisplayDimensions | GraphicsDisplayQuery | Report the display width and height. |

A handle is `(slot_index << 32) | epoch`. The epoch detects reuse of a freed
slot. The whole surface lifecycle is on [the graphics
page](/docs/subsystems/graphics/).

## Input events

| Tag | Call | Cap | Semantics |
|-----|------|-----|-----------|
| MIEP | MkInputEventPost | InputSource | A driver posts one input event into the kernel ring. |
| MIED | MkInputEventDrain | IPC | Drain a batch of events from the ring, up to 64 per call. |
| MIEW | MkInputEventWait | IPC | Block until the ring sequence advances past a given value. |

Only one capsule, the input router, drains and waits; many drivers post. The
posting side needs `InputSource`. The path from a key press to the desktop shell
is on [the input page](/docs/subsystems/input/).

## Cryptography

The kernel exposes its crypto primitives as syscalls so capsules do not carry
their own implementations. Each maps to a primitive in `src/crypto`.

| Tag | Call | Semantics |
|-----|------|-----------|
| CRND | CryptoRandom | Fill a buffer with kernel CSPRNG output. |
| CHSH | CryptoHash | Hash a buffer (SHA family). |
| CENC | CryptoEncrypt | Symmetric encryption. |
| CDEC | CryptoDecrypt | Symmetric decryption. |
| CEDV | CryptoEd25519Verify | Verify an Ed25519 signature. |
| CXPK | CryptoX25519Public | Derive an X25519 public key. |
| CXSH | CryptoX25519Shared | Compute an X25519 shared secret. |
| CHMC | CryptoHmacSha256 | HMAC-SHA256. |
| CHKF | CryptoHkdfSha256 | HKDF-SHA256 key derivation. |
| CKEC | CryptoKeccak256 | Keccak-256, Ethereum hashing. |
| CSKS | CryptoSecp256k1Sign | secp256k1 sign, Ethereum signing. |
| CSPB | CryptoSecp256k1Pubkey | secp256k1 public key recovery. |

See [the crypto page](/docs/subsystems/crypto/) for what each primitive is used
for inside the system versus exposed for application use.

## Administration

| Tag | Call | Cap | Semantics |
|-----|------|-----|-----------|
| ARBT | AdminReboot | Admin | Reboot the machine. |
| ASDN | AdminShutdown | Admin | Power off. |
| APPS | AdminPolicyPush | Admin | Push an updated capability policy. |

The `Admin` capability is held by almost nothing. It is the most dangerous bit
in the system and the trust anchor ceiling on most certificates excludes it.

---

## Security analysis

The whole point of routing every privileged action through this table is that
there is exactly one gate. `dispatch` resolves the required capability for the
number and denies with `EPERM` before the handler ever runs
([`src/syscall/contract/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/dispatch.rs#L31)), so a capsule cannot reach the body of a
call it is not entitled to make. The capability the call needs is not a property
of the caller's intent; it is a property of the number, fixed in
[`src/syscall/contract/cap_table/mk.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/cap_table/mk.rs), and the caller's token either holds the
bit or it does not.

The bits themselves are a small closed set. There are twenty-two capabilities
([`src/capabilities/types.rs:81`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L81)), each one a single bit in a `u64`
([`src/capabilities/types.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L54)), and a capsule's token carries only the bits its
verified manifest asked for. That is what makes the table a least-privilege
surface rather than a menu: a capsule that declared only `IPC` and `Memory` can
send messages and map its own memory, and every device, surface, admin, and
input-source call in this document returns `EPERM` for it at the gate. The four
broker-authority bits (`Driver`, `Mmio`, `Irq`, `Dma`, and `Pio` on x86_64) are
split deliberately so that holding one does not imply the others; a driver that
needs to map a BAR but never takes an interrupt carries `Mmio` and not `Irq`.

Two calls are more dangerous than their neighbors and are worth naming.
`MkCapGrant` delegates a subset of the caller's own bits to another capsule, and
the delegation depth is bounded by the token, so authority cannot be laundered
into an unbounded chain. The three `Admin` calls, reboot, shutdown, and policy
push, sit behind the one bit that almost nothing holds; the trust anchor ceiling
on most certificates excludes it, so a compromised application capsule cannot
reach them even by asking.

There is a second check the capability bit does not cover. A call that operates
on a broker grant, an MMIO unmap, an IRQ poll, a DMA unmap, additionally verifies
that the caller owns the grant it named and returns `EPERM` if not, independent of
the capability bit. Holding `Irq` lets a capsule bind interrupts; it does not let
it poll a grant id that belongs to another capsule. The grant is the object, the
capability is the class of action, and both are checked.

## Debugging the boundary

When a call returns `EPERM`, two things could have happened: the token did not
hold the required capability, or, for a grant-scoped call, the caller is not the
owner of the grant it named. The kernel logs the denial on the deny path
([`src/syscall/contract/dispatch.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/contract/dispatch.rs)). When debugging a driver that gets `EPERM`
on `MkIrqPoll`, check both that the manifest declared `Irq` and that the poll
names the grant id the bind returned, not a different one.

`ENOSYS` (-38) is a different failure and easy to confuse with a denial: it means
the number had no handler, not that the caller was refused. `MkIrqWait` is the
call to watch for here. The number is allocated (`MIRW` at
[`src/syscall/numbers/defs.rs:80`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/numbers/defs.rs#L80)) and the `nonos_libc` binding exists, but there
is no kernel handler, so a driver wired against a wait rather than the poll-and-ack
loop gets `ENOSYS` and never makes progress. The rest of the negative returns are
in [the error page](/docs/abi/errors/); the ones a capsule sees most at this boundary are
`EPERM` at the gate, `EFAULT` on a bad user pointer, and `ENOENT` from a service
lookup that did not resolve.

Because the numbers are four-character ASCII tags, a syscall trace reads as
mnemonics: `MISD` is a send, `MIRB` is an IRQ bind, `MSPR` is a surface present.
That is the fastest way to see what a capsule is actually doing against the
kernel, and it is why the tags were chosen to be legible rather than dense.

## Source map

```
  src/syscall/numbers/defs.rs        every SyscallNumber and its four-char tag
  src/syscall/contract/cap_table/mk.rs  the capability each number requires
  src/syscall/contract/dispatch.rs   the gate: resolve the cap, deny with EPERM
  src/capabilities/types.rs          the 22 Capability bits and their u64 values
  src/syscall/abi/tag.rs             the tag4 packing behind each number
```

Every tag, capability, and semantic in the tables above is mirrored from those
files. The grant-ownership half of the `EPERM` check lives on the
[hardware broker page](/docs/subsystems/hardware-broker/); the errno
magnitudes are on [the error page](/docs/abi/errors/).
