---
title: "Core Service Capsules"
description: "The core services are the capsules the rest of the system depends on: the two filesystems, the key store, the entropy and crypto pools, the typed config store, and the install, ..."
weight: 500
---
The core services are the capsules the rest of the system depends on: the two filesystems, the key store,
the entropy and crypto pools, the typed config store, and the install, payment, market, attest, and power
rails. Each is a signed userland capsule that registers a named service endpoint at boot and then runs a
single request loop over `mk_ipc_*`. None of them is part of the kernel trusted computing base; they are
ordinary capsules that other capsules reach by name through the service registry.

Each service here already has a dedicated, verified deep page covering its server loop, wire protocol,
per-operation logic, state model, security, and honest gaps. This page is the index and the cross-service
view: exact endpoint, exact capability mask, the full operation set, who depends on it, and where it sits in
the boot order. Every value below is read from that capsule's `Capsule.mk` and its `src/` tree.

| Capsule | Service endpoint | Caps | What it is |
|---------|------------------|------|-----------|
| [vfs](/docs/userland/vfs/) | `service:4104:vfs_pool` | `0x19` | The application filesystem: 15-op store, per-caller FD table, kernel-attested caller pid, `/capsules` read-only. |
| [ramfs](/docs/userland/ramfs/) | `service:4096:ramfs` | `0x38` | The `/ram` filesystem, per-file ChaCha20-Poly1305 with a fresh nonce on every write. |
| [keyring](/docs/userland/keyring/) | `service:4098:keyring` | `0x39` | The key store and wallet signer: owner-pid isolation, secure wipe on drop, ETH/NOX signing. |
| [entropy](/docs/userland/entropy/) | `service:4100:entropy_pool` | `0x39` | The RDRAND-backed random-bytes service with observability counters. |
| [crypto](/docs/userland/crypto/) | `service:4102:crypto_pool` | `0x39` | The stateless crypto compute pool with per-op payload limits and request-buffer wipe. |
| [policy](/docs/userland/policy/) | `service:4108:policy` | `0x219` | The typed config store; reads open, writes gated to the settings and setup-wizard apps. |
| [attest](/docs/userland/attest/) | `service:4444:attest` | `0x19` | System info and stated invariants. Honestly: text claims and a boot label, not cryptographic proofs. |
| [installer](/docs/userland/installer/) | `service:4112:installer` | `0x19` | Loads capsules through the kernel's verified-load syscall; trust is the kernel's. |
| [payment](/docs/userland/payment/) | `service:4110:payment` | `0x19` | Assembles NOX receipts and gets them signed by the keyring; per-payer nonces and a drain queue. |
| [market](/docs/userland/market/) | `service:4106:market.index` | `0x19` | Serves the signed app index; real Ed25519 verifier (reject-all stub under `offline-verify`). |
| [power](/docs/userland/power/) | `service:4448:power` | `0x219` | Reboot and shutdown through the kernel admin syscalls. |
| [process-manager](/docs/userland/process-manager/) | `service:4730:app.process_manager` | `0x1819` | A GUI viewer of running services and CPU usage via `mk_proc_stat`. |

Each endpoint string is the literal `CAPSULE_SERVICE_ENDPOINT` from that capsule's `Capsule.mk`
(`service:<port>:<name>`), and each mask is its `CAPSULE_REQUIRED_CAPS`. The reply endpoints
(`reply:<port+1>:...`) are the paired inbox the kernel client owns for that service.

## The two filesystems

There are two filesystem services and they are not interchangeable.

[vfs](/docs/userland/vfs/) (`vfs_pool` on port 4104, mask `0x19`) is the application filesystem. Its wire protocol
([`userland/capsule_vfs/src/protocol/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/protocol/types.rs#L17)) is `MAGIC 0x4E4F5646` ("NOVF"), version 1, a 20-byte
header, and fifteen operations numbered 1 through 15: `OP_OPEN`, `OP_CLOSE`, `OP_READ`, `OP_WRITE`,
`OP_STAT`, `OP_LIST`, `OP_HEALTHCHECK`, `OP_MKDIR`, `OP_UNLINK`, `OP_RENAME`, `OP_COPY`, `OP_RMDIR`,
`OP_TRUNCATE`, `OP_USAGE`, `OP_CHMOD` (`types.rs:20`). Every mutating handler takes a caller pid in the
payload and passes it through `split_caller`, which requires the payload pid to match the kernel-attested
sender when the message came from a real process ([`userland/capsule_vfs/src/server/handlers/util.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/util.rs#L47)),
so the FD table and per-path ownership are keyed on an attested identity rather than a self-declared one.

[ramfs](/docs/userland/ramfs/) (`ramfs` on port 4096, mask `0x38`) is the `/ram` filesystem. Its protocol
([`userland/capsule_ramfs/src/protocol/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/protocol/types.rs#L17)) is smaller: an 8-byte header and five operations,
`OP_OPEN`, `OP_CLOSE`, `OP_READ`, `OP_WRITE`, `OP_TRUNCATE` (1 through 5). Every file is stored encrypted:
the store holds a per-file key and nonce ([`userland/capsule_ramfs/src/store/types.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/types.rs#L25)) and rolls a fresh
nonce on each write through `fresh_nonce` ([`userland/capsule_ramfs/src/store/crypto/fresh_nonce.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/crypto/fresh_nonce.rs#L22)),
sealing and opening with ChaCha20-Poly1305 ([`userland/capsule_ramfs/src/store/crypto/mod.rs:16`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/crypto/mod.rs#L16)). That is
why ramfs is the one filesystem carrying the Crypto bit; vfs does not.

## The security pools

[keyring](/docs/userland/keyring/) (`keyring` on port 4098, mask `0x39`) is both the key store and the wallet signer. Its
protocol ([`userland/capsule_keyring/src/protocol/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/protocol/types.rs#L17)) has fourteen operations: `OP_STORE`,
`OP_RETRIEVE`, `OP_DELETE`, `OP_LOCK`, `OP_UNLOCK`, `OP_METADATA`, `OP_COUNT`, then the wallet verbs
`OP_WALLET_IMPORT`, `OP_WALLET_GENERATE`, `OP_WALLET_ADDRESS`, `OP_SIGN_NOX_RECEIPT`, `OP_SIGN_NOX_APPROVE`,
`OP_SIGN_ETH_TRANSFER`, `OP_LIST_WALLET_RAILS` (1 through 14). Key bytes are wiped through `secure_wipe` both
on explicit delete ([`userland/capsule_keyring/src/store/delete.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/store/delete.rs#L29)) and in the `Drop` for a key entry
([`userland/capsule_keyring/src/store/types/key_entry.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/store/types/key_entry.rs#L30)), so a dropped or overwritten key does not linger
in the capsule heap. The capsule is the keyring authority, so it does not itself hold `Capability::Keyring`;
callers carry that bit and reach it over IPC (`userland/capsule_keyring/Capsule.mk:1`).

[entropy](/docs/userland/entropy/) (`entropy_pool` on port 4100, mask `0x39`) is the random-bytes service. Its protocol
([`userland/capsule_entropy/src/protocol/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_entropy/src/protocol/types.rs#L26)) is `MAGIC 0x4E4F454E` ("NOEN"), version 1, a 20-byte
header, four operations: `OP_GET_RANDOM`, `OP_GET_STATS`, `OP_RESEED`, `OP_HEALTHCHECK` (1 through 4). Random
bytes come from RDRAND with a bounded retry loop ([`userland/capsule_entropy/src/pool/fill.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_entropy/src/pool/fill.rs#L22)), and the
pool keeps observability counters, `bytes_served` and `last_reseed_request`
([`userland/capsule_entropy/src/pool/new.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_entropy/src/pool/new.rs#L24)), returned by `OP_GET_STATS`
([`userland/capsule_entropy/src/pool/encode_stats.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_entropy/src/pool/encode_stats.rs#L18)). A single random draw is capped at 4096 bytes
(`MAX_RANDOM_BYTES`, `types.rs:36`).

[crypto](/docs/userland/crypto/) (`crypto_pool` on port 4102, mask `0x39`) is the stateless compute pool. The dispatch
table ([`userland/capsule_crypto/src/server/dispatch.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_crypto/src/server/dispatch.rs#L28)) routes seventeen operations. The base set lives
in [`protocol/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/protocol/types.rs): `OP_BLAKE3_HASH` (1), `OP_SHA3_256_HASH` (2), `OP_HEALTHCHECK` (3), `OP_SHA256_HASH`
(4), `OP_SHA512_HASH` (5), `OP_ED25519_VERIFY` (6), `OP_CHACHA20_POLY1305_SEAL` (10),
`OP_CHACHA20_POLY1305_OPEN` (11), `OP_AES256_GCM_SEAL` (12), `OP_AES256_GCM_OPEN` (13). The extended set is in
[`protocol/primitives.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/protocol/primitives.rs#L17): `OP_X25519_PUBLIC` (14), `OP_X25519_SHARED` (15), `OP_HMAC_SHA256` (16),
`OP_HKDF_SHA256` (17), `OP_P256_ECDSA_VERIFY` (18), `OP_P384_ECDSA_VERIFY` (19), `OP_SHA384_HASH` (20). Each
handler enforces its own payload-size limit and the request buffer is wiped after use
([`userland/capsule_crypto/src/server/wipe.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_crypto/src/server/wipe.rs#L19)). The pool holds no keys and keeps no state between
requests, which is why "per-op caps" here means per-op payload limits, not per-op capability checks.

## Config, attest, and the admin rails

[policy](/docs/userland/policy/) (`policy` on port 4108, mask `0x219`) is the typed config store. Its protocol crate
([`userland/policy_proto/src/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/ops.rs#L17)) has two operations, `OP_GET` (0x0001) and `OP_SET` (0x0002), over
typed fields with kinds bool/u8/i8/str. Reads are open; writes are gated. The write handler only accepts a
`SET` from a sender whose kernel-attested pid resolves to `app.settings` or `app.setup_wizard`, and returns
`E_ACCES` otherwise ([`userland/capsule_policy/src/server/handle_set.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/handle_set.rs#L23)). Fields that mirror into the
kernel are pushed through the `mk_admin_policy_push` syscall ([`userland/capsule_policy/src/push/raw.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/push/raw.rs#L17)),
which is why policy carries the Admin bit.

[attest](/docs/userland/attest/) (`attest` on port 4444, mask `0x19`) reports system state. Its operations
([`userland/capsule_attest/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_attest/src/protocol/ops.rs#L17)) are `OP_HEALTHCHECK` (0x0001), `OP_PROOF_SUMMARY`
(0x0002), `OP_PROOF_INVARIANTS` (0x0003), `OP_PROOF_BOOT` (0x0004), `OP_PROOF_CAPSULE_LIST` (0x0005). The
naming is aspirational; what it returns is human-authored invariant text and a boot label, not a
cryptographic proof. Its `Capsule.mk` deliberately withholds the Debug capability so it cannot emit serial
markers, which is the point of a no-logs attester (`userland/capsule_attest/Capsule.mk:11`).

[installer](/docs/userland/installer/) (`installer` on port 4112, mask `0x19`) is the install authority. Its operations
([`userland/capsule_installer/src/protocol/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_installer/src/protocol/types.rs#L17)) are `OP_HEALTHCHECK` (1), `OP_INSTALL` (2),
`OP_LOAD_FROM_STORE` (3), `OP_LOAD_BY_NAME` (4). It holds no key material: it loads capsules through the
kernel's verified-load syscall `mk_capsule_load` ([`userland/capsule_installer/src/server/selfinstall.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_installer/src/server/selfinstall.rs#L20)),
so all verification trust sits in the kernel, not the installer. Its only build feature is
`nonos-autorun-install`, an off-by-default headless self-verification path
([`userland/capsule_installer/Cargo.toml:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_installer/Cargo.toml#L23)); it has no `offline-verify` feature.

[payment](/docs/userland/payment/) (`payment` on port 4110, mask `0x19`) issues NOX install receipts. Its operations
([`userland/capsule_payment/src/protocol/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_payment/src/protocol/types.rs#L17)) are `OP_HEALTHCHECK` (1), `OP_PAY` (2),
`OP_DRAIN_RECEIPTS` (3), `OP_LIST_TOKENS` (4). It holds no keys: it assembles the receipt fields, including a
per-payer nonce ([`userland/capsule_payment/src/server/sign_call.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_payment/src/server/sign_call.rs#L40)), and calls the keyring over IPC to
sign ([`userland/capsule_payment/src/server/consts.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_payment/src/server/consts.rs#L20)). Issued receipts sit in a drain queue that the
installer pulls with `OP_DRAIN_RECEIPTS` ([`userland/capsule_payment/src/server/handlers/drain.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_payment/src/server/handlers/drain.rs#L23)).

[market](/docs/userland/market/) (`market.index` on port 4106, mask `0x19`) serves the signed app index. Its operations
([`userland/capsule_market/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/protocol/ops.rs#L17)) are `OP_LOAD_INDEX` (1), `OP_LIST_APPS` (2), `OP_GET_APP`
(3), `OP_GET_RELEASE` (4), `OP_INSTALL_READY` (5), `OP_HEALTHCHECK` (6). The production verifier calls the
kernel-routed `crypto_ed25519_verify` on the index signature
([`userland/capsule_market/src/verify/crypto.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/verify/crypto.rs#L17)). The `offline-verify` build feature swaps that for a
development reject-all stub ([`userland/capsule_market/src/verify/mod.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/verify/mod.rs#L18),
[`userland/capsule_market/Cargo.toml:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/Cargo.toml#L35)).

[power](/docs/userland/power/) (`power` on port 4448, mask `0x219`) is the reset rail. Its operations
([`userland/capsule_power/src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_power/src/protocol/ops.rs#L17)) are `OP_HEALTHCHECK` (0x0001), `OP_REBOOT` (0x0002),
`OP_SHUTDOWN` (0x0003), which drive the kernel `AdminReboot` and `AdminShutdown` syscalls; the Admin bit
gates them and Debug is deliberately absent so a power-off never leaks to serial
(`userland/capsule_power/Capsule.mk:10`).

[process-manager](/docs/userland/process-manager/) (`app.process_manager` on port 4730, mask `0x1819`) is a GUI viewer,
not a service other capsules call. It samples the process table through the read-only `mk_proc_stat` syscall
([`userland/capsule_process_manager/src/pm/sample.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_process_manager/src/pm/sample.rs#L17)) and paints the running services and their CPU
history. It holds no authority over the processes it observes; the two graphics bits in its mask are for the
surface it paints into.

## Boot order

The kernel init spawn plan brings the core services up in a fixed order, each through
`capsule_boot::boot`, which spawns the capsule, emits `boot_log::ok(prefix, "capsule spawned")` on success,
and registers it in the lifecycle table ([`src/userspace/init/capsule_boot/run.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L27)). ramfs comes first
because the rest of the store layer needs it ([`src/userspace/init/spawn_plan/core.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/core.rs#L17)); once it is up,
`spawn_after_ramfs` brings keyring, entropy, crypto, and policy in that sequence
([`spawn_plan/core.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/spawn_plan/core.rs#L22)); then vfs and market ([`spawn_plan/core.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/spawn_plan/core.rs#L29), `:35`). The desktop-services pass
adds attest and installer ([`src/userspace/init/spawn_plan/desktop_services.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_services.rs#L20)), and the apps-tools pass
adds the process-manager viewer ([`src/userspace/init/spawn_plan/apps_tools.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps_tools.rs#L20)).

Two rails in the table are built into the image but not spawned by the init fleet. payment (:4110) and power
(:4448) have their `Capsule.mk` included by the Makefile, so they exist and register, but they emit no boot
marker in the init sequence. For those two the test that they are up is a resolving `mk_service_lookup`, not
a boot line.

## Security analysis

Read the mask column as a least-privilege statement and a pattern falls out. The baseline for a service is
`0x19`: CoreExec (1), IPC (8), Memory (16). Five capsules run on exactly that and nothing more: vfs, attest,
installer, payment, and market. None of them holds a hardware capability (Driver, Mmio, Irq, Dma, Pio), so no
filesystem, install, payment, or market bug can reach a device. The Crypto bit (32) is added only where a
capsule genuinely computes crypto, giving `0x39` for keyring, entropy, and crypto; the ramfs mask `0x38` is
that set minus CoreExec, because ramfs encrypts every file but is not itself an entry-point image the way the
others are.

An authority inversion is deliberate and worth stating plainly. The keyring does not hold
`Capability::Keyring` and the entropy pool does not hold `Capability::Entropy`; those bits live on the
callers, and the capsule is reached through IPC (`userland/capsule_keyring/Capsule.mk:1`,
`userland/capsule_entropy/Capsule.mk:1`). The service is the authority, so it must not also carry the
caller-facing gate for itself. The same is true of vfs and crypto: `CAP_VFS` and `CAP_CRYPTO` are gates the
caller presents, not bits the pool holds.

The Admin bit (512) is the one elevated power in the fleet, and it appears in exactly two masks: `0x219` for
policy and power, the capsules that push a kernel policy field and reset the machine respectively. In both,
Admin is the only capability beyond the service baseline. The one GUI member, process-manager, carries
`0x1819`, the baseline plus the two graphics bits it needs to paint, and no authority over the processes it
observes. So no core service holds FileSystem it does not use, no service holds a hardware capability, and the
only Admin-class power in the set is confined to the two capsules whose whole job is a privileged verb.

Two load-bearing caveats. First, policy's write gate is by service name (`app.settings`, `app.setup_wizard`)
rather than a fine-grained capability ([`userland/capsule_policy/src/server/handle_set.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/handle_set.rs#L23)), a real trust
concentration on those two apps: anything that can impersonate their pid could write policy. The gate does
resolve the sender's pid through the kernel service registry rather than trusting a self-declared name, so it
is an attested check, but its granularity is the whole settings surface, not the individual field. Second,
attest returns human-authored claims and a boot label, not proofs; the real
[proof system](https://github.com/NON-OS/nonos-micro-kernel/blob/main/subsystems/proof-system/README.md) is in the kernel.

## Debugging

Every core service that the init fleet spawns prints a boot marker through `capsule_boot::boot`
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)), which emits `boot_log::ok(prefix, "capsule spawned")` on
success and a `boot_log::error` line carrying the `SpawnError` on failure (`run.rs:32`). On a machine with no
serial port a `NONOS_FBCONSOLE=1` build mirrors these to the framebuffer. The first question for any core
service, did it load, is that marker; the second, did it register, is whether a caller's `mk_service_lookup`
on its name resolves.

```
  [RAMFS] capsule spawned                spawn_plan/core.rs:19               ramfs :4096
  [VFS] capsule spawned                  spawn_plan/core.rs:32               vfs_pool :4104
  [MARKET] capsule spawned               spawn_plan/core.rs:39               market.index :4106
  [KEYRING] capsule spawned              spawn_plan/core.rs:48               keyring :4098
  [ENTROPY] capsule spawned              spawn_plan/core.rs:54               entropy_pool :4100
  [CRYPTO] capsule spawned               spawn_plan/core.rs:60               crypto_pool :4102
  [POLICY] capsule spawned               spawn_plan/core.rs:67               policy :4108
  [ATTEST] capsule spawned               spawn_plan/desktop_services.rs:29   attest :4444
  [INSTALLER] capsule spawned            spawn_plan/desktop_services.rs:37   installer :4112
  [APP-PROCESS-MANAGER] capsule spawned  spawn_plan/apps_tools.rs:52         app.process_manager :4730
```

The two rails not in that list, payment (:4110) and power (:4448), are built into the image but not spawned by
the init plan, so they emit no boot marker in the fleet. For those two the test that they are up is a
resolving `mk_service_lookup`, not a boot line, and for payment the practical tell is that the installer's
paid path returns `EAGAIN` when it cannot reach the payment service
([`userland/capsule_installer/src/protocol/types.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_installer/src/protocol/types.rs#L27)). Each deep page carries that capsule's own
request-time failure signatures.

Two request-time gotchas that show up as `EINVAL` rather than a missing service. The header-carrying pools,
entropy and crypto, reject any envelope whose magic or version does not match before a handler runs
([`userland/capsule_entropy/src/protocol/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_entropy/src/protocol/types.rs#L26), [`userland/capsule_crypto/src/protocol/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_crypto/src/protocol/types.rs#L17)), so
a stale or wrong-protocol client fails cleanly at the door. And a vfs mutating call from a real process whose
payload pid does not match the kernel-attested sender is rejected in `split_caller`
([`userland/capsule_vfs/src/server/handlers/util.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/util.rs#L47)); a caller that forgets to fill in its own pid will
see that failure and not a store error.

The shared model, service registration, verified spawn, and the IPC request loop, is the
[userland overview](/docs/); the flat inventory of every handle and port is the
[capsule inventory](/docs/userland/capsules/).

## Source map

- Endpoints and capability masks: each capsule's `userland/capsule_<name>/Capsule.mk`
  (`CAPSULE_SERVICE_ENDPOINT`, `CAPSULE_REQUIRED_CAPS`).
- vfs: [`userland/capsule_vfs/src/protocol/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/protocol/types.rs), [`userland/capsule_vfs/src/server/handlers/util.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_vfs/src/server/handlers/util.rs).
- ramfs: [`userland/capsule_ramfs/src/protocol/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/protocol/types.rs), `userland/capsule_ramfs/src/store/crypto/`,
  [`userland/capsule_ramfs/src/store/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_ramfs/src/store/types.rs).
- keyring: [`userland/capsule_keyring/src/protocol/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/protocol/types.rs), [`userland/capsule_keyring/src/store/delete.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/store/delete.rs),
  [`userland/capsule_keyring/src/store/types/key_entry.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_keyring/src/store/types/key_entry.rs).
- entropy: [`userland/capsule_entropy/src/protocol/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_entropy/src/protocol/types.rs), `userland/capsule_entropy/src/pool/`.
- crypto: [`userland/capsule_crypto/src/protocol/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_crypto/src/protocol/types.rs),
  [`userland/capsule_crypto/src/protocol/primitives.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_crypto/src/protocol/primitives.rs), [`userland/capsule_crypto/src/server/dispatch.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_crypto/src/server/dispatch.rs),
  [`userland/capsule_crypto/src/server/wipe.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_crypto/src/server/wipe.rs).
- policy: [`userland/policy_proto/src/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/policy_proto/src/ops.rs), [`userland/capsule_policy/src/server/handle_set.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/server/handle_set.rs),
  [`userland/capsule_policy/src/push/raw.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_policy/src/push/raw.rs).
- attest: [`userland/capsule_attest/src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_attest/src/protocol/ops.rs), `userland/capsule_attest/Capsule.mk`.
- installer: [`userland/capsule_installer/src/protocol/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_installer/src/protocol/types.rs),
  [`userland/capsule_installer/src/server/selfinstall.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_installer/src/server/selfinstall.rs), [`userland/capsule_installer/Cargo.toml`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_installer/Cargo.toml).
- payment: [`userland/capsule_payment/src/protocol/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_payment/src/protocol/types.rs),
  [`userland/capsule_payment/src/server/sign_call.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_payment/src/server/sign_call.rs), [`userland/capsule_payment/src/server/handlers/drain.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_payment/src/server/handlers/drain.rs).
- market: [`userland/capsule_market/src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/protocol/ops.rs), [`userland/capsule_market/src/verify/crypto.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/verify/crypto.rs),
  [`userland/capsule_market/src/verify/mod.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/src/verify/mod.rs), [`userland/capsule_market/Cargo.toml`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_market/Cargo.toml).
- power: [`userland/capsule_power/src/protocol/ops.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_power/src/protocol/ops.rs), `userland/capsule_power/Capsule.mk`.
- process-manager: [`userland/capsule_process_manager/src/pm/sample.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_process_manager/src/pm/sample.rs),
  `userland/capsule_process_manager/Capsule.mk`.
- Boot order and markers: [`src/userspace/init/capsule_boot/run.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs), [`src/userspace/init/spawn_plan/core.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/core.rs),
  [`src/userspace/init/spawn_plan/desktop_services.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/desktop_services.rs), [`src/userspace/init/spawn_plan/apps_tools.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps_tools.rs),
  [`src/userspace/init/spawn_plan/boot.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/boot.rs).

Every reference above is verified against those trees.
