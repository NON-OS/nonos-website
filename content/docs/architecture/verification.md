---
title: "Verification"
description: "This page states exactly what NØNOS proves, what it does not, and how to reproduce every claim from a clean checkout."
weight: 500
---
This page states exactly what NØNOS proves, what it does not, and how to reproduce every claim from a
clean checkout. It is written to be audited, not believed. The machinery it summarizes lives under
`verification/` and in the proof crates under `userland/*_proofs/`, and the deeper narrative is in
`verification/ARCHITECTURE.md`; this page is the wiki-level map of it.

## The thesis: proofs over the code that runs

A proof is only as strong as the distance between the thing proved and the thing that boots. A kernel
that carries a formal model and proves theorems about that model has established something real, but
whether the code that actually runs refines the model is a separate question. For a total-correctness
effort like seL4 that question is itself answered by a machine-checked refinement proof from the model
down to the C. For most projects that claim "formal verification" it is not answered at all, and that
unproven gap is where defects live.

NØNOS closes the gap a different way for the properties it proves: the runnable proofs include the
**real `src/` and capsule source, unmodified, through Rust's `#[path]` mechanism** (only the syscall
clock is shimmed), and execute it. Where a property is naturally an abstract theorem it is stated in
Lean, and a second proof, in Verus over the real bit-operations or in a runnable proof over the real
code, shows the implementation satisfies it. The model is never left standing on its own. NØNOS does
not claim total functional correctness of the whole kernel; it claims the security-critical properties,
proven over the running code, with nothing left as an unproven placeholder.

## The layers, strongest at the bottom

**Layer 0, source hygiene.** `nonos-verify hygiene` scans all production Rust under `src/` and
`userland/` and fails the build on panic paths (`unwrap`, `expect`, `panic!`), stub macros (`todo!`,
`unimplemented!`, `unreachable!`), dead-code allow markers, and temporary comment markers. Proof crates
are excluded because their assertions are allowed to panic. This is not a proof of correctness; it is a
machine-enforced floor that the production kernel contains no panic path and no stubbed logic, re-checked
on every push.

**Layer 1, runnable proofs over the real source.** Host crates that `#[path]`-include the actual kernel
and capsule code and run it with `cargo test`:

- `userland/fs_proofs` (58 passing): VFS store operations, path-security canonicalization and the
  `/capsules` read-only guard including slash-smuggling, the protocol codec against hostile input,
  caller attestation rejecting userspace impersonation, and fuzz proofs asserting the parsers never
  panic and never violate their invariants over millions of structured and random inputs. Writing these
  found and fixed real bugs.
- `userland/crypto_proofs`: the real kernel crypto checked against standard vectors, SHA-256/512
  (FIPS 180-4), SHA-3 (FIPS 202), BLAKE3, HMAC-SHA-256 (RFC 4231), HKDF (RFC 5869), ChaCha20-Poly1305
  (RFC 8439), AES-GCM (NIST), Ed25519 (RFC 8032), P-256/P-384 ECDSA, secp256k1, and RSA, each including
  tamper rejection.
- `userland/net_proofs`, `driver_proofs`, `stark_proofs`, `kernel_proofs`, `usb_proofs`, and the
  in-image proof capsules (`capsule_gui_proof`, `capsule_std_proof`, `capsule_input_proof`,
  `capsule_proof_io`), each asserting a specific guarantee over real code.

**Layer 1b, bounded model-checking (Kani).** Several proof crates carry Kani harnesses
([`nonos-bootloader/boot_proofs/src/kani_proofs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/nonos-bootloader/boot_proofs/src/kani_proofs.rs), [`userland/fs_proofs/src/kani_proofs.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/fs_proofs/src/kani_proofs.rs),
`userland/driver_proofs`). Kani exhaustively checks a function over all inputs within a bound, which is
stronger than testing for the bounded region and catches the arithmetic and boundary cases fuzzing can
miss. It is bounded, not unbounded: it proves the property for inputs up to the bound, not for all
inputs of unbounded size.

**Layer 2, Lean theorems.** Ten Lean files under `verification/lean/Nonos/` carry 54 theorems and
**zero `sorry`** (Lean's placeholder for an unproven step), so every stated theorem is fully proven:

```
  Capability.lean    (11)  grant/revoke/attenuate algebra: empty grants nothing, grant adds and never
                           removes, revoke drops the target and preserves others, attenuate is confined
                           by the mask, idempotence and commutativity
  Zeroization.lean    (6)  freed memory is scrubbed; no cross-lifetime residue
  Path.lean           (6)  path canonicalization and the read-only guard
  AntiRollback.lean   (6)  a monotonic index cannot be moved backward
  Attestation.lean    (5)  the attestation binding and its rejection cases
  Authorization.lean  (5)  the authority checks
  Ipc.lean            (5)  message-length and endpoint invariants
  Crypto.lean         (4)  the crypto-facing properties
  Isolation.lean      (3)  address-space isolation
  Paging.lean         (3)  page-permission invariants (no writable-executable)
```

**Layer 2b, Verus refinement.** `verification/verus/` proves that the real Rust bit-operations match
the Lean model: the capability `has`/`grant`/`revoke`/`attenuate` functions (`revoke_is_monotonic`,
`revoke_drops_the_right`, and their companions), the page-permission spec, and the IPC-length spec are
proven in Verus directly over the Rust semantics. This is the bridge that ties the abstract Lean theorem
to the concrete `bits & !bit` the kernel executes.

## What is established

Over the real code, machine-checked, reproducible, and re-run on every push:

- The **capability algebra** is sound: authority only shrinks under attenuation and revoke, grant never
  removes, and the operations compose as the model says (Lean, plus Verus over the real bit-ops).
- **Address-space isolation** and **page-permission** invariants hold (Lean, Verus): no
  writable-and-executable page, no capsule reach outside its mappings.
- **Freed memory is zeroized** (Lean, plus the runnable zeroization checks): no cross-tenant residue.
- **Attestation and anti-rollback** reject the substitution and rollback cases (Lean, plus the runnable
  attestation proofs rejecting impersonation).
- **Path canonicalization** and the `/capsules` guard resist smuggling (Lean, plus fs_proofs fuzz).
- The **parsers never panic and never violate their invariants** over millions of hostile inputs (fuzz).
- The **crypto primitives** conform to their standard vectors and reject tampering (crypto_proofs).
- The **production source carries no panic path or stub** (hygiene).

## What is NOT established

Stated plainly, because an honest scope is the point:

- **Not total functional correctness.** NØNOS does not prove that the entire kernel does exactly what a
  full specification says, the way seL4 does. It proves the security-critical properties above, not
  every behavior of every subsystem. A subsystem can be correct against these properties and still have
  a functional bug outside them.
- **Kani is bounded.** The model-checked properties hold for inputs up to the harness bound, not for all
  unbounded inputs.
- **Known-answer vectors are conformance, not a universal proof.** Passing FIPS/RFC/NIST vectors shows
  the implementation agrees with the standard on those vectors and rejects tampering; it is strong
  evidence of correctness but is not a proof of the algorithm for every possible input.
- **Side channels are out of scope of these proofs.** The crypto is portable software; the [crypto
  pages](/docs/subsystems/crypto/) state honestly where a primitive is not constant-time. The
  proofs are functional and structural, not timing proofs.
- **The hardware is trusted below the IOMMU line.** With the IOMMU backend not engaged, the DMA safety
  argument rests on the broker's software bounds plus non-malicious device hardware; this is stated on
  the [DMA](/docs/subsystems/hardware-broker/dma/) page.

## Versus seL4, and versus marketing

**Versus seL4.** seL4 is the gold standard for total kernel verification: it proves full functional
correctness of the whole kernel in Isabelle/HOL and proves that the C refines that model. NØNOS does
not match that scope and does not claim to. What NØNOS does differently is (1) prove a focused set of
security-critical properties rather than total correctness, (2) run those proofs over the actual Rust
source rather than only an abstract model, and (3) build on a memory-safe language, which removes by
construction a large class of the memory-corruption bugs a C kernel's proof must rule out. The two are
different points on the same spectrum: seL4 proves everything about a minimal C kernel; NØNOS proves the
things that matter most about a larger Rust system, over the code that runs, and is honest that the rest
is tested rather than proven.

**Versus "formally verified" marketing.** The common failure is to prove a model with no link to the
running code, or to leave theorems as `sorry`, or to call a test suite a proof. NØNOS's Lean carries
zero `sorry`, its Verus proofs are over the real bit-operations, its runnable proofs include the real
source, and every claim on this page is reproducible from a clean checkout by the commands below. The
scope is narrower than the marketing usually implies and stated as such.

## Reproduce it

```sh
# Layer 0: source hygiene
cargo run --manifest-path nonos-verify/Cargo.toml -- hygiene

# Layer 1: runnable proofs over the real source
cd userland/fs_proofs      && cargo test --release
cd userland/crypto_proofs  && cargo test --release

# Layer 1b: bounded model-checking
cd userland/fs_proofs      && cargo kani --output-format terse

# Layer 2: Lean theorems (requires the Lean toolchain in verification/lean)
cd verification/lean       && lake build
```

## Source map

```
  verification/README.md          the three-layer framing and the run commands
  verification/ARCHITECTURE.md     the thesis, threat model, and what is/ is not established
  verification/STATUS.md           the last local run and its results
  verification/lean/Nonos/*.lean   the 54 Lean theorems (zero sorry)
  verification/verus/src/*.rs      the Verus refinement of capabilities, paging, IPC lengths
  userland/fs_proofs/              runnable + Kani proofs over the real VFS/parser/attestation code
  userland/crypto_proofs/          the crypto known-answer and tamper-rejection proofs
  userland/{net,driver,stark,kernel,usb}_proofs/  further runnable proofs per subsystem
  nonos-verify/                    the source-hygiene gate
```

Every reference above is verified against those trees. The properties proven here are what the
[mission](/docs/architecture/mission/) rests on, the capability algebra is specified on the [capabilities
page](/docs/security/capabilities-and-tokens/), the attestation on the [attestation
page](/docs/security/attestation/), and the crypto primitives on the [crypto
pages](/docs/subsystems/crypto/).
