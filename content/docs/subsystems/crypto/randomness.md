---
title: "Randomness"
description: "Every secret the kernel generates, the IPC MAC key, the capability key material, the kernel's signing keypair, the ASLR offset, is drawn from one secure random path."
weight: 5
---
Every secret the kernel generates, the IPC MAC key, the capability key material, the kernel's
signing keypair, the ASLR offset, is drawn from one secure random path. That path combines a
software CSPRNG with hardware entropy so it does not depend on any single source. This page
documents the pipeline and what draws from it. The code is under `src/crypto/random_api/` and
`src/crypto/util/rng/`.

## The secure path

`get_bytes_secure` ([`src/crypto/random_api/basic.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/random_api/basic.rs#L38)) is the two-stage fill:

```
  get_bytes_secure(buffer):
      rng::fill_random_bytes(buffer)     // software CSPRNG output
      mix_hardware_entropy(buffer)       // XOR hardware entropy over it
```

The software stage fills the buffer from the kernel CSPRNG. The hardware stage
(`hardware_mix.rs:20`) then mixes real hardware entropy into it by XOR, from two sources when they
are present:

```
  mix_hardware_entropy(buffer):
      mix_virtio_rng(buffer)   // if the virtio-rng driver is available, XOR its bytes in
      mix_cpu_rng(buffer)      // if RDRAND/RDSEED is available, XOR CPU entropy in
```

XOR-combining is the reason the result is no weaker than its best source: an output byte is the
software CSPRNG byte XOR the virtio-rng byte XOR the CPU-entropy byte, so an adversary would have
to predict all of the available sources to predict the output. The CPU source prefers `RDSEED`
over `RDRAND` (`next_cpu_random`), and the intermediate hardware buffers are zeroized after use so
they do not linger on the stack. When a hardware source is not present its stage is skipped, and
the software CSPRNG still fills the buffer.

## Entropy sizing

`get_bytes_checked` (`basic.rs:20`) refuses to fill a buffer smaller than the requested minimum
entropy (`required_entropy_bytes`, `entropy_check.rs`), returning `BufferTooSmall` rather than
handing back fewer bits than the caller asked for. This keeps a caller that needs, say, 256 bits
of key material from silently getting less.

## What draws from it

The secure path is the single source for the kernel's secrets:

```
  IPC MAC key         ipc/nonos_channel/hash.rs   init_ipc_secret, fatal if the RNG fails
  kernel keypair      crypto/kernel_keys.rs        the Ed25519 signing key at init
  capability keys     capabilities/token/          the MAC key material
  ASLR offset         elf/aslr/                     the per-load base randomization
```

The IPC MAC seeding is fatal on RNG failure (see [the IPC envelope](/docs/subsystems/ipc/envelope/)): the
kernel will not run with an unkeyed IPC path. The others draw the same way, so the quality of every
kernel secret reduces to the quality of this one path, which is why it mixes hardware entropy
rather than trusting the software CSPRNG alone.

## Security analysis

Every kernel secret reduces to this one path, so the properties that matter are that the output is
no weaker than its strongest source, that a short buffer cannot silently shrink the entropy, and
that the intermediate hardware bytes do not linger.

**The output is no weaker than its best available source.** `get_bytes_secure`
([`src/crypto/random_api/basic.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/random_api/basic.rs#L38)) first fills the buffer from the software CSPRNG, then
`mix_hardware_entropy` (`hardware_mix.rs:21`) XORs in virtio-rng bytes when the driver is available
and CPU entropy when RDRAND or RDSEED is present. Because the combine is XOR, an output byte is the
software byte XOR the virtio byte XOR the CPU byte, so an adversary would have to predict every
present source to predict the output, and a single trustworthy source is enough to save the result.
The CPU source prefers RDSEED over RDRAND (`next_cpu_random`, `hardware_mix.rs:57`). When a hardware
source is absent its stage is simply skipped and the software CSPRNG still fills the buffer, so the
mix never lowers the quality below the software path.

**A caller cannot silently get fewer bits than it asked for.** `get_bytes_checked`
(`basic.rs:31`) rejects a buffer smaller than `required_entropy_bytes(min_entropy)`
(`entropy_check.rs:17`, ceiling-divides the requested bits to bytes) with
`CryptoError::BufferTooSmall` rather than filling it, so a path that needs 256 bits of key material
cannot accidentally be handed 128.

**The hardware buffers are scrubbed after they are folded in.** `mix_virtio_rng` zeros its 64-byte
hardware buffer with volatile writes after XORing it into the output (`hardware_mix.rs:38`,
`zeroize`), so the raw hardware draw does not sit on the stack after use. Key generation that has no
usable entropy fails rather than falling back to a weak source: the crypto error set carries
`InsufficientEntropy` precisely so wallet and mnemonic generation abort instead of producing
predictable keys ([`src/crypto/error.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/crypto/error.rs#L45)).

The honest boundary is that the software CSPRNG is the floor, not a proven-unpredictable source on
its own. On a machine with neither virtio-rng nor RDRAND/RDSEED, both hardware stages skip and the
output is exactly the software CSPRNG's, so the strength of the result on such a machine rests
entirely on that generator's seeding. The design mitigates this by mixing hardware entropy wherever
it exists rather than trusting one source, but it does not manufacture entropy where the platform
provides none, and `get_bytes_secure` itself returns `Ok` in that case rather than signalling the
degraded posture; only the explicit key-generation paths escalate to `InsufficientEntropy`.

## Debugging randomness

Randomness fails quietly by nature, so debugging is about knowing which stage ran. The two hardware
stages are conditional: `mix_virtio_rng` returns early if `virtio_rng::is_available()` is false, and
`mix_cpu_rng` returns early unless `has_rdrand()` or `has_rdseed()` is true (`hardware_mix.rs:30`,
`:42`). So if you suspect the output is coming from the software CSPRNG alone, the question is
whether either predicate is true on this machine, not whether the mix code ran, since the mix code
silently does nothing when a source is absent. That absence is the expected, not the error, case.

The one place the RNG is allowed to be fatal is where a secret cannot safely be weak. IPC MAC
seeding treats an RNG failure as fatal and refuses to run with an unkeyed IPC path (see
[the IPC envelope](/docs/subsystems/ipc/envelope/)), and wallet and key generation surface
`CryptoError::InsufficientEntropy` (`error.rs:45`) rather than a fallback key. So a boot that halts
at IPC seeding points at the RNG failing at init, and an `InsufficientEntropy` from a key path means
no hardware entropy was available on a path that refuses to proceed without it. A caller that gets
`BufferTooSmall` from `get_bytes_checked` (`basic.rs:32`) has an entropy-sizing bug, asking for more
bits than the buffer can hold, which is distinct from an entropy-source failure and is caught before
any bytes are drawn.

## Source map

```
  src/crypto/random_api/basic.rs           get_bytes_secure, get_bytes_checked, the two-stage fill
  src/crypto/random_api/hardware_mix.rs     the virtio-rng and CPU-entropy XOR mix and the scrub
  src/crypto/random_api/entropy_check.rs    the minimum-entropy sizing
  src/crypto/util/rng/entropy/hardware.rs   RDRAND / RDSEED access
  src/crypto/error.rs                       BufferTooSmall and InsufficientEntropy
```

Every reference above is verified against those trees. The IPC MAC key that fails fatally on RNG
error is on the [IPC envelope](/docs/subsystems/ipc/envelope/) page, the kernel keypair drawn from this path is
on the [asymmetric](/docs/subsystems/crypto/asymmetric/) page, and the ASLR offset it feeds is on the ELF loader pages.
