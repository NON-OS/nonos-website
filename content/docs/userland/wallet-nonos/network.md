---
title: "The network and RPC path"
description: "This page mirrors src/wallet/net/, src/wallet/rpc/, and src/wallet/tls13/."
weight: 5
---
This page mirrors `src/wallet/net/`, `src/wallet/rpc/`, and `src/wallet/tls13/`. The wallet holds no
Network capability. Every packet it appears to send is an IPC call to a service that holds the real
transport authority: `net.sockets` for the socket, `net.dns` for name resolution. On top of that transport
the wallet runs a from-scratch TLS 1.3 client and a hand-built JSON-RPC codec, all inside the capsule. For
the actions that drive this path see the [views](/docs/userland/wallet-nonos/views/) page.

## The transport services

The service names, magics, and socket ops are fixed in one place ([`src/wallet/net/constants.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/net/constants.rs)).

| Constant | Value | Meaning | Source |
|---|---|---|---|
| `SERVICE_SOCKETS` | `net.sockets` | the stream transport | `constants.rs:30` |
| `SERVICE_DNS` | `net.dns` | name resolution | `constants.rs:28` |
| `SERVICE_NYM` | `net.nym` | probed for health only | `constants.rs:29` |
| `ETH_RPC_HOST` | `ethereum-rpc.publicnode.com` | the RPC endpoint | `constants.rs:18` |
| `OP_RESOLVE_A` | 2 | DNS A-record resolve | `constants.rs:21` |
| `OP_SOCKET` | 2 | open a socket | `constants.rs:22` |
| `OP_CONNECT` | 6 | connect | `constants.rs:23` |
| `OP_SEND` | 7 | send | `constants.rs:24` |
| `OP_RECV` | 8 | receive | `constants.rs:25` |
| `OP_CLOSE` | 9 | close | `constants.rs:26` |

Each op is wrapped by one file: `socket_open`, `socket_connect`, `socket_send`, `socket_recv`,
`socket_close`, and `resolve_eth` (`src/wallet/net/`). A `net.nym` port is probed for health but the RPC
path itself does not route through it ([`src/wallet/net/probe.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/net/probe.rs#L25), `:28`). The socket family and kind are
IPv4 stream (`constants.rs:31`, `:32`), and connects target port 443
([`src/wallet/net/probe_rpc_tcp.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/net/probe_rpc_tcp.rs#L31)).

## The JSON-RPC codec

JSON is constructed and parsed by hand with no JSON crate (`src/wallet/rpc/`). Each request is a small
function that writes the exact byte sequence; `request_broadcast` is representative
([`src/wallet/rpc/request_broadcast.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/rpc/request_broadcast.rs#L19)):

```
  {"jsonrpc":"2.0","method":"eth_sendRawTransaction","params":["0x<hex(raw_tx)>"],"id":<id>}
```

The set covers `request_nonce` (`eth_getTransactionCount`), `request_balance` (`eth_getBalance`),
`request_fee`, `request_chain_id` (`eth_chainId`), `request_broadcast` (`eth_sendRawTransaction`), and
`request_receipt` (`eth_getTransactionReceipt`) ([`src/wallet/rpc/mod.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/rpc/mod.rs#L41)). Responses are read by
dedicated parsers: `parse_quantity32` (a `0x` hex quantity into a 32-byte big-endian value), `parse_hash32`,
`parse_u64`, and `parse_receipt_ok` (`mod.rs:37`). `http_post` wraps the JSON in a minimal HTTP/1.1 POST
with a `Host`, `Content-Type`, `Content-Length`, and `Connection: close`
([`src/wallet/rpc/http_post.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/rpc/http_post.rs#L19)), and `http_body` extracts the response body. So a broadcast is:
resolve the host, run the TLS handshake, seal the HTTP POST carrying the JSON-RPC into a TLS record, open
the response, and parse the 32-byte hash ([`src/wallet/net/broadcast_raw.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/net/broadcast_raw.rs#L19)).

## The probe ladder

The wallet does not silently fail a network op; it climbs a ladder and reports the last rung it reached.
`probe_network` runs the stages in order and folds the result into `NetStatus`
([`src/wallet/net/probe.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/net/probe.rs#L22), [`src/wallet/net/status.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/net/status.rs)). `probe_rpc_tcp` reports `resolve`, `socket`,
and `connect` as three separate booleans so a DNS failure, a socket-open failure, and a TCP-connect
failure are distinguishable ([`src/wallet/net/probe_rpc_tcp.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/net/probe_rpc_tcp.rs#L24)); `probe_tls_rpc` then attempts the full
TLS 1.3 handshake; `probe_status` turns the combination into the status string the Home view shows
([`src/wallet/net/probe_status.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/net/probe_status.rs#L17)).

That string is the sharpest diagnostic. It climbs, most-advanced first, through `rpc chain 0x1`,
`rpc client finish`, `rpc tls finished`, `rpc cert time`, `rpc host matched`, `rpc CA signed`,
`rpc CA anchor`, `rpc cert chain`, `rpc cert message`, `rpc tls record`, `rpc tls hello`, `rpc tcp ready`,
`route ready`, and `route blocked`, so the line shown is exactly the last handshake step that succeeded
(`probe_status.rs:18`). A wallet that connects but shows no balance is failing inside TLS or the
certificate chain, not at the socket.

## The TLS 1.3 client

The wallet's defining feature is that it implements TLS 1.3 from scratch (`src/wallet/tls13/`, roughly a
hundred files) rather than depending on a TLS library. It offers one cipher suite and one key-exchange
group ([`src/wallet/tls13/constants.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/tls13/constants.rs)):

```
  TLS 1.3 (0x0304)   ChaCha20-Poly1305-SHA256 (0x1303)   X25519 (0x001d)
```

The key schedule ([`src/wallet/tls13/schedule.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/tls13/schedule.rs#L24)) is the standard TLS 1.3 HKDF derivation and is
textbook-correct: `early = HKDF-Extract(0, 0)`, `derived = Derive-Secret(early, "derived", EMPTY_HASH)`,
`handshake = HKDF-Extract(derived, ECDHE_shared)`, then `c hs traffic` and `s hs traffic` secrets from the
transcript hash, and `key` / `iv` per direction via HKDF-Expand-Label (`schedule.rs:26`, `:30`, `:36`).
`EMPTY_HASH` is the SHA-256 of the empty string, exactly as RFC 8446 requires (`schedule.rs:19`). The
record layer seals the TLS 1.3 AEAD record: it appends the inner content type, builds the
`0x17 || 0x0303 || len+16` header, XORs the record sequence into the static IV to form the nonce, and
seals with ChaCha20-Poly1305 using the header as additional data, through the kernel AEAD primitive, which
is why the mask carries the Crypto bit ([`src/wallet/tls13/record_seal.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/tls13/record_seal.rs#L19), `:25`, `:31`).
`record_open.rs` is the inverse.

## The trust model

The client pins a single anchor rather than carrying a general root store. `chain_anchor` requires at
least two certificates, takes the last one, extracts its SubjectPublicKeyInfo, SHA-256-hashes it, and
requires that hash to equal a hardcoded constant ([`src/wallet/tls13/chain_anchor.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/tls13/chain_anchor.rs#L17)). That constant is
the Google Trust Services R4 root pinned by SPKI hash ([`src/wallet/tls13/gts_r4_anchor.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/tls13/gts_r4_anchor.rs#L17), the 32-byte
`GTS_R4` array). The leaf and intermediate signatures are verified up the chain: `verify_leaf` extracts
the to-be-signed bytes and the signature, takes the issuer's P-256 point from its SPKI, hashes the TBS,
converts the DER signature to a raw `(r, s)`, and calls `verify_p256`, with `verify_p384` available for
P-384 issuers ([`src/wallet/tls13/verify_leaf.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/tls13/verify_leaf.rs), `verify_intermediate.rs`, `verify_p256.rs`,
`verify_p384.rs`). The hostname is checked against the certificate SAN dNSNames including single-label
wildcards ([`src/wallet/tls13/cert_dns_match.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/tls13/cert_dns_match.rs)), and the validity window is checked against the current
time parsed from the RTC ([`src/wallet/tls13/cert_valid_now.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/tls13/cert_valid_now.rs), [`src/wallet/net/rtc_stamp.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/wallet/net/rtc_stamp.rs)).

This is a deliberate, conservative choice for a wallet talking to one known endpoint. It means the RPC
endpoint must chain to that specific root; swapping the CA or a wrong clock presents as a handshake that
completes on the wire but is refused by the wallet. The client offers one suite and one group, a small
auditable surface with no resumption, no client certificates, and no post-handshake authentication. A
man-in-the-middle without a chain to the pinned GTS R4 root is rejected.

## Source map

Everything here is drawn from `userland/capsule_wallet_nonos/src/wallet/net/` (sockets, DNS, the probe
ladder), `userland/capsule_wallet_nonos/src/wallet/rpc/` (the JSON-RPC codec), and
`userland/capsule_wallet_nonos/src/wallet/tls13/` (the TLS 1.3 client).

```
  src/wallet/net/constants.rs        service names, magics, socket ops, the RPC host
  src/wallet/net/socket_*.rs         open, connect, send, recv, close over net.sockets
  src/wallet/net/resolve_eth.rs      the DNS A-record resolve
  src/wallet/net/probe.rs            the ordered ladder into NetStatus
  src/wallet/net/probe_rpc_tcp.rs    resolve / socket / connect as three booleans
  src/wallet/net/probe_tls_rpc.rs    the full TLS handshake probe
  src/wallet/net/probe_status.rs     the ladder status string
  src/wallet/net/broadcast_raw.rs    request_broadcast, fetch, parse_hash32
  src/wallet/rpc/request_*.rs        the eth_* request builders
  src/wallet/rpc/parse_*.rs          the hand-written response parsers
  src/wallet/rpc/http_post.rs        the minimal HTTP/1.1 POST wrapper
  src/wallet/tls13/constants.rs      suite, group, extension ids
  src/wallet/tls13/schedule.rs       the HKDF key schedule
  src/wallet/tls13/record_seal.rs    the AEAD record layer
  src/wallet/tls13/chain_anchor.rs   the pinned-root check
  src/wallet/tls13/gts_r4_anchor.rs  the GTS R4 SPKI-hash constant
  src/wallet/tls13/verify_leaf.rs    chain signature verification
  src/wallet/tls13/cert_dns_match.rs, cert_valid_now.rs   name and validity
```

Every reference above is verified against those trees.
