---
title: "Team and contributors"
description: "Who builds NØNOS, how the work is organised, and how to join it. Small trusted core, open contribution, everything in public."
---

NØNOS is built the way its trusted path is: small at the core, open at the
edges, and verifiable end to end. A tight maintainer group owns the
security-critical code and the proofs; everything else grows through public
contribution, in the open, on GitHub.

## How the work is organised

The kernel and the trusted path, the bootloader, the capability system, the
crypto stack, and the machine-checked proofs, are maintained by a small core so
that the part that must be correct stays small enough to reason about. Around
that, the driver capsules, the userland, the desktop, the SDKs, and the
documentation are built to be contributed to: modular by design, cross-referenced
to the source, and gated by the same verification everyone can run.

Every change lands the same way, whoever writes it: it must pass the proofs, the
hygiene checks, and the trust-chain verification before it ships. There is no
privileged path around the checks, for anyone.

## Contribute

The fastest way onto the team is to do the work in the open.

- **Read the [documentation](/docs/).** Every page is verified against the
  source it describes, so the codebase is navigable from day one.
- **Pick something real.** Driver capsules, userland apps, proofs, and
  documentation all have room. The [contribute guide](/contribute/) points at
  where to start.
- **Open a pull request.** Small, reviewable, and green against the checks.
- **Report security issues privately** through the [security
  policy](/security-policy/), not in a public issue.

## Funding the people

Full-time work on a verified operating system takes funding. If you want to
help pay for the people who keep the proofs green and the drivers proven on
hardware, the [funding page](/fund/) has the scope and the ways in.

Reach the maintainers at [ek@nonos.systems](mailto:ek@nonos.systems) or
through [GitHub](https://github.com/NON-OS).
