---
title: "The Security Model"
description: "This is the whole security story of NØNOS in one page: what it defends against, the chain that decides whether code runs and what it may do, the isolation that contains code onc..."
weight: 1
---
This is the whole security story of NØNOS in one page: what it defends against, the chain that decides
whether code runs and what it may do, the isolation that contains code once it runs, what of this is
machine-checked rather than asserted, and the boundaries where the guarantees honestly stop. Every claim
here is expanded on a deeper page and grounded in code; this page is the map, and the [verification
page](/docs/architecture/verification/) is the proof.

The thesis in one sentence: the trusted path is small, every authority is a capability that must be
granted and is checked on use, code runs only after its signature and attestation verify, and the
security-critical properties are proven over the code that actually runs.

## Threat model

NØNOS is a microkernel that runs untrusted capsules and talks to untrusted peripherals and networks, so
the attacker is assumed to control:

- The bytes of any capsule image, its signature, and its ELF headers.
- The bytes of any network packet the system receives.
- The bytes any peripheral returns: a USB device's descriptors, a storage device's identify structure,
  a WiFi firmware's responses.
- The arguments any userspace process passes across the syscall boundary.
- The contents of a persisted anti-rollback record, subject to the monotonic counter a TPM enforces.

The attacker does **not** control the code under `src/` and the capsules, the signing keys, or the
verification tools. Out of scope: physical attacks below the TPM boundary, fault injection, analog side
channels, and any timing channel the constant-time work does not cover. These exclusions are stated
because a threat model that claims everything defends nothing.

## The trust chain: deciding what runs

Nothing runs on NØNOS by default. A capsule becomes a process only by passing an ordered, fail-closed
pipeline, and each step is checked before the next. A failure at any step means the capsule does not
run, with no partial state.

```
  baked trust anchor            (in the signed kernel image, non-optional)
        |  signs
  NØNOS-ID certificate          (publisher identity + capability ceiling + namespace)
        |  signs
  capsule manifest              (the exact capabilities requested + payload hash)
        |  binds
  attestation trailer           (proof the capsule image is the enrolled one)
        |  gates
  verified spawn                (all of the above checked, then and only then the ELF is mapped)
        |  grants
  capability mask               (the process's authority, checked on every syscall)
```

- The **[trust anchor](/docs/security/trust-anchor/)** is baked into the signed kernel image and is not optional. It
  carries the signing keys and their validity windows, an epoch for anti-rollback, and three revocation
  lists, and it is the root every certificate is checked against.
- The **[certificate](/docs/security/certificate-schema/)** binds a publisher identity to a capability ceiling and a
  namespace, and is signed by the anchor. A capsule can never hold a capability above its certificate's
  ceiling.
- The **[manifest](/docs/security/manifest-schema/)** declares the exact capabilities the capsule requests and the
  hash of its payload, signed by the publisher's certificate. Rebuild the ELF and the payload hash no
  longer matches; the manifest is rejected.
- The **[attestation](/docs/security/attestation/)** gate binds the running image to an enrolled secret through a
  zero-knowledge proof, so a substituted image fails even if it were somehow signed. This gate is
  fail-closed in production and is the reason a supply-chain swap cannot run.
- **[Verified spawn](/docs/security/capsules-and-trust/)** runs the whole pipeline in order, and only after every
  check passes does it map the ELF. The capabilities the process ends up with are the output of this
  pipeline, never a request the process makes for itself.

The full admission story, with every field and every error, is on the [capsules and
trust](/docs/security/capsules-and-trust/) page.

## Enforcement: bounding what runs

Once a capsule is a process, its authority is a **[capability mask](/docs/security/capabilities-and-tokens/)**, a set
of the twenty-two capability bits, and the kernel checks it on every syscall. Authority is additive and
least-privilege by construction: a capsule holds exactly what its manifest was granted and nothing else.
The decode is not decoration, it is the boundary. A filesystem capsule holds no hardware capability at
all; the keyring holds the crypto right but not the network or driver rights; an input driver holds the
right to post input while a bus driver holds the right to touch registers, and they are different
capsules on purpose. A syscall from a capsule that lacks the required capability is refused at the
boundary and logged as `[CAP-DENY]`.

Capabilities can be narrowed but never widened. **[Delegation](/docs/security/delegation/)** lets a capsule hand a
subset of its authority to another with an expiry, enforced at creation, and the capability algebra
itself (grant, revoke, attenuate) is machine-checked to only ever shrink authority under attenuation.
**[Revocation](/docs/security/revocation/)** withdraws authority at four scopes: the per-boot signing key and nonce,
a per-process epoch, a per-token revoked set, and the anchor's lists. **[Signing and
MAC](/docs/security/signing-and-mac/)** is the per-boot keyed integrity under all of this, a two-pass keyed BLAKE3
over 128 bytes of MAC material with a constant-time comparison.

## Isolation: containing what runs

The trust chain decides *whether* code runs; the isolation model decides *how far it can reach* once it
does. Five mechanisms, each documented deeply elsewhere:

- **Ring-3 capsules with brokered hardware.** No driver runs in the kernel. A driver reaches its device
  only through the [hardware broker](/docs/subsystems/hardware-broker/), which lends narrow,
  revocable grants: a slice of one BAR ([MMIO](/docs/subsystems/hardware-broker/mmio/)), a class-capped
  DMA buffer ([DMA](/docs/subsystems/hardware-broker/dma/)), an interrupt it can wait on but never
  program ([IRQ](/docs/subsystems/hardware-broker/irq/)), a port window ([PIO](/docs/subsystems/hardware-broker/pio/)),
  all checked against an exclusive epoch-stamped [claim](/docs/subsystems/hardware-broker/claim/). A
  compromised driver corrupts its own device and nothing else.
- **The MSI-X withhold.** The broker never maps a device's MSI-X interrupt table to a capsule, so a
  driver can drive its device but can never point an interrupt at a vector it was not bound. The right to
  drive hardware and the right to receive an interrupt are deliberately split between the kernel and the
  capsule.
- **Address-space isolation.** Each capsule has its own address space; a capsule reaches another only by
  named [IPC](/docs/subsystems/ipc/) to a registered endpoint, never by a shared pointer, and the
  kernel stamps the sender so a message cannot be forged from another capsule.
- **W^X and guard pages.** No page is writable and executable; device mappings are no-execute; adjacent
  broker grants are separated by unmapped guard pages so an overrun faults instead of spilling. Details
  on the [paging](/docs/subsystems/memory/paging-manager/) and [MMIO](/docs/subsystems/hardware-broker/mmio/)
  pages.
- **Zeroization.** Freed memory and freed DMA buffers are scrubbed before reuse, so no capsule receives
  another's residue. See [zeroization](/docs/subsystems/memory/zeroization/).

## Defense in depth, top to bottom

- **Admission** rejects unsigned, over-privileged, or unattested code before it runs.
- **Capabilities** bound what admitted code may ask for, checked on every syscall.
- **The broker** bounds what hardware-touching code may reach, per grant, revocably.
- **Paging and zeroization** bound what any code sees in memory.
- **The source-hygiene gate** guarantees the production kernel carries no panic path or stub.
- **The proofs** establish that the security-critical properties above actually hold over the running
  code.

No single layer is trusted to be perfect; each contains the failure of the one above it.

## What is machine-checked

The claims on this page are not only asserted, the security-critical ones are proven, over the real
source, with no unproven placeholders, and re-run on every push. The [verification
page](/docs/architecture/verification/) is the full, honest scope, but in summary: the capability algebra
soundness, address-space isolation, page-permission invariants, memory zeroization, the attestation and
anti-rollback logic, and path canonicalization are proven in Lean (54 theorems, zero `sorry`) with a
Verus refinement over the real capability bit-operations; the crypto primitives are checked against
FIPS, RFC, and NIST vectors with tamper rejection; and the parsers are fuzz-proven never to panic or
break their invariants over millions of hostile inputs.

## The honest boundaries

The guarantees stop in specific, stated places:

- **No IOMMU by default.** The `IommuDomain` backend is behind the `nonos-arch-iommu` feature and is not
  engaged in shipping builds, so a device is trusted not to DMA outside the buffer it was given. The
  broker bounds what a capsule may program, not what a malicious device does. This is the single largest
  boundary and is stated on the [DMA](/docs/subsystems/hardware-broker/dma/) page.
- **The security clock is uptime.** Temporal checks read an uptime-based clock with no authenticated
  wall-time, so freshness is monotonic-since-boot, not absolute. See the [time
  pages](/docs/subsystems/time-and-clock/).
- **`nonos-zk-rollout` is fail-open.** A development flag can make the attestation gate permissive; it is
  mutually exclusive with `nonos-production`. Production builds are fail-closed.
- **Side channels are out of scope of the proofs.** The crypto is portable software and not everywhere
  constant-time; the [crypto pages](/docs/subsystems/crypto/) mark where.
- **Below the TPM line is out of scope.** Physical attacks, fault injection, and analog side channels are
  not defended.

## Where to read next

- [Capsules and trust](/docs/security/capsules-and-trust/): the exact verified-spawn pipeline, field by field.
- [Capabilities and tokens](/docs/security/capabilities-and-tokens/): the twenty-two bits and the syscall table.
- [The hardware broker](/docs/subsystems/hardware-broker/): how a ring-3 driver reaches hardware.
- [Verification](/docs/architecture/verification/): exactly what of this is proven, and what is not.
- [The mission](/docs/architecture/mission/): why this model exists and the custody use case it serves.
