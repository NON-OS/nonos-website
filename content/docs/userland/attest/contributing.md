---
title: "Contributing"
description: "Where to work in capsuleattest, how to add an operation or an invariant, the build and sign steps, and the code standards the capsule must meet."
weight: 5
---
Where to work in `capsule_attest`, how to add an operation or an invariant, the build and sign steps, and
the code standards the capsule must meet. Back to the [hub](/docs/userland/attest/).

## Module map

```
  userland/capsule_attest/
    Capsule.mk                    slug, handle, ports, mask 0x19, kernel mirror
    Cargo.toml                    the attest binary, panic = abort release profile
    src/main.rs                   _start -> heap_init -> server::run
    src/protocol/                 the wire format          -> ../attest/protocol.md
    src/server/                   the loop, router, handlers -> ../attest/operations.md
    src/state/                    the authored tables      -> ../attest/attestation-data.md

  src/userspace/capsule_attest/   the kernel-side mirror
    embed.rs                      includes the ELF + signed artifacts at build time
    spawn.rs                      decodes the trust anchor, calls spawn_verified with caps 0x19
    state.rs                      the lifecycle CapsuleState and shared_state()
```

The wire protocol is under `src/protocol/`, the server loop and per-op handlers under `src/server/`, and
the authored tables under `src/state/`. The kernel-side embed, verified-spawn wiring, and lifecycle state
are the mirror at `src/userspace/capsule_attest/`.

## Adding or changing an operation

1. Add the opcode constant to [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17) and re-export it from [`src/protocol/mod.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L29).
2. Write the handler as one file under `src/server/handlers/`, exposing
   `pub fn run(out: &mut [u8], req: &Request) -> usize` that writes its reply into `out` and returns the
   byte count. Write the payload after the 24-byte prefix (`HDR_LEN + STATUS_LEN`), bounds-check every
   write, and return `respond::status(out, req, E_INVAL)` if the reply would not fit. Mirror
   [`src/server/handlers/proof_invariants.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/proof_invariants.rs#L21), which does the count-then-tuples pattern with per-entry
   overflow checks.
3. Wire it into the module list and the dispatch match at [`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17) and
   [`src/server/handlers/router.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/router.rs#L29).
4. If the handler reads new authored data, add it under `src/state/` as one unit per file and re-export it
   from [`src/state/mod.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/mod.rs#L20).

Keep every reply framed by `respond::status` or `respond::with_payload` so the header echo and the status
word stay consistent; do not hand-write the header in a handler.

## Adding an invariant

Append an `Invariant { name, claim, mechanism }` to the `INVARIANTS` array in
[`src/state/invariants.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/invariants.rs#L23). The count in the reply is derived from `INVARIANTS.len()`, so no other code
changes ([`src/server/handlers/proof_invariants.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/proof_invariants.rs#L22)). Two rules keep the table honest: the `mechanism`
must name real, citable kernel code, not a hope; and the invariant must not require the capsule to gain a
new capability, because the mask is the point. If a new claim would need `Crypto` or `FileSystem`, it does
not belong in this capsule.

## Adding a capsule to the mask table

Append a `(name, mask)` tuple to `KNOWN_CAPSULES` in [`src/server/handlers/proof_capsule_list.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/proof_capsule_list.rs#L20). The
mask must match the capsule's `Capsule.mk` `CAPSULE_REQUIRED_CAPS`, and it must not carry the `Debug` bit
(256), or the NO LOGS check the table exists to support would fail against its own data.

## Build and sign

Build and sign the capsule with the generated per-slug make targets. `nonos-mk/capsule.mk` expands these
from the slug in `Capsule.mk`, which the top-level Makefile includes at `Makefile:682`
(`nonos-mk/capsule.mk:158`):

```
  make nonos-mk-attest              build the capsule ELF
  make nonos-mk-attest-sign         produce the id cert, manifest, and attestation trailer
  make nonos-mk-attest-verify       verify the signed artifacts against the trust anchor
  make nonos-mk-check-attest-keys   check the per-capsule signing keys exist
```

The signed artifacts land in `nonos-data/trust/capsules/attest.{nonos_id_cert,manifest,zk_trailer}.bin`,
which the kernel embed includes at build time ([`src/userspace/capsule_attest/embed.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_attest/embed.rs#L22),
`embed.rs:26`, `embed.rs:30`). The capsule is
attested as part of the desktop-services set the boot fleet builds
(`make nonos-mk-all-capsules-attested`, `Makefile:709`), and it is pulled into the production desktop
images through its `$(attest_ARTIFACTS)` group (`Makefile:1087`, `Makefile:1116`, `Makefile:1138`).

## Code standards

- `cargo fmt` and a clean `cargo clippy`.
- No panics, `unwrap`, or `expect` in capsule code. Every handler returns an error status, never a panic;
  the release profile is `panic = "abort"` (`Cargo.toml:25`).
- Modular files, one unit per file, with `mod.rs` used only for re-exports
  ([`src/server/mod.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/mod.rs#L21), [`src/protocol/mod.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L24), [`src/state/mod.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/mod.rs#L20)).
- The AGPL header at the top of every source file, matching the header on every existing module.
- Do not request a new capability. The mask `0x19` is a documented invariant of this capsule; any change
  that would widen it needs to be justified against the NO LOGS and scope arguments on the [hub](/docs/userland/attest/).
</content>
