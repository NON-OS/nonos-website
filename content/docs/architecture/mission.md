---
title: "The Mission"
description: "NØNOS exists to make the trusted path something you own rather than something you hope for."
weight: 500
---
NØNOS exists to make the trusted path something you own rather than something you hope for. On a
general-purpose operating system every program you run, a browser tab, an npm dependency, a driver
from a vendor, a wallet, shares one address space of trust: the kernel is millions of lines, drivers
run with full hardware privilege, and any one compromise reaches everything. That model is acceptable
for a laptop that browses the web. It is not acceptable for the machine that holds a private key,
signs a transaction, or runs an autonomous agent that spends money. NØNOS is built for that second
machine: a sovereign operating system where the security-critical path is small, capability-bounded,
machine-checked, and attested, and where everything else is confined so that its failure cannot reach
the part that matters.

## The problem, stated precisely

Three assumptions hold every mainstream OS together, and each one is a liability for a machine that
custodies value or authority:

1. **Drivers are trusted.** A network card driver, a GPU driver, a USB stack, all run in the kernel
   with the authority to read and write any memory and program any device. A single driver bug is a
   full system compromise. Most real-world kernel exploits are driver exploits.
2. **Ambient authority is the default.** A process can open any file, reach any network address, and
   call any syscall unless something external (a sandbox, a container, an LSM policy) is bolted on to
   stop it. Authority is subtractive: you start with everything and try to take some away.
3. **You cannot prove what is running.** When a wallet asks you to approve a transaction, nothing tells
   you that the code deciding the transaction is the code you audited, unmodified, and not something a
   supply-chain attack swapped in last week.

NØNOS inverts all three, and the inversions are the architecture, not a configuration.

## What NØNOS does instead

**Drivers run in ring 3, as capsules, with lent authority.** A device driver on NØNOS is a signed
userspace capsule that holds no hardware privilege of its own. It reaches its device only through the
[hardware broker](/docs/subsystems/hardware-broker/), which lends it narrow, revocable grants:
a slice of one BAR, a DMA buffer capped for its device class, a specific interrupt it can wait on but
never program, a port window. A compromised WiFi or storage driver can corrupt its own device and
nothing else, because it was never given the authority to touch anything else. The kernel owns the
hardware and lends it; it never hands it over. This is verified end to end on real silicon: the entire
WiFi stack, firmware download, DMA rings, MAC and PHY bring-up, association, was built and debugged as
a ring-3 capsule reaching a real Realtek radio through brokered grants alone.

**Authority is additive and capability-shaped.** A capsule starts with nothing and its manifest
declares exactly the capabilities it needs, as a bitmask the kernel checks on every syscall. A
filesystem capsule holds no hardware capability at all; the keyring holds the crypto right but not the
network or driver rights; an input driver holds the right to post input but a bus driver holds the
right to touch registers, and the two are different capsules on purpose. The [capability
model](/docs/security/capabilities-and-tokens/) is not a policy layered on top; it is the only way a
capsule reaches anything, and its algebra (grant, revoke, attenuate) is machine-checked (see
[Verification](#verification-is-the-difference) below).

**Capsules are signed, RAM-resident, and attested.** A capsule runs only if its signature verifies
against the trust anchor, its manifest's requested capabilities are within policy, and its attestation
checks, all before its ELF is ever mapped. The capsule is embedded in the signed kernel image and
lives in RAM, so there is no on-disk binary for an attacker to swap. The [verified spawn
path](/docs/security/capsules-and-trust/) is the gate, and it is fail-closed: a bad signature, an
over-broad capability request, or a failed attestation means the capsule does not run.

## Why NØNOS is different from everything else

- **Versus monolithic OSes (Linux, Windows, macOS):** their drivers run in the kernel; NØNOS drivers
  run in ring-3 capsules with brokered grants. Their authority is ambient and subtractive; NØNOS
  authority is capability-based and additive. A driver compromise there is a kernel compromise; here it
  is contained to one device.
- **Versus other microkernels (seL4, QNX):** NØNOS shares the microkernel thesis, a small kernel that
  owns only mechanism while policy lives in userspace, and it shares seL4's commitment to machine
  proof. It differs in what it builds on top of that thesis and in where the proofs sit. seL4 is a
  minimal verified kernel you assemble a system around; NØNOS ships a complete capability system, the
  brokered hardware grant model, signed attested RAM-resident capsules, and a running desktop, wallet,
  and network stack, and it proves its properties over the actual Rust that runs rather than over a
  separate model (see below). NØNOS is a system, not only a kernel.
- **Versus "secure OS" and "hardened OS" products:** their isolation is configured (sandboxes,
  containers, MAC policies) and can be misconfigured or bypassed; NØNOS isolation is structural, a
  capsule cannot reach what it was not granted, and the grant machinery is the only path. Their driver
  model is still in-kernel; NØNOS drivers are confined capsules.
- **Versus "formally verified" marketing:** many projects claim verification and prove little, or prove
  a model with no link to the running code. NØNOS states exactly what is proven, proves it over the
  real source, and carries zero unproven placeholders. The honest scope is on the
  [Verification](/docs/architecture/verification/) page.

## The crypto and Ethereum use case

The clearest application of a sovereign, capability-bounded, attested OS is custody and autonomous
value. When a wallet or an agent holds a key or authorizes a payment, three questions decide whether
you can trust it, and NØNOS answers each structurally.

**Where does the key live, and who can reach it?** On NØNOS the signing key lives in the [keyring
capsule](/docs/userland/keyring/), which holds the crypto capability but not the
network or driver capabilities, so it can sign but cannot exfiltrate over a socket or a device. The
[wallet capsule](/docs/userland/wallet-nonos/) that builds and displays a transaction
holds no key material and no network hardware; it reaches the keyring only by named IPC and the network
only through the confined [network capsules](/docs/subsystems/networking/). A browser exploit or
a malicious dependency in one capsule cannot walk into the key, because it has no capability that
reaches it and no shared address space with it. This is the property a hardware wallet gives you for
one key; NØNOS gives it to the whole system, in software, enforced by the same capability model that
isolates the drivers.

**Can you prove what code is authorizing the transaction?** Because a capsule runs only after its
signature and attestation verify, and because the attestation is bound to the exact capsule image
(NØNOS carries an in-kernel STARK and a Pedersen attestation gate, see [proof
system](/docs/subsystems/proof-system/) and [attestation](/docs/security/attestation/)), the
machine can produce evidence that the code deciding a transaction is the audited code and not a
substitution. That is the missing half of every "approve this transaction" prompt on a normal OS.

**Autonomous and agentic payments.** As agents begin to hold and spend value (the direction of
account-abstraction wallets and machine-payable protocols such as x402), the question of what code is
allowed to authorize a spend, and how you bound and attest it, becomes the whole game. A NØNOS capsule
is exactly the right unit: capability-bounded (an agent can be granted precisely the authority to call
one payment endpoint and nothing else), attested (you can prove which agent code ran), and isolated
(a compromised model or tool cannot reach the key). The NOX chain and the agentic-payment work build on
this capsule-plus-attestation base; that ecosystem code lives outside this kernel repository, but the
mechanism it rests on, isolation, capability bounds, and attestation, is what this kernel provides and
proves.

## Verification is the difference

The reason to believe any of the above is that the security-critical properties are not asserted, they
are machine-checked, and checked over the code that actually runs. The capability algebra, address-space
isolation, zeroization of freed memory, the attestation and anti-rollback logic, and the crypto
primitives are proven in Lean and Verus and checked against standard vectors, with no unproven
placeholders, and re-run on every push. NØNOS deliberately proves properties over the real Rust source
rather than a detached model, which is the gap where defects usually hide. The full, honest scope of
what is and is not established is the [Verification](/docs/architecture/verification/) page. That page is written to be
audited, not believed.

## Where to read next

- The layered [architecture overview](/docs/architecture/overview/): what the kernel owns and what capsules own.
- The [hardware broker](/docs/subsystems/hardware-broker/): how a ring-3 driver reaches hardware.
- The [capability model](/docs/security/capabilities-and-tokens/) and [verified
  spawn](/docs/security/capsules-and-trust/): how authority is granted and gated.
- The [Verification](/docs/architecture/verification/) page: exactly what is proven, and what is not.
