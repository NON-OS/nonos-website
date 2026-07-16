---
title: "IPC"
description: "How capsules talk. NØNOS gives no capsule shared memory with another and no name for another's address space; the only way across the boundary is a message the kernel routes and..."
weight: 9
---
How capsules talk. NØNOS gives no capsule shared memory with another and no name for
another's address space; the only way across the boundary is a message the kernel routes and
a permission the kernel checks. Two primitives carry that traffic: the inbox, a named bounded
queue for permission-checked, sender-attested messages, and the pipe, an anonymous byte FIFO
behind a pair of file descriptors.

| Page | What it covers |
|------|----------------|
| [inbox.md](/docs/subsystems/ipc/inbox/) | The per-process bounded queue, the registry with an explicit owner pid, the fail-closed `try_enqueue_strict` (`MissingInbox` / `DeadOwner` / `QueueFull`), the receive loop, and the teardown tie. |
| [routing.md](/docs/subsystems/ipc/routing/) | The capability check on every named route, resolving an endpoint to a destination inbox, the kernel-stamped sender identity, the wake, and the send syscalls. |
| [envelope.md](/docs/subsystems/ipc/envelope/) | The `IpcMessage` envelope, the boot-time keyed MAC seed (fatal on RNG failure), the domain-separated BLAKE3 MAC, the constant-comparison integrity check, and its honest scope. |
| [pipe.md](/docs/subsystems/ipc/pipe/) | The anonymous byte FIFO, the ring buffer, the read/write fds, the `EAGAIN` / `EPIPE` / `EBADF` and end-of-stream semantics, and where the fd table consumes it. |

The property that holds across the section is that authority is the kernel's to grant, not
the payload's to claim: a route is checked against the service's required capabilities before
delivery, the sender field is stamped by the kernel rather than supplied by the sender, and
an enqueue into a departed capsule's queue fails closed. The capability masks these checks
read are defined in the [capability model](/docs/security/capabilities-and-tokens/), and the
send and receive calls are part of the `Mk*` family on the [syscall boundary](/docs/subsystems/syscall/boundary/).

## Sources

The code for this subsystem lives under `src/ipc/`: `nonos_inbox/` (the queues and
registry), `nonos_channel/` (the envelope and the MAC; its live surface is `message`,
`hash`, and `error`), `kernel_ipc.rs` (routing and permission), and `pipe/` (the byte
FIFO). The capsule-facing send and receive syscalls are under
`src/syscall/microkernel/ipc/`. Every page is verified against those trees with `file:line`
references.
