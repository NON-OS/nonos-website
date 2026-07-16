---
title: "The operations and protocol"
description: "This page mirrors src/protocol/ (the wire codec) and src/server/ (the loop, dispatch, and the four handlers)."
weight: 3
---
This page mirrors `src/protocol/` (the wire codec) and `src/server/` (the loop, dispatch, and the four
handlers). It covers the frame format, the four operations, name validation, and the payment-admission
call. For why a load is safe once it reaches the kernel, read the [verified-load](/docs/userland/installer/verified-load/) page;
for identity and the mask, read the [README](/docs/userland/installer/).

## The wire frame

The installer is a headless server capsule. It receives one request on inbox `0`, decodes an eight-byte
header, dispatches one operation, and sends a reply to the kernel reply endpoint
([`src/server/runner.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L26)). Every request is `seq(4) | op(2) | pad(2) | body` and every reply is
`seq(4) | status(4) | payload` ([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19), [`src/protocol/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L19)).

The `protocol` module is a thin codec and nothing more. `decode_request` splits a frame into `seq`, `op`,
and a payload slice, returning `None` on a frame shorter than the eight-byte header
([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19), [`src/protocol/types.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L24)). `encode_response` prepends the little-endian
`seq` and `status` to a payload ([`src/protocol/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L19)). The op and errno constants live in
[`src/protocol/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L17) and are re-exported from [`src/protocol/mod.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/mod.rs#L23).

The reply always goes to `KERNEL_REPLY_ENDPOINT`, the constant `0x1_0000_0011`
([`src/protocol/types.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L22), [`src/server/runner.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L40)). The receive buffer is 8 MiB, because a capsule
image is large and the by-payload path carries the ELF inline ([`src/server/runner.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L24)). A non-positive
receive or an undecodable frame is skipped without a reply ([`src/server/runner.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L32), `:37`).

## The four operations

Four operations are defined and dispatched ([`src/protocol/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L17), [`src/server/dispatch.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L26)). Any
other opcode replies `EINVAL` (`-22`) from the fall-through arm ([`src/server/dispatch.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/dispatch.rs#L31),
[`src/protocol/types.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L26)).

| Op | Opcode | Handler | Reply |
|---|---|---|---|
| `OP_HEALTHCHECK` | 1 | `handlers::health` | `seq \| status=0` (liveness) |
| `OP_INSTALL` | 2 | `handlers::install` | receipt hash, or negative errno |
| `OP_LOAD_FROM_STORE` | 3 | `handlers::load_store` | new pid, or the kernel's negative rc |
| `OP_LOAD_BY_NAME` | 4 | `handlers::load_by_name` | new pid, or the kernel's negative rc |

Each handler is one file under `src/server/handlers/`, exposing `pub fn <name>(req: Request<'_>) ->
Vec<u8>` and returning an `encode_response` ([`src/server/handlers/mod.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/mod.rs#L17)). Two roles live in the same
capsule: the load role (`OP_LOAD_BY_NAME`, `OP_LOAD_FROM_STORE`) is the verified spawn path, and the
install-admission role (`OP_INSTALL`) is the payment gate.

### OP_HEALTHCHECK (1)

The liveness probe. It ignores the body and replies `seq | status=0 | (empty)`
([`src/server/handlers/health.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L21)). A present reply means `mk_service_lookup("installer")` resolves and
the loop is running.

### OP_LOAD_BY_NAME (4)

The preferred path: the caller sends only a name, and the installer reads the four artifacts from the
store itself, so a multi-megabyte ELF never crosses the IPC boundary in one message
([`src/server/handlers/load_by_name.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/load_by_name.rs#L36)). The body layout is:

```
  requested_caps(8) | name_len(1) | name | args
```

The handler bounds-checks the length (at least nine bytes, and `9 + name_len` folded with `checked_add`
must not overflow or exceed the buffer), then requires `valid_name(name)`
(`load_by_name.rs:38`, `:43`, `:46`, `:51`). It reads
`/capsules/<name>.{elf,nonos_id_cert.bin,manifest.bin,zk_trailer.bin}` through the
[vfs](/docs/userland/vfs/) client, each capped at 16 MiB (`load_by_name.rs:56`, `:28`, `:87`), and builds a
`CapsuleLoadRequest` carrying the four pointer/length pairs, the `requested_caps` the caller asked for, and
the args blob (`load_by_name.rs:65`). The four blobs stay owned by the handler's stack frame until
`mk_capsule_load` returns, so the kernel copies from live memory (`load_by_name.rs:78`, `:80`). On success
it replies the new capsule pid as a little-endian `u32` with status `0`; on failure it relays the syscall's
negative `rc` as the status (`load_by_name.rs:81`). Any read failure or a bad name replies `EINVAL`
(`load_by_name.rs:62`).

The four artifacts are the ELF, the [NØNOS-ID certificate](/docs/security/certificate-schema/), the
[manifest](/docs/security/manifest-schema/), and the ZK attestation trailer
(see [attestation](/docs/security/attestation/)).

#### Name validation

`valid_name` requires a non-empty stem, at most 64 bytes, with every byte in `[A-Za-z0-9_-]`
(`load_by_name.rs:95`). A name outside that set is refused before any path is built, so a name can never
inject a `/` or a `..` and escape `/capsules` (`read_artifact` at `load_by_name.rs:87` simply concatenates
`/capsules/`, the validated name, and a fixed extension). This is the same rule the terminal's install
client enforces on its side before the request ever reaches the installer.

### OP_LOAD_FROM_STORE (3)

The variant where the caller supplies the artifact bytes directly instead of a name
([`src/server/handlers/load_store.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/load_store.rs#L22)). The 28-byte head is:

```
  requested_caps(8) | elf_len(4) | cert_len(4) | manifest_len(4) | trailer_len(4) | args_len(4)
```

followed by the ELF, cert, manifest, trailer, and args blobs in that order. Every offset is folded with
`checked_add`, and the total must equal the payload length exactly, so a malformed length field or a
truncated body replies `EINVAL` rather than reading out of bounds
(`load_store.rs:33`, `:45`, `:48`). The blobs are sliced in place and passed to the same
`mk_capsule_load`; the reply is identical to the by-name path, the new pid on success or the kernel's
negative `rc` (`load_store.rs:64`). The by-name path is preferred in practice because it avoids shipping
the ELF over IPC.

For both load ops the `requested_caps` field is a request, not a grant. It is the upper bound the caller
is willing to see granted, and the kernel bounds it further against the verified manifest and the
certificate ceiling; see the [verified-load](/docs/userland/installer/verified-load/) page.

### OP_INSTALL (2)

The payment-admission path ([`src/server/handlers/install.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/install.rs#L27)). The body is a fixed 125 bytes:

```
  owner_pid(4) | wallet_id(4) | price_kind(1) | capsule_id(32) | publisher(20) | amount(32) | receipt_type(32)
```

decoded into `InstallReq` ([`src/server/fields.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/fields.rs#L17), `install.rs:33`). A wrong length replies `EINVAL`
(`install.rs:29`). If `price_kind == PRICE_KIND_FREE` (0) it returns a 32-byte zero receipt with status
`0` and contacts no one (`install.rs:42`, [`src/server/consts.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/consts.rs#L19)). Otherwise it resolves the `payment`
service by name; if that lookup fails it replies `EAGAIN` (`-11`)
(`install.rs:45`, [`src/server/discover.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/discover.rs#L21), [`src/protocol/types.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/types.rs#L27)). It then calls the
[payment](/docs/userland/payment/) capsule's `OP_PAY` (2) with the owner pid, wallet id, capsule id,
publisher, amount, and receipt type, and on a `status == 0` reply returns the 32-byte signed struct hash;
a reply shorter than 40 bytes or a non-zero status is surfaced as an error
([`src/server/pay_call.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/pay_call.rs#L25), `:38`, `:41`, [`src/server/consts.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/consts.rs#L18)).

The install role binds payment to admission; it does not spawn anything. The installer holds no key
material and no index-signature authority, and no receipt state beyond the in-flight call. The `word32`
and `addr20` helpers are byte extractors that copy a fixed-width field out of the payload
([`src/server/word32.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/word32.rs#L17), [`src/server/addr20.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/addr20.rs#L17)).

## The self-install path

Under the `nonos-autorun-install` feature the module [`src/server/selfinstall.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/selfinstall.rs) is compiled
([`src/server/mod.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/mod.rs#L25)), and `server::run` calls it before the request loop
([`src/server/runner.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L27)). It waits for the vfs store to answer, then loads `std_proof` and `rg` through
the same `mk_capsule_load` the handlers use, so the runtime install path is proven end to end on a
headless boot ([`src/server/selfinstall.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/selfinstall.rs#L30), `:34`, `:42`, `:72`). It requests `u64::MAX` caps, which,
as the [verified-load](/docs/userland/installer/verified-load/) page explains, can only ever select within each capsule's own
manifest ([`src/server/selfinstall.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/selfinstall.rs#L23), `:64`). It is a build-time feature, not a callable operation.

## Source map

```
  userland/capsule_installer/src/protocol/types.rs      the ops, KERNEL_REPLY_ENDPOINT, errnos, Request
  userland/capsule_installer/src/protocol/decode.rs     seq | op | pad | body -> Request
  userland/capsule_installer/src/protocol/encode.rs     seq | status | payload
  userland/capsule_installer/src/server/runner.rs       the receive/dispatch/reply loop
  userland/capsule_installer/src/server/dispatch.rs     the op match table, EINVAL fall-through
  userland/capsule_installer/src/server/handlers/health.rs       OP_HEALTHCHECK
  userland/capsule_installer/src/server/handlers/load_by_name.rs OP_LOAD_BY_NAME + valid_name
  userland/capsule_installer/src/server/handlers/load_store.rs   OP_LOAD_FROM_STORE
  userland/capsule_installer/src/server/handlers/install.rs      OP_INSTALL: payment admission
  userland/capsule_installer/src/server/discover.rs     payment service lookup
  userland/capsule_installer/src/server/pay_call.rs     the OP_PAY settlement call
  userland/capsule_installer/src/server/consts.rs       PAYMENT_SERVICE, PAYMENT_OP_PAY, PRICE_KIND_FREE
  userland/capsule_installer/src/server/fields.rs       the InstallReq struct
  userland/capsule_installer/src/server/{word32,addr20}.rs   fixed-width byte extractors
  userland/capsule_installer/src/server/selfinstall.rs  the nonos-autorun-install boot self-verification
```

Every reference above is verified against those trees.
