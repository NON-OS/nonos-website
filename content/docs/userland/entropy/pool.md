---
title: "The pool and the randomness source"
description: "This page mirrors src/pool/: the four counters, the RDRAND fill, the stats encoding, the reseed breadcrumb, and, most importantly, an honest account of where the randomness actu..."
weight: 2
---
This page mirrors `src/pool/`: the four counters, the `RDRAND` fill, the stats encoding, the reseed
breadcrumb, and, most importantly, an honest account of where the randomness actually comes from. For
the operations that call into the pool, read [operations.md](/docs/userland/entropy/operations/). For identity and the
capability mask, read the [README](/docs/userland/entropy/).

## The honest randomness posture

State this plainly, because the module name invites the wrong assumption. There is no software CSPRNG in
this capsule. The type called `Pool` is four `AtomicU64` counters and nothing else
([`src/pool/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/types.rs#L26)); it is an accounting object, not a mixed entropy buffer. Random bytes come
verbatim from the CPU hardware random generator, `RDRAND`, word by word, with no whitening, no health
test beyond a retry loop, and no secondary source mixed in ([`src/pool/fill.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/fill.rs#L22)). `RESEED` mixes
nothing: it only bumps a counter ([`src/pool/record_reseed.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/record_reseed.rs#L21)).

This is weaker than the kernel's own secure RNG, which XORs a software CSPRNG with virtio-rng and
CPU-entropy bytes so its output is no weaker than its strongest source
([kernel secure RNG](/docs/subsystems/crypto/randomness/)). The capsule trades that mixing for
simplicity and leans on `RDRAND` alone. When the capsule is unavailable, the `CryptoRandom` syscall
falls back to the kernel hardware RNG, so a caller still receives real entropy but not necessarily from
this capsule ([`src/syscall/dispatch/crypto/random.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/syscall/dispatch/crypto/random.rs#L29)).

## The four counters

`Pool` holds four relaxed `AtomicU64` counters and nothing else ([`src/pool/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/types.rs#L26)):

```
  requests             total GET_RANDOM attempts       (reported as uptime_requests)
  bytes_served         cumulative bytes returned
  last_reseed_request  reseed count (bumped per reseed)
  source_failures      RDRAND give-ups
```

`Pool::new` is a `const fn` that zeroes all four ([`src/pool/new.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/new.rs#L21)). There is no mixed buffer and no
per-caller state; the source is global. Nothing persists: the counters live in memory and reset on
restart ([`src/pool/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/types.rs#L26)).

## The RDRAND fill

The heart of the capsule is `rdrand_fill` ([`src/pool/fill.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/fill.rs#L23)), which draws from the x86 hardware
random generator word by word under a `target_feature = "rdrand"` gate:

```
  #[target_feature(enable = "rdrand")]
  rdrand_fill(out):
      filled = 0
      while filled < out.len():
          word = 0; tries = 0
          while _rdrand64_step(&word) != 1:   // RDRAND can transiently fail
              tries += 1
              if tries >= 32:  return false     // give up on a stalled source
          take = min(8, out.len() - filled)
          out[filled..filled+take] = word.to_le_bytes()[..take]
          filled += take
      return true
```

Each 64-bit `RDRAND` is retried up to 32 times, because the instruction is allowed to fail transiently
when its entropy buffer is momentarily empty; after 32 consecutive failures the fill gives up and
reports a source failure ([`src/pool/fill.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/fill.rs#L30)). Output is filled eight bytes at a time, the last chunk
truncated to the requested length ([`src/pool/fill.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/fill.rs#L34)). There is no software mixing; the bytes are the
hardware generator's output verbatim.

`Pool::fill` ([`src/pool/fill.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/fill.rs#L42)) wraps that and does the accounting:

```
  fill(out) -> i64:
      cap  = MAX_RANDOM_BYTES (4096)
      want = min(out.len(), cap)              // re-clamp to the same ceiling
      if want == 0:  return 0
      requests += 1                            // count the attempt
      if not rdrand_fill(out[..want]):
          source_failures += 1
          return -5                            // EIO
      bytes_served += want
      return want
```

The `requests` counter is bumped before the attempt ([`src/pool/fill.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/fill.rs#L48)); on a give-up
`source_failures` is bumped and `-5` is returned ([`src/pool/fill.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/fill.rs#L50)); otherwise the served count is
added to `bytes_served` and returned ([`src/pool/fill.rs:53`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/fill.rs#L53)). The fill re-clamps to the same 4096 cap the
handler enforces, so nothing downstream can exceed it ([`src/pool/fill.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/fill.rs#L43)). A successful request
returns exactly the requested number of hardware-random bytes, and a hardware failure is a clean `-5`
that the handler maps to `EIO` ([`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17)).

## The stats snapshot

`Pool::snapshot` loads the four counters into a `Stats` struct with relaxed ordering
([`src/pool/snapshot.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/snapshot.rs#L21)); `requests` is reported under the name `uptime_requests`
([`src/pool/snapshot.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/snapshot.rs#L23)). `encode_stats` serializes that struct into a fixed 32-byte little-endian
blob ([`src/pool/encode_stats.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/encode_stats.rs#L18)):

```
  bytes  0..8    uptime_requests       encode_stats.rs:20
  bytes  8..16   bytes_served          encode_stats.rs:21
  bytes 16..24   last_reseed_request   encode_stats.rs:22
  bytes 24..32   source_failures       encode_stats.rs:23
```

This is exactly the body `GET_STATS` returns after the status word ([`src/server/handlers/getstats.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/getstats.rs#L24)).

## The reseed breadcrumb

`record_reseed` increments `last_reseed_request` by one and does nothing else
([`src/pool/record_reseed.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/record_reseed.rs#L21)). It takes no bytes and mixes no state, because there is no state to mix
into. The reseed handler still bounds-checks and length-matches the supplied entropy before calling it
(see [operations.md](/docs/userland/entropy/operations/)), but the bytes are discarded; only the counter moves. `RESEED` is
therefore an observability signal that some admin-scoped caller asked for a reseed, not a change to the
entropy source.

## Honest gaps

- There is no boot-time health check of `RDRAND` availability, so a persistent hardware failure surfaces
  as `EIO` at request time rather than at startup ([`src/pool/fill.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/fill.rs#L49)).
- The capsule has no software CSPRNG and no secondary source of its own, so its output quality is exactly
  `RDRAND`'s.
- The counters are not persisted across a restart ([`src/pool/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/types.rs#L26)).
- `RESEED` here does not reseed anything; it only bumps a counter ([`src/pool/record_reseed.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/pool/record_reseed.rs#L21)).

## Source map

```
  userland/capsule_entropy/src/pool/types.rs           Pool + Stats: the four AtomicU64 counters
  userland/capsule_entropy/src/pool/new.rs             const Pool::new, all four zeroed
  userland/capsule_entropy/src/pool/fill.rs            rdrand_fill (32 retries) + Pool::fill accounting
  userland/capsule_entropy/src/pool/snapshot.rs        load the counters into Stats
  userland/capsule_entropy/src/pool/encode_stats.rs    the 32-byte little-endian stats blob
  userland/capsule_entropy/src/pool/record_reseed.rs   bump last_reseed_request; mixes nothing
  userland/capsule_entropy/src/protocol/types.rs       MAX_RANDOM_BYTES cap consumed by fill
  userland/capsule_entropy/src/protocol/errno.rs       EIO for a source give-up
  src/syscall/dispatch/crypto/random.rs                the kernel hardware-RNG fallback
```

Every reference above is verified against those trees.
