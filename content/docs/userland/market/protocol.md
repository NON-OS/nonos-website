---
title: "Protocol and server"
description: "This page mirrors src/protocol/ and src/server/: the wire format the market speaks, the six ops and the errnos they can return, the loop that receives and dispatches, and the sh..."
weight: 2
---
This page mirrors `src/protocol/` and `src/server/`: the wire format the market speaks, the six ops and
the errnos they can return, the loop that receives and dispatches, and the shape of each handler's request
and reply. For the signature gate that guards `LOAD_INDEX` see the [verification](/docs/userland/market/verification/) page;
for the six-byte verdict that `INSTALL_READY` returns see the [readiness](/docs/userland/market/readiness/) page. Identity and
the capability mask live on the [README](/docs/userland/market/).

## The wire header

The wire is a fixed 20-byte header ([`src/protocol/header.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L20)). Every request and every reply begins with
it, in this layout:

```
  offset  size  field
  0       4     magic       0x4E4D_4B54   header.rs:17
  4       2     version     1             header.rs:18
  6       2     op                        the op number
  8       2     flags                     echoed back on the reply
  10      2     reserved    0             zeroed on a reply
  12      4     request_id                echoed back on the reply
  16      4     payload_len               bytes that follow the header
```

`decode_request` rejects anything shorter than the header, a wrong magic, or a wrong version, returning
`None` so the caller can reply `E_INVAL` ([`src/protocol/decode.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L20), `decode.rs:24`, `decode.rs:28`). A
response reuses the same header with the reserved field zeroed and the request's op, flags, and id echoed
back, and sets `payload_len` to the status word plus any body
([`src/protocol/encode/encode_response_header.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode/encode_response_header.rs#L19)).

Every reply, success or error, is the header followed by a 4-byte little-endian status word
([`src/protocol/encode/write_status.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode/write_status.rs#L17), `STATUS_LEN = 4`, [`src/protocol/limits.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L19)). An error reply
is header plus status only ([`src/server/error/reply_status.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error/reply_status.rs#L23)); a data reply appends the body after the
status ([`src/server/payload/reply_with_body.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/payload/reply_with_body.rs#L23)). A status of `0` is success; a negative status is one
of the errnos below.

## The loop

`server::run` never returns ([`src/server/runner.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L32)). It allocates a receive buffer sized to the maximum
index blob plus 64 bytes and a 64 KiB transmit buffer (`runner.rs:33`, [`src/protocol/limits.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L20),
`limits.rs:21`), then loops:

1. Receive on inbox `0` with `mk_ipc_recv`; a non-positive length is skipped (`runner.rs:36`,
   `runner.rs:37`).
2. Decode the header; on failure reply `E_INVAL` through `reply_decode_failed`, which synthesizes a
   zeroed request so the error still carries a valid header (`runner.rs:44`,
   [`src/server/error/reply_decode_failed.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error/reply_decode_failed.rs#L21)).
3. Bound the declared payload against the bytes actually received: `body_end` is the header length plus the
   declared `payload_len`, computed with a saturating add, and if it runs past the received count the loop
   replies `E_MSGSIZE` (`runner.rs:49`, `runner.rs:51`). This is the guard against a header that claims more
   body than arrived.
4. Dispatch by op number and nothing else. The header carries the op, the match routes it, and an
   unmatched op replies `E_INVAL` (`runner.rs:57`, `runner.rs:64`).

Op numbers are the only routing key. There is no verb string on the wire.

## IPC verbs

The capsule speaks two IPC verbs and no others. It receives on inbox `0` with `mk_ipc_recv`
([`src/server/runner.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L36)) and sends every reply to the kernel reply endpoint `0x1_0000_0007` with
`mk_ipc_send` ([`src/protocol/endpoint.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/endpoint.rs#L17), [`src/server/error/reply_status.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error/reply_status.rs#L26),
[`src/server/payload/reply_with_body.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/payload/reply_with_body.rs#L28)).

For signature checks the real verifier calls one downstream service, `crypto_ed25519_verify` through
`nonos_libc`, which the kernel routes to `capsule_crypto`; that is why the market needs no Crypto
capability of its own. That path is the subject of the [verification](/docs/userland/market/verification/) page. The market
calls the installer and the payment service for nothing; those are separate capsules and separate concerns.

## The six ops

Six ops are defined ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)), routed in the loop's match ([`src/server/runner.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L57)):

| Op | Name | Value | Handler | Reply on success |
|---|---|---|---|---|
| 1 | `OP_LOAD_INDEX` | `1` | [`src/server/handlers/load_index.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/load_index.rs#L23) | status `0`, no body |
| 2 | `OP_LIST_APPS` | `2` | [`src/server/handlers/list_apps/handle.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/list_apps/handle.rs#L28) | count + per-entry records |
| 3 | `OP_GET_APP` | `3` | [`src/server/handlers/get_app/handle.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_app/handle.rs#L28) | one listing record |
| 4 | `OP_GET_RELEASE` | `4` | [`src/server/handlers/get_release/handle.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_release/handle.rs#L24) | one release record |
| 5 | `OP_INSTALL_READY` | `5` | [`src/server/handlers/install_ready/handle.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/install_ready/handle.rs#L26) | 6-byte verdict |
| 6 | `OP_HEALTHCHECK` | `6` | [`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20) | status `0`, no body |

### LOAD_INDEX (op 1)

`handle` reads the store's last accepted serial, runs the blob through `load_verified`, and on success
installs the returned index and replies status `0` ([`src/server/handlers/load_index.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/load_index.rs#L30),
`load_index.rs:33`, `load_index.rs:38`). The verification pipeline it runs is the
[verification](/docs/userland/market/verification/) page in full; this handler is the mapping from its four ingest errors to
errnos: `Malformed` to `E_INVAL`, `StaleSerial` to `E_STALE`, and both `SignatureRefused` and
`UntrustedOperator` to `E_KEYREJECTED` (`load_index.rs:40`). The store then holds exactly one accepted
index, its operator signature flag, and the publisher flag vector.

### LIST_APPS (op 2)

Requires an accepted index, else `E_NODATA` ([`list_apps/handle.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/list_apps/handle.rs#L29)). The body is a little-endian entry
count ([`list_apps/handle.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/list_apps/handle.rs#L35)) followed, per entry, by the length-prefixed `listing_id`, the raw
`capsule_id`, the length-prefixed `name`, and a single readiness byte
([`list_apps/handle.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/list_apps/handle.rs#L41), [`list_apps/handle.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/list_apps/handle.rs#L44)). That byte is `1` only if at least one of the entry's
releases evaluates as install-ready ([`list_apps/handle.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/list_apps/handle.rs#L37)). If the assembled body does not fit the
reply slot the handler returns `E_MSGSIZE` ([`list_apps/handle.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/list_apps/handle.rs#L49)).

### GET_APP (op 3)

Requires an accepted index (`E_NODATA`) and a single length-prefixed `listing_id` in the body (`E_INVAL`
on a malformed length prefix) ([`get_app/handle.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/get_app/handle.rs#L29), [`get_app/handle.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/get_app/handle.rs#L35)). The length prefix is
decoded by `read_lp_string`, which needs at least four bytes and a body that fits and is valid UTF-8
([`src/server/handlers/get_app/read_lp_string.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_app/read_lp_string.rs#L17)). An unknown listing is `E_NODATA`
([`get_app/handle.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/get_app/handle.rs#L39)). The reply carries the listing's id, capsule id, name, publisher name, publisher
pubkey, description, and release count ([`get_app/handle.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/get_app/handle.rs#L42)), or `E_MSGSIZE` if it overflows the slot
([`get_app/handle.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/get_app/handle.rs#L52)).

### GET_RELEASE (op 4)

Requires an accepted index (`E_NODATA`) and a `(listing_id, release_id)` pair, each length-prefixed, parsed
by `parse_pair` (`E_INVAL` on a bad pair) ([`get_release/handle.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/get_release/handle.rs#L25), [`get_release/handle.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/get_release/handle.rs#L29),
[`src/server/handlers/get_release/parse_pair.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_release/parse_pair.rs#L19)). `parse_pair` reads two length-prefixed fields back to
back with `take_lp`, each requiring four bytes of prefix and a body that fits
([`src/server/handlers/get_release/take_lp.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_release/take_lp.rs#L17)). A pair that names no release is `E_NODATA`
([`get_release/handle.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/get_release/handle.rs#L41)). On a hit the reply is the encoded release record, which carries the release
id, both hashes, the package url, the publisher signature, the supported arches, the kernel-abi minimum,
the required capabilities, and the validation record ([`get_release/handle.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/get_release/handle.rs#L43),
[`src/server/handlers/get_release/encode_release.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/get_release/encode_release.rs#L24)), or `E_MSGSIZE` on overflow
([`get_release/handle.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/get_release/handle.rs#L47)).

### INSTALL_READY (op 5)

Takes a `(listing_id, release_id)` pair and returns a six-byte verdict rather than a bare yes/no, so a
caller learns why an install is or is not ready. The handler parses the pair, finds the release, reads the
stored publisher flag, evaluates the verdict, and writes the six bytes in a fixed order
([`src/server/handlers/install_ready/handle.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/install_ready/handle.rs#L26), [`install_ready/handle.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/install_ready/handle.rs#L46)). The verdict and its
fields are the [readiness](/docs/userland/market/readiness/) page.

### HEALTHCHECK (op 6)

Replies status `0` with no body and touches no state ([`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20)). It is a liveness
probe: a reply means the request loop is running and `market.index` resolves.

## Errors

Every errno the capsule can return ([`src/protocol/errno.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs)):

| Errno | Value | Meaning | Raised by |
|---|---|---|---|
| `E_INVAL` | `-22` | malformed request, bad length prefix, or unknown op | `errno.rs:17`, `runner.rs:44`, `runner.rs:64` |
| `E_NODATA` | `-61` | no accepted index yet, or the named listing/release is absent | `errno.rs:18`, [`install_ready/handle.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/install_ready/handle.rs#L29) |
| `E_STALE` | `-116` | index serial is not strictly greater than the last accepted | `errno.rs:20`, `load_index.rs:41` |
| `E_MSGSIZE` | `-90` | request body exceeds the receive buffer, or a reply overflows the slot | `errno.rs:21`, `runner.rs:52` |
| `E_KEYREJECTED` | `-129` | operator signature refused or operator key untrusted | `errno.rs:19`, `load_index.rs:42`, `load_index.rs:43` |

## Reply assembly

A data handler builds its body into a `Vec`, asks `body_slot` for a mutable slice at the tail of the
transmit buffer past the header and status, and copies the body in
([`src/server/payload/body_slot.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/payload/body_slot.rs#L19)). `body_slot` returns `None` if the body does not fit, which the
handler turns into `E_MSGSIZE`. `reply_with_body` then writes the header with `payload_len` set to the
status length plus the body, writes a `0` status, and sends the header, status, and body in one
`mk_ipc_send` ([`src/server/payload/reply_with_body.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/payload/reply_with_body.rs#L23)). An error reply skips the body entirely and
sends the header plus a negative status through `reply_status`
([`src/server/error/reply_status.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/error/reply_status.rs#L23)).

## Source map

```
  userland/capsule_market/src/protocol/header.rs        the 20-byte wire header, magic, version
  userland/capsule_market/src/protocol/decode.rs        request header decode and its rejections
  userland/capsule_market/src/protocol/encode/          response header and status word
  userland/capsule_market/src/protocol/ops.rs           the six op discriminants
  userland/capsule_market/src/protocol/errno.rs         the errno set
  userland/capsule_market/src/protocol/endpoint.rs      the kernel reply endpoint
  userland/capsule_market/src/protocol/limits.rs        the rx/tx buffer sizes and STATUS_LEN
  userland/capsule_market/src/server/runner.rs          the recv/decode/bound/dispatch/reply loop
  userland/capsule_market/src/server/handlers/          load_index, list_apps, get_app, get_release, install_ready, health
  userland/capsule_market/src/server/payload/           body_slot and reply_with_body
  userland/capsule_market/src/server/error/             reply_status and reply_decode_failed
  userland/marketplace_abi/                              the shared index and release codec the handlers read
```

Every reference above is verified against those trees.
