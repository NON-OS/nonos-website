---
title: "The Message Envelope and Integrity"
description: "A routed message is carried in one structure, IpcMessage, and each one carries a keyed MAC computed over its own fields."
weight: 3
---
A routed message is carried in one structure, `IpcMessage`, and each one carries a keyed MAC
computed over its own fields. This page documents the envelope, the boot-time key that keys
the MAC, and the integrity check. The code is under `src/ipc/nonos_channel/`, whose live
surface is exactly the envelope (`message`), the MAC (`hash`), and the error type.

## The envelope

`IpcMessage` ([`src/ipc/nonos_channel/message.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ipc/nonos_channel/message.rs#L26)) is the on-the-wire form every routed
message takes:

```
  struct IpcMessage {
      from:         String,     // "proc.<pid>", stamped by the kernel
      to:           String,     // destination inbox name
      data:         Vec<u8>,
      timestamp_ms: u64,
      correlation:  u64,        // request/reply matching
      checksum64:   u64,        // keyed MAC, private field
  }
```

`new` (`message.rs:36`) rejects a payload larger than `MAX_MESSAGE_SIZE = 1 MiB`, stamps
the current millisecond timestamp, and computes the MAC before the message exists; there is
no way to construct an `IpcMessage` without a valid MAC over its contents, because
`checksum64` is private and set only in the constructors. `from` and `to` are set by the
routing layer, not by the sending capsule, so the sender identity in the envelope is the
kernel's attestation of who sent it.

## The MAC key

Integrity is keyed, not a bare hash, so it is seeded once at boot. `init_ipc_secret`
([`src/ipc/nonos_channel/hash.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ipc/nonos_channel/hash.rs#L25)) draws 32 bytes from the secure RNG, derives a key from
them with a domain-separated BLAKE3 derive-key, and stores it in a `Once`:

```
  init_ipc_secret():
      bytes = get_bytes_secure(32)               else "rng failed to seed IPC MAC key"
      key   = blake3::new_derive_key("NØNOS:IPC:SECRET:v1").update(bytes).finalize()
      IPC_SECRET.call_once(|| key)
```

This runs during kernel init ([`src/kernel_core/init/entry.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/init/entry.rs#L36)) and is **fatal on
failure**: if the RNG cannot seed the MAC key, the kernel does not continue with an
unkeyed IPC path. Every later MAC pulls the key through `get_ipc_secret`, which errors if
the key was never initialized, so a MAC can never be computed against a zero or absent key.

## The MAC

`compute_checksum` (`hash.rs:63`) is a keyed BLAKE3 MAC over the message's own fields, with
a domain-separation tag and a field separator so distinct messages cannot collide by
concatenation:

```
  mac = blake3::new_keyed(secret)
          .update("NØNOS:IPC:MAC:v1")
          .update(from) .update(0xF0) .update(to)
          .update(timestamp_ms.le_bytes())
          .update(data)
          .finalize()
  checksum64 = last 8 bytes of mac, little-endian
```

The MAC binds the sender, the destination, the timestamp, and the payload together under
the boot secret. `validate_integrity` (`message.rs:72`) recomputes the MAC over the
current fields and compares; the comparison folds the difference into a single word and
tests it against zero in one step rather than short-circuiting byte by byte
(`hash.rs:83`), so the check does not leak where a forged MAC first diverges.

## Honest scope

The MAC is a sixty-four-bit tag, a deliberate size for an in-kernel integrity and
anti-corruption check rather than a full-width authentication tag against an adversary with
online forgery attempts; its job is to detect a corrupted or malformed envelope, and it is
keyed under the per-boot secret so the tag cannot be precomputed across boots. The envelope
travels inside the kernel between kernel-managed inboxes, so the transport itself is not an
untrusted channel; the MAC is defense in depth on the message structure, and the sender
identity guarantee comes from the kernel stamping `from`, not from the MAC alone.

## Security analysis

The envelope is the one structure every routed message becomes, so its guarantees are the guarantees
of the message layer. Three properties hold it, and one boundary is worth stating plainly.

**The sender field is the kernel's, not the sender's.** `from` is written by the routing layer as
`proc.<caller_pid>` when it builds the message ([`src/ipc/kernel_ipc.rs:74`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ipc/kernel_ipc.rs#L74)), never taken from the
sending capsule. A capsule cannot construct an `IpcMessage` at all with a `from` of its choosing,
because the constructor is the only way to make one and the [routing](/docs/subsystems/ipc/routing/) path is the only
caller that supplies the fields. So the receiver reads the sender identity as the kernel's attestation
of who sent the message, and a capsule cannot forge a message that appears to come from another.

**No message exists without a valid MAC.** `checksum64` is a private field set only inside `new`
(`message.rs:36`), which computes the keyed MAC before the value is returned. There is no path that
builds an `IpcMessage` and skips the MAC, and there is no setter, so a message on any inbox carries a
tag over its own `from`, `to`, `timestamp_ms`, and `data`. `validate_integrity` (`message.rs:72`)
recomputes and compares by folding the difference into one word and testing it against zero in a single
step (`hash.rs:83`), so the check does not leak where a forged tag first diverges.

**The key is per-boot and fatal to miss.** `init_ipc_secret` (`hash.rs:25`) derives the MAC key from
32 secure-RNG bytes through a domain-separated BLAKE3 derive-key and is fatal on RNG failure at init
([`src/kernel_core/init/entry.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/init/entry.rs#L36)): the kernel does not continue with an unkeyed IPC path. Every MAC
pulls the key through `get_ipc_secret`, which errors if it was never set, so a tag can never be computed
against a zero or absent key, and a tag captured on one boot cannot be replayed as valid on the next.

The honest boundary is the tag width and what the MAC does not do. `checksum64` is sixty-four bits, a
deliberate size for an in-kernel integrity and anti-corruption check rather than a full-width
authentication tag against an adversary with online forgery attempts. The envelope travels inside the
kernel between kernel-managed inboxes, so the transport is not itself an untrusted channel; the MAC is
defense in depth on the structure. The load-bearing sender guarantee is the kernel stamping `from`, not
the MAC. And the MAC binds the fields to each other and to the boot secret, but it does not by itself
authorise the route: whether a caller may reach a destination at all is the capability check on the
[routing](/docs/subsystems/ipc/routing/) path, not anything the envelope carries.

## Debugging the envelope

The envelope has two failure surfaces, and they surface very differently. Construction fails when the
payload is too large: `new` (`message.rs:36`) rejects a `data` longer than `MAX_MESSAGE_SIZE = 1 MiB`,
which propagates as the `ChannelError` (`error.rs`) that the routing path maps to `ENOMEM` (`-12`) at
`kernel_route_ipc_corr` (`kernel_ipc.rs:79`). If a send returns `-12` and the buffer was not oversize
at the syscall's own `MAX_MESSAGE_SIZE` check (`send.rs:55`), the construction was the thing that
refused it, which in practice means the transient kernel allocation for the message failed. Integrity
fails when `validate_integrity` returns false on a dequeued message: because `from`, `to`,
`timestamp_ms`, and `data` are all covered, a mismatch means one of them changed after the MAC was
computed, which inside a single boot is memory corruption rather than an ordinary bad message, since the
key cannot have changed. A tag that verifies under this boot's key but not a prior capture is the
per-boot re-key working as intended, not a fault. There is no separate errno for an integrity failure at
the send path because the MAC is checked on the receiving side, so the tell is a message that routed
cleanly but a drainer rejected.

## Source map

```
  src/ipc/nonos_channel/message.rs   IpcMessage, MAX_MESSAGE_SIZE, new, validate_integrity
  src/ipc/nonos_channel/hash.rs      init_ipc_secret, compute_checksum, the constant-time compare
  src/ipc/nonos_channel/error.rs     ChannelError
  src/kernel_core/init/entry.rs      the fatal boot-time seed of the MAC key
  src/ipc/kernel_ipc.rs              where new is called and from is stamped, ChannelError -> ENOMEM
```

Every reference above is verified against those trees. The `from` stamp and the capability check that
actually authorises a route are on the [routing](/docs/subsystems/ipc/routing/) page, the inboxes these messages land in
are on the [inbox](/docs/subsystems/ipc/inbox/) page, and the `MAX_MESSAGE_SIZE` bound is enforced a second time at the
send syscall documented on [routing](/docs/subsystems/ipc/routing/).
