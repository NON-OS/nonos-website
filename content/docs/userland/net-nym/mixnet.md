---
title: "The Sphinx Route Header"
description: "This page documents the layered route header that occupies bytes 56 through 364 of every wire packet: the route seed, the ephemeral X25519 key, the per-hop shared secret and key..."
weight: 5
---
This page documents the layered route header that occupies bytes 56 through 364 of every wire packet: the
route seed, the ephemeral X25519 key, the per-hop shared secret and key schedule, the per-hop MAC block, and
the reverse HKDF onion masking that layers the header. It mirrors `src/route/`. The packet this header lives
inside is on the [packet](/docs/userland/net-nym/packet/) page; the nodes it routes over come from the signed directory on the
[directory](/docs/userland/net-nym/directory/) page. This is a Sphinx-style construction built on the capsule's own primitives,
not a port of an external Sphinx library, and this page describes exactly what the code does rather than what
a reference Sphinx does.

## Where it fits

`packet::encode` calls `route::build` to fill the header tail ([`src/packet/encode.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/packet/encode.rs#L62)), and `route::build`
is a three-step pipeline ([`src/route/header.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/header.rs#L24)):

1. Derive a 32-byte route seed from the session key, credential, session id, and flags ([`route/seed.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route/seed.rs#L22)).
2. Ask the topology layer to select a five-hop route from that seed ([`route/header.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route/header.rs#L31), on the
   [directory](/docs/userland/net-nym/directory/) page).
3. Build the layered header over those hops ([`route/sphinx/build.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route/sphinx/build.rs#L23)).

The output is `ROUTE_HEADER_LEN` bytes, defined as `HEADER_LEN - OFF_HEADER_RANDOM`, that is `365 - 56 = 309`
([`src/route/sphinx/types.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/sphinx/types.rs#L19)). A route-selection failure becomes `PacketError::NoRoute`
([`route/header.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/route/header.rs#L31)), which the send handler maps to `E_NO_ROUTE`.

## The route seed

The seed binds the route to the sending session so the same datagram from a different session takes a
different-looking header. `route_seed` concatenates the 32-byte session key, the 32-byte credential material,
the little-endian session id, and the flags byte, and hashes the 69-byte material to 32 bytes with BLAKE3
([`src/route/seed.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/seed.rs#L22)). The seed feeds two things: the topology selector uses its bytes to pick a node at
each layer ([`src/topology/select.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/select.rs#L44)), and the per-hop key schedule and masking mix it in so the layering
is deterministic from the seed but unpredictable without the session key.

## The header layout

The header is a 34-byte prefix followed by five equal hop blocks ([`src/route/sphinx/build.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/sphinx/build.rs#L32)):

```
  offset  size   field                                types.rs / build.rs
  0       32     ephemeral X25519 public key          EPK_LEN:20, build.rs:35
  32      1      version = 1                          build.rs:36
  33      1      hop count = ROUTE_HOPS (5)           build.rs:37
  34      55     hop block 0                          PREFIX_LEN:21, HOP_BYTES:22
  89      55     hop block 1
  ...
  254     55     hop block 4
```

`PREFIX_LEN` is 34 and `HOP_BYTES` is `(ROUTE_HEADER_LEN - PREFIX_LEN) / ROUTE_HOPS`, that is
`(309 - 34) / 5 = 55` ([`src/route/sphinx/types.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/sphinx/types.rs#L21)). `ROUTE_HOPS` is 5, fixed by the topology layer
([`src/topology/types.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/topology/types.rs#L22)).

## The ephemeral key and the per-hop secrets

The builder draws one fresh 32-byte X25519 private key from `crypto_random`, computes its public key, and
writes that public key into the first 32 bytes of the header ([`src/route/sphinx/build.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/sphinx/build.rs#L30)). This single
ephemeral key is the sender's contribution to every hop's shared secret. For each of the five hops,
`blocks::write` computes the X25519 shared secret between the ephemeral private key and that node's published
`packet_key`, then derives the hop key from it ([`src/route/sphinx/blocks.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/sphinx/blocks.rs#L34)):

```
  shared_i   = X25519(ephemeral_private, node_i.packet_key)
  hop_key_i  = HKDF-SHA256(salt = credential, ikm = shared_i,
                           info = "NØNOS-NYM-SPHINX-HOP-v1" || seed || i)
```

The hop key derivation is in [`src/route/sphinx/key.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/sphinx/key.rs#L24): the credential is the salt, the X25519 shared
secret is the input keying material, and the info string binds the label, the route seed, and the hop index.
Each shared secret is zeroized after the hop key is derived (`blocks.rs:46`). This is a simplification of a
full Sphinx key schedule: it uses a single ephemeral key across all hops with the per-hop shared secret
derived from each node's static key, and it does not blind the ephemeral key between hops the way canonical
Sphinx does. It is honest to call it Sphinx-style layered routing rather than a bit-exact Sphinx.

## The per-hop MAC block

Inside its 55 bytes, each hop block carries a MAC and the routing fields the hop needs to forward
([`src/route/sphinx/hop.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/sphinx/hop.rs#L26)):

```
  offset  size  field
  0       32    HMAC-SHA256 over the routing fields, keyed by hop_key
  32      2     delay_ms
  34      4     next-hop IP
  38      2     next-hop port
  40      1     role id (1 entry, 2 mix, 3 exit)
  41      1     layer
  42      13    first 13 bytes of the node identity
```

The MAC covers the session id, flags, hop index, the full 32-byte node identity, the node IP, port, and
delay, keyed by that hop's derived key (`hop.rs:41`). It is the integrity tag a real gateway or mix would
check to confirm the header was built by someone who shares the per-hop key, and it binds the routing to the
session and hop position so a block cannot be lifted into another packet or reordered.

## The reverse onion masking

After every hop block is written in the clear, the builder masks them in reverse order, innermost hop first,
so that on the wire each layer is wrapped by the layers outside it ([`src/route/sphinx/build.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/sphinx/build.rs#L40)). For hop
index `i` from 4 down to 0, `mask::apply` XORs that hop's 55-byte region with an HKDF-derived keystream
([`src/route/sphinx/mask.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/route/sphinx/mask.rs#L24)):

```
  mask_i = HKDF-SHA256(salt = seed, ikm = hop_key_i,
                       info = "NØNOS-NYM-SPHINX-MASK-v1" || seed || i)
  region_i ^= mask_i
```

Applying the masks from the innermost hop outward is what gives the header its onion structure: a hop that
knows only its own key can strip its own layer to reveal the next, but cannot read the layers still wrapped
beneath it. The keystream is the exact length of the region it masks, and it is zeroized after use
(`mask.rs:35`). On any masking error the builder still zeroizes the ephemeral private key, the public key, and
every hop key before returning, so key material never survives a failure path (`build.rs:47`).

## What is real and what is simplified

The construction is real code that runs: it makes genuine X25519, HKDF, HMAC, and BLAKE3 syscalls, it
produces a fixed-size layered header bound to a session and a signed directory, and the [packet](/docs/userland/net-nym/packet/)
seal and [state](/docs/userland/net-nym/state/) replay window sit on top of it. It is a faithful mixnet header in shape, layered
per-hop MACs under reverse onion masking keyed by per-hop X25519 secrets. It is a simplification of canonical
Sphinx in two respects worth stating plainly: it reuses one ephemeral key across all hops instead of blinding
it hop to hop, and there is no in-tree mix node that strips and forwards these headers, so the forwarding side
is defined by the format rather than exercised by a NØNOS mix. The capsule builds and sends real layered
packets to a real gateway; whether a live Nym-compatible mixnet on the far side interprets this exact header
is a wire-compatibility question this documentation does not claim to have proven.

## Source map

```
  userland/capsule_net_nym/src/route/header.rs        the three-step build pipeline
  userland/capsule_net_nym/src/route/seed.rs          the BLAKE3 route seed
  userland/capsule_net_nym/src/route/sphinx/build.rs  the ephemeral key, block layout, reverse masking
  userland/capsule_net_nym/src/route/sphinx/blocks.rs the per-hop X25519 shared secret and key
  userland/capsule_net_nym/src/route/sphinx/key.rs    the per-hop HKDF key derivation
  userland/capsule_net_nym/src/route/sphinx/hop.rs    the per-hop MAC and routing-field block
  userland/capsule_net_nym/src/route/sphinx/mask.rs   the HKDF onion mask
  userland/capsule_net_nym/src/route/sphinx/types.rs  ROUTE_HEADER_LEN, EPK_LEN, PREFIX_LEN, HOP_BYTES
  userland/capsule_net_nym/src/packet/encode.rs       the call site that writes the header into the packet
```

Every reference above is verified against those trees.
