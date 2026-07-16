---
title: "Syscall"
description: "How a capsule calls into the kernel: the instruction and register ABI that cross the ring boundary, the four-character tag numbers, the capability contract every call passes, an..."
weight: 8
---
How a capsule calls into the kernel: the instruction and register ABI that cross the ring
boundary, the four-character tag numbers, the capability contract every call passes, and
the router that reaches the family handlers. The defining property of the NØNOS boundary is
that the capability check is type-enforced, a handler cannot run without proof the check
happened, so this section reads alongside the [capability model](/docs/security/capabilities-and-tokens/).

| Page | What it covers |
|------|----------------|
| [boundary.md](/docs/subsystems/syscall/boundary/) | The `SYSCALL` instruction and LSTAR stub, the register ABI, the number decode, the contract gate, and the `Capability` witness type that makes the check a type-enforced precondition. |
| [numbers.md](/docs/subsystems/syscall/numbers/) | The four-character ASCII tag encoding, decoding a raw number to a typed syscall, and the families: `Crypto*`, `Admin*`, `Graphics*`, and the `Mk*` microkernel surface. |
| [router.md](/docs/subsystems/syscall/router/) | The family dispatch after the contract passes, the per-family handlers, the counters and audit wrapper, and the `ENOSYS` fallback. |

The ordered resolve chain the contract runs, the token MAC, the session, address-space, and
epoch bindings, and the per-syscall capability table, is documented on the
[capabilities page](/docs/security/capabilities-and-tokens/). The exhaustive per-call
contract with numbers, arguments, and error codes is the [ABI reference](/docs/abi/syscalls/).

## Sources

The code for this subsystem lives under `src/arch/x86_64/syscall/` (the entry stub and MSR
setup), `src/syscall/contract/` (the gate, the witness, and the resolver), `src/syscall/abi/`
and `src/syscall/numbers/` (the tags and the enum), and `src/syscall/dispatch/` and
`src/syscall/microkernel/` (the router and the handlers). Every page is verified against
those trees with `file:line` references.
