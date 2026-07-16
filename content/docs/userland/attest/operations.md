---
title: "The Server and Operations"
description: "This page mirrors userland/capsuleattest/src/server/."
weight: 3
---
This page mirrors `userland/capsule_attest/src/server/`. It covers the receive-reply loop, the reply
builders, the header-validating router, and the five read-only handlers with their exact reply layouts. The
server is stateless: it holds no per-caller state and no secret, and every response is generated
server-side from constants. The module re-exports `run` from [`src/server/mod.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/mod.rs#L21).

Back to the [hub](/docs/userland/attest/).

## The loop

`run` allocates two 64 KiB buffers once and then loops forever
([`src/server/runner.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L27), [`src/protocol/limits.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L18)):

```
  run():
      in_buf  = vec![0; IPC_PAYLOAD_MAX]     runner.rs:28
      out_buf = vec![0; IPC_PAYLOAD_MAX]     runner.rs:29
      loop:
          n = mk_ipc_recv_from(4444, in_buf, RECV_TIMEOUT_MS 0, &sender_pid)   runner.rs:32
          if n <= 0 or sender_pid == 0:  mk_yield; continue                    runner.rs:39
          m = route(in_buf[..n], out_buf)                                      runner.rs:43
          if m > 0:  mk_ipc_reply(sender_pid, out_buf[..m])                    runner.rs:45
```

The service port is 4444 ([`src/server/runner.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L24)). The receive timeout is 0
(`runner.rs:25`), so `mk_ipc_recv_from` does not block indefinitely; an empty receive or a message from
`sender_pid == 0` yields the CPU and retries rather than spinning (`runner.rs:39`). The reply goes back to
the sender pid the kernel reported, which is the attested sender, not a value from the request body.

## The reply builders

[`src/server/respond.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs) wraps the protocol encoders into the two reply shapes every handler uses:

- `status(out, req, code)` writes the header plus a 4-byte status word and returns `HDR_LEN + STATUS_LEN`,
  that is 24 bytes (`respond.rs:19`). This is the whole reply for `OP_HEALTHCHECK`, for any error, and for
  any handler that cannot fit its payload.
- `with_payload(out, req, code, extra)` writes the header, stamps `STATUS_LEN + extra` as the payload
  length, writes the status word, and returns `HDR_LEN + STATUS_LEN + extra` (`respond.rs:25`). Handlers
  write their own payload bytes into `out` starting at offset `HDR_LEN + STATUS_LEN` (offset 24) before
  calling this to finalize the frame.

## The router

`route` is the single dispatch point ([`src/server/handlers/router.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/router.rs#L24)). It calls `parse`; on a parse
error it returns a status-only reply carrying that error and echoing whatever header fields were readable
(`router.rs:25`). On success it matches the opcode to one of the five handlers, and any opcode outside the
five returns `E_BAD_OP` (`router.rs:29`, `router.rs:35`). The payload slice is bound but unused, because no
operation carries a request payload (`router.rs:25`).

| Opcode | Handler | Reply |
|--------|---------|-------|
| `OP_HEALTHCHECK` | `health::run` | status only (`router.rs:30`) |
| `OP_PROOF_SUMMARY` | `proof_summary::run` | summary payload (`router.rs:31`) |
| `OP_PROOF_INVARIANTS` | `proof_invariants::run` | invariants payload (`router.rs:32`) |
| `OP_PROOF_BOOT` | `proof_boot::run` | boot payload (`router.rs:33`) |
| `OP_PROOF_CAPSULE_LIST` | `proof_capsule_list::run` | capsule-mask payload (`router.rs:34`) |

Every handler exposes the same signature, `pub fn run(out: &mut [u8], req: &Request) -> usize`, writing its
reply into `out` and returning the byte count.

## The handlers

Each handler writes its payload after the 24-byte prefix and bounds-checks every write against the output
buffer, returning `E_INVAL` with no partial payload if the reply would not fit. The field encoding is a
4-byte little-endian length followed by the bytes, the same shape everywhere it appears.

### OP_HEALTHCHECK

A bare success. `health::run` returns `respond::status(out, req, 0)` and nothing more
([`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20)). It reads no state and never fails, so a client that gets a status-0
reply on this opcode knows the capsule is alive and answering.

### OP_PROOF_SUMMARY

Three length-prefixed product fields, the name, the tagline, and the version, written in order from the
constants in `state` ([`src/server/handlers/proof_summary.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/proof_summary.rs#L21)). It bounds-checks the running write
position against the buffer and returns `E_INVAL` if the fields would overflow (`proof_summary.rs:27`). The
`write_field` helper writes a 4-byte length then the bytes, and returns 0 if the field alone would not fit
(`proof_summary.rs:33`). The values are covered in [attestation-data.md](/docs/userland/attest/attestation-data/).

### OP_PROOF_INVARIANTS

A 4-byte count followed by six `{name, claim, mechanism}` tuples, each field length-prefixed
([`src/server/handlers/proof_invariants.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/proof_invariants.rs#L21)). Before the count and before each tuple it checks the
remaining space and returns `E_INVAL` if the next write would overflow (`proof_invariants.rs:24`,
`proof_invariants.rs:31`). The count is `INVARIANTS.len()`, so it tracks the table automatically
(`proof_invariants.rs:22`). The six invariants are reproduced in full in
[attestation-data.md](/docs/userland/attest/attestation-data/).

### OP_PROOF_BOOT

A `u64` boot timestamp followed by a length-prefixed fixed label
([`src/server/handlers/proof_boot.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/proof_boot.rs#L22)). This is the only handler that reads a kernel value at request
time: `read_time` calls `mk_time_millis` and clamps a negative return to 0 (`proof_boot.rs:27`,
`proof_boot.rs:39`). The label is the fixed byte string `NØNOS bootloader (hybrid Ed25519 + ML-DSA-65)`
(`proof_boot.rs:28`). It reserves 24 bytes up front and re-checks the buffer before writing the label
(`proof_boot.rs:24`, `proof_boot.rs:32`). This is a boot-identity string plus a timestamp, not a
cryptographic attestation chain; the real measured boot status is read elsewhere, described in
[attestation-data.md](/docs/userland/attest/attestation-data/).

### OP_PROOF_CAPSULE_LIST

A 4-byte count followed by `{name, mask}` entries, where each entry is a length-prefixed name and an 8-byte
little-endian mask ([`src/server/handlers/proof_capsule_list.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/proof_capsule_list.rs#L40)). The table is the `KNOWN_CAPSULES`
constant defined in the same file, seventeen entries (`proof_capsule_list.rs:20`). Before the count and
before each entry it checks the remaining space and returns `E_INVAL` on overflow
(`proof_capsule_list.rs:42`, `proof_capsule_list.rs:49`). The table and what it is good for are covered in
[attestation-data.md](/docs/userland/attest/attestation-data/).

## Syscall surface

The server calls only these libc syscalls; the capsule makes no outbound IPC calls of its own
([`src/main.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L26), [`src/server/runner.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L19), [`src/server/handlers/proof_boot.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/proof_boot.rs#L17)):

```
  heap_init          one-time heap setup at _start           (main.rs:30)
  mk_ipc_recv_from   receive a request on port 4444           (runner.rs:32)
  mk_ipc_reply       reply to the attested sender pid         (runner.rs:45)
  mk_yield           yield when there is nothing to serve     (runner.rs:40)
  mk_time_millis     the monotonic boot clock, OP_PROOF_BOOT only (proof_boot.rs:40)
  mk_exit            exit 1 if heap_init fails                (main.rs:31)
```

## Source map

```
  src/server/mod.rs                        re-exports run
  src/server/runner.rs                     the recv-reply loop on port 4444
  src/server/respond.rs                    status / with_payload reply builders
  src/server/handlers/mod.rs               re-exports route
  src/server/handlers/router.rs            parse + op dispatch, E_BAD_OP
  src/server/handlers/health.rs            OP_HEALTHCHECK
  src/server/handlers/proof_summary.rs     OP_PROOF_SUMMARY
  src/server/handlers/proof_invariants.rs  OP_PROOF_INVARIANTS
  src/server/handlers/proof_boot.rs        OP_PROOF_BOOT (mk_time_millis + fixed label)
  src/server/handlers/proof_capsule_list.rs OP_PROOF_CAPSULE_LIST (the authored mask table)
```

Every reference above is verified against `userland/capsule_attest/src/server/`.
</content>
