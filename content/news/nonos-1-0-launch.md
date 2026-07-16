---
title: "NØNOS 1.0 launches July 22"
date: 2026-07-16
description: "Version 1.0 of the sovereign operating system ships July 22, 2026: the verified image, the live boot, and the full documentation, all public."
---

Version 1.0 of NØNOS ships on July 22, 2026. It is the first stable release of a
sovereign operating system where every program is a signed, attested capsule and
nothing runs on trust alone.

What lands with 1.0:

- The signature-verified disk image, with SHA-256 and BLAKE3 checksums and a
  reproducible build, so you can confirm exactly what you boot.
- The [live in-browser boot](/download/): a real, throwaway NØNOS guest streamed
  to your browser, no install.
- The [full documentation](/docs/), written against the source with file and
  line references, including every capsule in the userland.
- The verification tooling: the Lean, Verus, and Kani proofs, the trust-chain
  checker, and the reproducible-build comparison, all runnable from a clean
  checkout.

The source and documentation are already public. The best way to mark the launch
is to boot it live the day it lands and read the
[verification page](/docs/architecture/verification/) to see exactly what is
proven and what is not.

Follow [@nonossystems](https://x.com/nonossystems) and
[GitHub](https://github.com/NON-OS) for the release.
