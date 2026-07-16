---
title: "Security policy"
description: "How to report a vulnerability in NØNOS privately, what is in scope, and what to expect after you report."
---

NØNOS is built to hold keys and sign transactions, so security reports are
taken seriously and handled privately. If you have found a vulnerability, please
disclose it to us before making it public.

## Report privately

Email [security@nonos.systems](mailto:security@nonos.systems) with:

- a description of the issue and where it is,
- the steps to reproduce it,
- the impact you believe it has,
- and anything that would help us confirm it (a proof of concept, logs, the
  commit you tested).

Do not open a public GitHub issue, a pull request, or a social post for a
security problem. Give us a chance to fix it first.

## What is in scope

- The kernel and the trusted path: the bootloader, signature verification, the
  capability system, the syscall boundary, the hardware broker.
- The crypto stack and the attestation gate.
- The host signing and verification tools.
- The live in-browser boot service, including guest isolation.

Out of scope: the marketing site content, third-party services we link to, and
issues that require a already-compromised host or physical access.

## What to expect

- We acknowledge reports and work with you on a fix and a disclosure timeline.
- Credit is given to reporters who want it, once a fix has shipped.
- The project is AGPL and run by a small team, so we ask for reasonable time to
  patch before public disclosure.

## Verify what you run

Much of the trust model is designed so you do not have to take our word for it.
Every release carries SHA-256 and BLAKE3 checksums, the build is reproducible,
and the trust chain verifies from a clean checkout. The
[download page](/download/) walks through confirming exactly what you booted.
