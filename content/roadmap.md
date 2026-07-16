---
title: "Roadmap"
description: "Where NØNOS is and where it is going: the trusted path first, then hardware breadth and multi-architecture, all in the open."
---

The roadmap follows one rule: the security-critical path lands first and proven,
then breadth. Nothing ships to the stable channel until it is signed, checked,
and reproducible from a clean checkout.

The full roadmap publishes in its entirety with the official 1.0 launch on
July 22, 2026. We are still defining and working through the details, so the
outline below is what is firm today and will be filled out release by release.

## Now: version 1.0

Shipping July 22, 2026. The signature-verified image, the live in-browser boot,
the full documentation, and the reproducible-build and verification tooling, all
public.

- Rust microkernel with capability security and RAM-resident state.
- Signed, attested capsules gated by the transparent STARK on every spawn.
- Verified boot: hybrid Ed25519 and ML-DSA-65 signature, TPM anti-rollback.
- Machine-checked proofs in CI: Lean, Verus, Kani, and the crypto vectors.
- A desktop that runs unmodified Rust applications as capsules.
- x86_64 as the production-first target, booting on real laptops.

## Next: hardware breadth

- More driver capsules proven on real silicon: WiFi, storage, and USB HID
  beyond the current coverage.
- IOMMU engaged for DMA isolation across the driver capsules.
- The first external security audit of the bootloader and capability system.

## Then: multi-architecture

- aarch64 and riscv64 from architecture-ready to production behind the same
  arch boundary and the same proofs.
- The verification scope widened to cover more of the trusted path.

## How to read this

Dates on the near term are commitments; the further out is direction, not a
promise. Everything is built in the open, so the [commit history](https://github.com/NON-OS/nonos-micro-kernel)
is the real, live roadmap. Progress against funded milestones is reported on the
[funding page](/fund/).
