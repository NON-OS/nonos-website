---
title: "Contribute"
description: "How to work on NØNOS: read the docs, pick something real, and land a small change that passes the same checks everyone else does."
---

NØNOS is built in the open, and the fastest way onto the project is to do the
work where everyone can see it. There is no privileged path around the checks,
for anyone.

## Start here

1. **Read the [documentation](/docs/).** Every page is verified against the
   source it describes, with file and line references, so the codebase is
   navigable from your first hour.
2. **Build it.** The [build guide](/docs/build/) covers the toolchain and the
   cargo and Make workflows. Boot it in [QEMU](/docs/run/qemu/) to see it run.
3. **Pick something real.** Driver capsules, userland apps, proofs, and
   documentation all have room. The issues on
   [GitHub](https://github.com/NON-OS) mark good places to begin.

## How a change lands

Every change goes through the same gate, whoever writes it:

- It must be small and reviewable. One idea per pull request.
- It must pass the hygiene checks: no panics on the production path, no stubs,
  no dead code, `cargo fmt` clean.
- It must pass the trust-chain verification and, where it touches a proven
  surface, keep the proofs green.
- Documentation that describes behaviour must match the code it cites.

Nothing merges that a build could not reproduce and a reader could not verify.

## Where the code lives

- **Kernel and proofs:** [nonos-micro-kernel](https://github.com/NON-OS/nonos-micro-kernel)
- **Documentation:** [nonos-docs](https://github.com/NON-OS/nonos-docs)
- **Host signing tools:** [nonos-sign](https://github.com/NON-OS/nonos-sign)

## Security issues

Do not open a public issue for a vulnerability. Follow the
[security policy](/security-policy/) for private disclosure.

## Reach us

Open a pull request or issue on [GitHub](https://github.com/NON-OS), or write to
[team@nonos.systems](mailto:team@nonos.systems).
