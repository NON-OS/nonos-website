---
title: "Debugging capsule_market"
description: "This page lists the log markers the market and its boot path emit, and the concrete failure modes with where to look for each."
weight: 6
---
This page lists the log markers the market and its boot path emit, and the concrete failure modes with
where to look for each. For the shell of the design read the [README](/docs/userland/market/), the [protocol](/docs/userland/market/protocol/)
page, the [verification](/docs/userland/market/verification/) page, and the [readiness](/docs/userland/market/readiness/) page.

## Log markers

The first thing to confirm is that the capsule ran. On a successful boot the kernel logs `[MARKET] capsule
spawned` from the boot path: the `Ok` arm calls `boot_log::ok(prefix, "capsule spawned")`
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). If that line is absent the capsule never started, and the
`Err` arm logged an error line through `boot_log::error` instead ([`capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/capsule_boot/run.rs#L32)), which is the
usual signature, manifest, or capability failure. The kernel-side spawn also carries a `[MARKET-DEBUG]
load_elf_executable error:` tag on an ELF load failure ([`src/security/market_capsule/spawn.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/security/market_capsule/spawn.rs#L57)).

A present marker means `market.index` resolves on service port 4106 for the desktop and the installer; an
absent one means the app catalog is unavailable. The market is gated behind the `nonos-capsule-market`
feature; with the feature off, `spawn_market` is a no-op and no marker appears at all
([`src/userspace/init/spawn_plan/core.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/core.rs#L42)).

## Failure modes

Every failure the capsule reports is an errno on a reply, not a log line, because the capsule answers over
IPC and the caller renders the reply. Read the status word, then the body if any.

### E_KEYREJECTED on LOAD_INDEX

In a production build this means the operator signature did not verify against the trusted operator key, or
the operator key is not in the trusted set at all; both `SignatureRefused` and `UntrustedOperator` map to
this one errno ([`src/server/handlers/load_index.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/load_index.rs#L42), `load_index.rs:43`). But in an `offline-verify`
development build every index is refused by `RejectAll` no matter what its signature is
([`src/verify/reject_all.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/verify/reject_all.rs#L22)), so `E_KEYREJECTED` on a build you expected to accept a valid index is the
first thing to check against the compile-time feature ([`src/main.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L37), `Cargo.toml:29`). See the
[verification](/docs/userland/market/verification/) page for the real-verifier-versus-stub swap.

### E_STALE on LOAD_INDEX

The new index's serial is not strictly greater than the last accepted one, which is a rollback attempt
(`load_index.rs:41`, [`src/ingest/load/load_verified.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/ingest/load/load_verified.rs#L31)). The very first load runs against a stored
serial of `0` and is allowed; a repeat of the same serial after one has been accepted is stale.

### E_INVAL on LOAD_INDEX versus on a query

On `LOAD_INDEX`, `E_INVAL` means the blob did not decode, distinct from a signature failure
(`load_index.rs:40`). On the query ops it means a malformed length prefix in the request body: `get_app`
needs one length-prefixed string ([`src/server/handlers/get_app/handle.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_app/handle.rs#L35)), and `get_release` and
`install_ready` need a well-formed `(listing_id, release_id)` pair
([`src/server/handlers/get_release/handle.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_release/handle.rs#L31)). An unknown op also returns `E_INVAL` from the loop's
fall-through arm ([`src/server/runner.rs:64`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L64)).

### E_NODATA on any query

Either no index has been accepted yet, so `store.current()` is `None`
([`src/server/handlers/install_ready/handle.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/install_ready/handle.rs#L29)), or the named listing or release is not in the accepted
index ([`src/server/handlers/get_release/handle.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_release/handle.rs#L41)). Check that a `LOAD_INDEX` succeeded before
assuming a lookup bug; a fresh capsule with no accepted index answers every query with `E_NODATA`.

### E_MSGSIZE

On the receive side, a request whose declared payload runs past the bytes actually received is refused
before dispatch ([`src/server/runner.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L51)). On the reply side, a body that does not fit the transmit slot
returns `E_MSGSIZE` from the handler, for example when `list_apps` assembles more than the buffer holds
([`src/server/handlers/list_apps/handle.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/list_apps/handle.rs#L49)).

### An install that looks ready but the installer refuses it

`INSTALL_READY` returns six independent bytes ([`src/server/handlers/install_ready/handle.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/install_ready/handle.rs#L46)); read them
individually. A zero in `index_signature_valid` (byte 1) versus a zero in `arch_match` (byte 5) versus a
zero in `publisher_signature_present` (byte 3) isolate three different causes that a bare yes/no would
hide. The [readiness](/docs/userland/market/readiness/) page has the full byte layout and how each field is computed. Remember
the publisher flags are computed once at ingest and read back per query, so a flag reflects the state at
the time the index was loaded, not the moment of the readiness call.

## Source map

```
  src/userspace/init/capsule_boot/run.rs             [MARKET] capsule spawned / error path
  src/userspace/init/spawn_plan/core.rs              the nonos-capsule-market gate and no-op
  src/security/market_capsule/spawn.rs               the [MARKET-DEBUG] ELF-load tag
  userland/capsule_market/src/server/handlers/load_index.rs      ingest-error to errno mapping
  userland/capsule_market/src/ingest/load/load_verified.rs       the serial, trust, and signature refusals
  userland/capsule_market/src/verify/reject_all.rs               the offline-verify reject-all stub
  userland/capsule_market/src/server/runner.rs                   the receive-side E_MSGSIZE and unknown-op E_INVAL
  userland/capsule_market/src/server/handlers/install_ready/handle.rs  the six readiness bytes
```

Every reference above is verified against those trees.
