---
title: "Syscall Numbers"
description: "Syscall numbers in NØNOS are not opaque integers; they are four-character ASCII tags packed into a word, so that a syscall reads as a mnemonic in a register dump or a trace."
weight: 3
---
Syscall numbers in NØNOS are not opaque integers; they are four-character ASCII tags
packed into a word, so that a syscall reads as a mnemonic in a register dump or a trace.
This page documents the tag encoding, how a raw number is decoded to a typed syscall, and
the families the numbers fall into. The code is under `src/syscall/abi/` and
`src/syscall/numbers/`.

## The tag encoding

A tag is four ASCII bytes packed little-endian into a `u64` ([`src/syscall/abi/tag.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/abi/tag.rs#L20)):

```
  tag4(b) = b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)
```

The first byte occupies the lowest eight bits, so `tag4(b"MDBG")` is a `u64` whose bytes
read back as `MDBG` when dumped at low memory. That is the whole point: a capsule that
invoked `MDBG` shows `MDBG` in a trace rather than a number a reader would have to look
up. The tags are constructed with this `const fn`, so the numbering lives in one place and
cannot drift.

## Decoding

The raw `u64` from `RAX` is turned into a typed `SyscallNumber` by `from_u64`
([`src/syscall/numbers/convert.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/numbers/convert.rs#L22)), which is a lookup:

```
  SyscallNumber::from_u64(id) = abi::lookup_id(id)
```

`lookup_id` maps a known tag to its `SyscallNumber` enum variant and returns `None` for a
value that is not a registered syscall. A `None` is what the [boundary](/docs/subsystems/syscall/boundary/)
turns into `ENOSYS`, so only a tag that decodes to a real syscall proceeds past the
entry. The enum is the authoritative registry; the tag is its wire encoding.

## The families

The tags group by their leading letters into families, and the [router](/docs/subsystems/syscall/router/)
dispatches on them:

```
  Crypto*    random, hash, encrypt and decrypt (with and without AAD),
             ed25519 verify, x25519 public and shared, hmac-sha256,
             hkdf-sha256, keccak256, secp256k1 sign and pubkey
  Admin*     reboot, shutdown, policy push
  Graphics*  display dimensions
  Mk*        the microkernel surface: ipc, memory, spawn and exit, threads,
             time, capabilities (grant, revoke, check), device claim,
             mmio, irq, dma, pci config, pio, surfaces, and input events
```

The `Mk` family is the microkernel proper, the calls that only the kernel can perform:
message passing, memory mapping, process spawn and exit, the hardware broker grants, and
the surface and input paths. The `Crypto` family is the in-kernel cryptographic
primitives, and `Admin` is the small set of privileged control operations. Each family
maps to a required capability, documented on the
[capabilities page](/docs/security/capabilities-and-tokens/).

## The exhaustive reference

This page is the shape of the numbering. The exhaustive per-call contract, every syscall
with its number, arguments, required capability, and error codes, is the
[ABI reference](/docs/abi/syscalls/), which is generated to match the enum so the two
cannot disagree.

## Security analysis

The numbering is the wire encoding of the syscall surface, and its security value is that it is a closed,
enumerated registry rather than an open integer space. That closure is what lets the boundary reject a
malformed call before any state is touched.

**An unregistered tag decodes to nothing, so it can never select a handler.** `from_u64`
([`src/syscall/numbers/convert.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/numbers/convert.rs#L22)) is `abi::lookup_id(id)`, a lookup that returns a `SyscallNumber` enum
variant for a known tag and `None` for everything else. There is no arithmetic from the raw `u64` to a
handler and no table indexed by the untrusted value, so a capsule cannot craft a number that runs off the
end of a jump table or aliases into a handler it was not meant to reach. The [boundary](/docs/subsystems/syscall/boundary/) turns
that `None` into `ENOSYS` at `entry.rs` before the contract or any handler runs.

**The enum is the single registry the rest of the system matches against.** Because the capability
cap-table (`src/syscall/contract/cap_table/`) and the router ([`src/syscall/dispatch/router/dispatch_fn.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/router/dispatch_fn.rs))
both match on `SyscallNumber` variants, not on raw tags, the set of callable syscalls, the set with a
required capability, and the set the router services are all keyed off one enum. A new syscall that is
added to the enum but not given a cap-table entry is refused by the cap-table's trailing `unwrap_or(false)`
([`cap_table/mod.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/cap_table/mod.rs#L30)), so the failure mode of a half-wired syscall is denial, not an unguarded call.

The honest limit is that the tag is not a secret or a capability. It is a public, stable identifier; the
authority to call a syscall lives entirely in the capability token checked at the contract, not in
knowing or guessing the number. The four-character encoding is a readability and stability convenience, and
nothing about the boundary's safety depends on the tags being hard to discover.

## Debugging syscall numbers

The tag encoding exists precisely to make a trace legible, and that is its main debugging value. Because
`tag4` ([`src/syscall/abi/tag.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/abi/tag.rs#L20)) packs the four ASCII bytes little-endian into the word, a syscall
number dumped at low memory reads back as its mnemonic: a call to `MDBG` shows the bytes `MDBG`, not an
opaque integer a reader has to look up. So a register dump that shows the value in `RAX` at the `SYSCALL`
site can be read directly as the syscall being attempted.

The one failure this page is responsible for is `ENOSYS`. If a capsule gets `-ENOSYS` (38) back, the number
in `RAX` did not decode, and there are two shapes of that bug. Either the capsule built the tag wrong (a
byte-order or typo in the four characters), in which case the value dumped will not read as any known
mnemonic, or the capsule is calling a syscall that exists in a newer or older enum than the running kernel
was built with, in which case the mnemonic reads fine but `lookup_id` still returns `None`. The tool for
telling these apart is exactly the readability property above: dump the value, read the four bytes. If they
spell a real mnemonic the caller's encoding is fine and the mismatch is a registry-version problem; if they
spell garbage the caller assembled the tag incorrectly. This is distinct from an `ENOSYS` returned by the
[router](/docs/subsystems/syscall/router/), where the tag decoded to a real `SyscallNumber` but no family claimed it, which is a
kernel-side routing omission rather than a caller-side encoding error.

## Source map

```
  src/syscall/abi/tag.rs         tag4, the four-character little-endian encoding
  src/syscall/abi/               lookup_id and the tag-to-variant registry
  src/syscall/numbers/defs.rs    the SyscallNumber enum, the authoritative registry
  src/syscall/numbers/convert.rs from_u64
```

Every reference above is verified against those trees. The decode-to-`ENOSYS` step is on the
[boundary](/docs/subsystems/syscall/boundary/) page, the family dispatch on the decoded variant is on the [router](/docs/subsystems/syscall/router/)
page, and the exhaustive per-call contract with numbers, arguments, and error codes is the
[ABI reference](/docs/abi/syscalls/).
