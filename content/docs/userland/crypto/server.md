---
title: "The Server Loop and Wipe Discipline"
description: "This page mirrors userland/capsulecrypto/src/server/: the request loop, the one-match op router, and the volatile buffer wipe that makes the pool stateless."
weight: 2
---
This page mirrors `userland/capsule_crypto/src/server/`: the request loop, the one-match op router, and
the volatile buffer wipe that makes the pool stateless. For the frame the loop decodes see
[operations.md](/docs/userland/crypto/operations/); for the handlers the router calls see [primitives.md](/docs/userland/crypto/primitives/); for
the identity and mask see the [README](/docs/userland/crypto/).

## The loop

`server::run` is the whole runtime and it never returns ([`src/server/runner.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L29)). It allocates one
receive buffer of `MAX_MSG = HDR_LEN + MAX_PAYLOAD_BYTES` (`runner.rs:27`), sized once for the worst-case
payload so no per-request allocation of the input buffer is needed, and then loops:

1. Block on `mk_ipc_recv(0, ...)`, reading into the buffer from inbox 0 (`runner.rs:32`). A non-positive
   length is ignored and the loop continues, so a spurious wake does not process stale bytes
   (`runner.rs:33`).
2. Decode the first `n` bytes. On success dispatch the request; on any decode error build a single
   `EINVAL` reply with op 0 (`runner.rs:37`).
3. Send the reply to the fixed kernel reply endpoint `KERNEL_REPLY_ENDPOINT` = `0x1_0000_0004`
   (`runner.rs:41`, [`src/protocol/types.rs:62`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L62)). The send result is deliberately discarded; the loop does
   not stall on a send failure.
4. Wipe exactly the `n` bytes it received before waiting for the next message (`runner.rs:42`).

The capsule is a pure server: it receives on inbox 0 and replies to one fixed endpoint. It makes no
outbound calls of its own and speaks only the NOCX frame. There is no per-caller state, no key store, and
no session, so a request never depends on a prior one.

## The dispatch

`dispatch` is a single match from `req.op` to one handler ([`src/server/dispatch.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L29)). Every arm calls a
handler that returns the already-encoded reply `Vec<u8>`; the router does no encoding of its own except
the fall-through. All seventeen opcodes are wired here (`dispatch.rs:30` through `:46`), and any op with no
arm falls to `_ =>`, which returns `EINVAL` carrying the request's own op, flags, and request_id
(`dispatch.rs:47`). The handlers are declared and re-exported one per file through [`handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/handlers/mod.rs#L17)
and `:37`, so adding an op is one module, one re-export, and one match arm. See
[contributing.md](/docs/userland/crypto/contributing/) for the full sequence.

## The wipe

The wipe is what makes statelessness real rather than nominal. After every reply, `wipe` walks the `n`
received bytes and writes each through `core::ptr::write_volatile(byte, 0)`, then issues a `SeqCst`
compiler fence ([`src/server/wipe.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/wipe.rs#L19)). The volatile write and the fence together stop the compiler from
eliding the zeroing as a dead store, which a plain `for byte in buf { *byte = 0 }` over a buffer about to
be reused could otherwise be optimized away. Because a request's key bytes, plaintext, and private scalars
all landed in this one buffer, wiping it clears them before the next `recv` overwrites part of it.

One handler wipes more than the shared buffer. `x25519_shared` copies the caller's private scalar into a
stack array to build the `StaticSecret`, then calls the same `wipe` over that stack copy after encoding
the reply ([`src/server/handlers/x25519_shared.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/x25519_shared.rs#L35)). That is the only per-handler secret wipe; every
other handler relies on the receive-buffer wipe in the loop to reach its intermediate bytes. That
reliance is honest but not total, and it is the first item under honest gaps in the
[transport](/docs/userland/crypto/transport/) security discussion.

## Statelessness as isolation

The pool holds no `FileSystem` capability, so a compromised crypto crate cannot write to a storage
surface; no `Network`, so it cannot exfiltrate a key it was handed to seal with; no driver, MMIO, IRQ,
DMA, or PIO capability, so it cannot reach hardware; and no `Debug`, so it cannot log the plaintext it
processes (mask decomposed on the [README](/docs/userland/crypto/), `Capsule.mk:16`). Its positive isolation property
is that nothing survives a request: the buffer is wiped, the reply endpoint `0x1_0000_0004` is distinct
from ramfs, keyring, and entropy so concurrent in-flight replies cannot cross-route (`types.rs:60`), and
there is no state for one caller to leave behind for the next.

## Source map

```
  userland/capsule_crypto/src/server/mod.rs        the module tree; re-exports run
  userland/capsule_crypto/src/server/runner.rs     the recv/decode/dispatch/send/wipe loop
  userland/capsule_crypto/src/server/dispatch.rs   op -> handler match; unknown op = EINVAL
  userland/capsule_crypto/src/server/wipe.rs       the volatile write_volatile + SeqCst fence
  userland/capsule_crypto/src/server/handlers/mod.rs         one module per handler, re-exported
  userland/capsule_crypto/src/server/handlers/x25519_shared.rs  the one per-handler scalar wipe
  userland/capsule_crypto/src/protocol/types.rs    KERNEL_REPLY_ENDPOINT, MAX_PAYLOAD_BYTES
```

Every reference above is verified against those trees.
