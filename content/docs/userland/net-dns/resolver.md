---
title: "The DNS engine, the cache, and the resolve exchange"
description: "This page mirrors src/dns/ (the DNS header, name coding, query builders, response parser, and answer cache), the resolve exchange loop in src/server/handlers/resolvecommon.rs, a..."
weight: 2
---
This page mirrors `src/dns/` (the DNS header, name coding, query builders, response parser, and answer
cache), the resolve exchange loop in [`src/server/handlers/resolve_common.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_common.rs), and the upstream discovery in
`src/dhcp_upstream/`. It is the machinery a resolve op reaches after the server has parsed and dispatched a
request. For that request loop and the op set see the [operations](/docs/userland/net-dns/operations/) page; for the UDP client
the exchange rides on, see the [transport](/docs/userland/net-dns/transport/) page. For where DNS sits above UDP in the stack,
see the [networking subsystem](/docs/subsystems/networking/).

## The DNS header

A DNS message opens with a 12-byte header ([`src/dns/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/header.rs#L17)). The capsule reads the four fields it
needs: the 16-bit id, the flags, the question count, and the answer count, all big-endian
([`src/dns/header.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/header.rs#L35)). Two flag helpers matter: `is_response` tests the `QR` bit `0x8000`
(`header.rs:47`), and `rcode` masks the low four bits `0x000F` to the response code (`header.rs:51`). The
two response codes the resolver acts on are `RCODE_NO_ERROR = 0` and `RCODE_NXDOMAIN = 3`
(`header.rs:23`). A query header written by the builder sets only the `RD` recursion-desired flag `0x0100`
and a question count of one ([`src/dns/query.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/query.rs#L49)).

## Encoding a name

`encode` turns a dotted host name into DNS wire form: a sequence of length-prefixed labels ending in a zero
byte ([`src/dns/name/encode.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/name/encode.rs#L20)). An empty name or a bare `.` encodes as the single zero root
(`encode.rs:22`, `encode.rs:42`). Each label is bounded to `LABEL_MAX = 63` bytes, an empty or oversized
label is `LabelTooLong`, and the running length is bounded to `NAME_MAX = 255` and to the output buffer, so
a long name is `TooLong` rather than an overrun (`encode.rs:27`, `encode.rs:31`). The constants live in
[`src/dns/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/types.rs): `NAME_MAX = 255`, `LABEL_MAX = 63`, and `POINTER_MASK = 0xC0`
([`src/dns/types.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/types.rs#L17)).

## Skipping a name in a response

Parsing an answer means stepping over names the resolver does not need to materialise, and this is where a
hostile packet is most dangerous. `skip` walks a name from a given offset: a zero byte ends it, a byte with
the two high `POINTER_MASK` bits set is a compression pointer whose two-byte form ends the name in place
([`src/dns/name/skip.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/name/skip.rs#L28), `skip.rs:42`), a byte over `LABEL_MAX` is a `BadPointer`, and a step counter
bounded to `NAME_MAX` catches a pointer loop as `LoopDetected` ([`src/dns/name/skip.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/name/skip.rs#L31), `skip.rs:36`). A
truncated name that runs past the buffer is `Truncated` (`skip.rs:24`). Because `skip` stops at the first
compression pointer rather than following it, and because the step count is bounded, a crafted packet cannot
drive the parser into an unbounded or looping read. `NameError` names the five failures: `Truncated`,
`BadPointer`, `LoopDetected`, `TooLong`, `LabelTooLong` ([`src/dns/name/error.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/name/error.rs#L17)).

## Building a query

`build_a_query` and `build_aaaa_query` frame a complete query for the A (`TYPE_A = 1`) and AAAA
(`TYPE_AAAA = 28`) record types ([`src/dns/query.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/query.rs#L36), [`src/dns/types.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/types.rs#L21)). The shared `build_query`
writes the 12-byte header (the transaction id, the `RD` flag, a question count of one, zeroed answer,
authority, and additional counts), encodes the name after the header, and appends the 2-byte record type and
the 2-byte `CLASS_IN = 1` class ([`src/dns/query.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/query.rs#L44)). A buffer too small for the header or the trailing
question fields is `OutputTooSmall`, and a name that will not encode maps to `NameInvalid`
(`query.rs:45`, `query.rs:27`). Every multi-byte field is written big-endian, the DNS wire order.

## Parsing a response

`first_address` walks a response and returns the header and the first A or AAAA answer it finds
([`src/dns/response/parse.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/response/parse.rs#L22)). It parses the header, rejects a message whose `QR` bit is clear as
`NotAResponse`, skips each question (the name plus the 4-byte type and class), then walks each answer record
(`parse.rs:22`, `parse.rs:31`, `parse.rs:42`). `read_answer` reads the record type, the 32-bit TTL, and the
`RDLENGTH`, and bounds the record data against the buffer so a lying length cannot overrun (`Truncated`
otherwise, [`src/dns/response/record.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/response/record.rs#L22)). An A record with exactly 4 bytes of data yields an IPv4, a
AAAA record with exactly 16 bytes yields an IPv6, and any other type or length yields neither
(`record.rs:43`, `record.rs:52`). The walk returns the first record whose type is A or AAAA, or `None` if
the answer section holds no address record (`parse.rs:50`). `ParseError` has three variants, `Truncated`,
`BadName`, and `NotAResponse`, with a `NameError` folding into `BadName` ([`src/dns/response/error.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/response/error.rs#L19)).
The parsed `Answer` carries the record type, the TTL, and the optional IPv4 and IPv6
([`src/dns/response/answer.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/response/answer.rs#L17)).

## The answer cache

The cache is a fixed table of `ENTRY_CAP = 128` slots, each holding a name hash, up to `NAME_BYTES = 64`
bytes of name, the length, the IPv4, and an absolute expiry in milliseconds ([`src/dns/cache/entry.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/cache/entry.rs#L19)).
It is a `const fn new` table of `None` slots, so it needs no heap to exist ([`src/dns/cache/entry.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/cache/entry.rs#L37)).
The cache holds A records only.

- `lookup` finds a live entry by comparing the FNV-1a name hash and the stored name bytes, and returns the
  IPv4 only if the entry has not expired against the caller's clock ([`src/dns/cache/ops.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/cache/ops.rs#L23)). The hash is
  a case-folding FNV-1a, so `Example.com` and `example.com` collide to the same key
  ([`src/dns/cache/hash.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/cache/hash.rs#L17)).
- `insert` reuses the slot already holding the name, or the first empty slot, and otherwise evicts a slot
  chosen by a monotonic epoch counter modulo the capacity, so a full table replaces entries round-robin
  rather than failing ([`src/dns/cache/ops.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/cache/ops.rs#L35), `ops.rs:41`). The expiry is the insert time plus the TTL,
  computed with a saturating add so a huge TTL cannot wrap (`ops.rs:70`).
- `tick` clears every entry whose expiry is at or before the supplied time ([`src/dns/cache/ops.rs:45`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/cache/ops.rs#L45)).
  Passing `u64::MAX` expires the whole table, which is exactly how the flush op empties the cache
  ([`src/server/handlers/flush.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/flush.rs#L28)).

## The resolve exchange

`exchange` is the request-response loop against the upstream ([`src/server/handlers/resolve_common.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_common.rs#L36)).
It reads the current upstream address and the bound local port, then loops sending the query and polling for
a reply until a 3000 ms deadline, resending every 400 ms (`resolve_common.rs:26`, `resolve_common.rs:41`).
On each turn it sends the query to the upstream on port 53 through `send_to`, then calls `recv_from` and
accepts a datagram only if its source address and source port match the upstream and DNS port
(`resolve_common.rs:43`, `resolve_common.rs:48`). A matching datagram is handed to `parse_response`; a
result of `E_TIMEOUT` (an id or question mismatch) keeps polling, and anything else returns immediately
(`resolve_common.rs:49`). If the deadline passes with no usable answer, it is `E_TIMEOUT`
(`resolve_common.rs:59`).

`parse_response` is where a reply is bound to its query. It parses the first address, then rejects the
response as a mismatch (mapped to `E_TIMEOUT` so the loop keeps waiting for the real reply) unless the header
id equals the transaction id and the response question matches the query question
([`src/server/handlers/resolve_common.rs:66`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_common.rs#L66), `resolve_common.rs:68`). An `RCODE_NXDOMAIN` becomes
`E_NXDOMAIN`, any other non-zero rcode becomes `E_SERVFAIL`, and a `NO_ERROR` response with no address record
also becomes `E_NXDOMAIN` (`resolve_common.rs:71`, `resolve_common.rs:77`). The id and question binding is
what makes an off-path forged reply hard: the attacker has to guess the 16-bit id and echo the exact
question, and the source-address check in `exchange` already filters replies not from the upstream.

## Matching the question

`question_matches` confirms a response echoes the query's question ([`src/dns/question.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/question.rs#L19)). It finds the
end of the query name and the response name, compares them case-insensitively label by label, and then
compares the two bytes of record type that follow each name ([`src/dns/question.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/question.rs#L28)). The name walk here
rejects a compression pointer or an over-long label outright rather than following it, and bounds its step
count to `NAME_MAX`, so a crafted question cannot loop or overrun ([`src/dns/question.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/question.rs#L44)). Case folding
uses the same lowercasing rule as the cache hash ([`src/dns/question.rs:60`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/question.rs#L60)).

## Upstream discovery from DHCP

The upstream resolver defaults to `1.1.1.1` ([`src/state.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L23)), but setup tries to replace it with the DNS
server the DHCP lease carried. `dhcp_upstream::apply` resolves the `net.dhcp.client` service, sends it an
`OP_LEASE_STATUS` request under the DHCP wire magic `0x4E44_4843`, and reads the 4-byte DNS server out of
the lease-status reply; if it is non-zero it becomes the upstream ([`src/dhcp_upstream.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp_upstream.rs#L26),
[`src/dhcp_upstream/status.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp_upstream/status.rs#L19)). A missing DHCP service, a non-`OK` reply, or an all-zero DNS field leaves
the default in place ([`src/dhcp_upstream/lookup.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp_upstream/lookup.rs#L23), [`src/dhcp_upstream/status.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dhcp_upstream/status.rs#L27)). The
administrative `OP_SET_UPSTREAM` op can override it at runtime (see the [operations](/docs/userland/net-dns/operations/) page).

## Source map

```
  userland/capsule_net_dns/src/dns/header.rs            the 12-byte header, QR/RD flags, rcode
  userland/capsule_net_dns/src/dns/types.rs             NAME_MAX, LABEL_MAX, POINTER_MASK, TYPE_A, TYPE_AAAA, CLASS_IN
  userland/capsule_net_dns/src/dns/name/encode.rs       encode a dotted name to length-prefixed labels
  userland/capsule_net_dns/src/dns/name/skip.rs         compression-safe, loop-bounded name skip
  userland/capsule_net_dns/src/dns/name/error.rs        NameError
  userland/capsule_net_dns/src/dns/query.rs             build_a_query / build_aaaa_query
  userland/capsule_net_dns/src/dns/question.rs          question_matches, the case-fold name compare
  userland/capsule_net_dns/src/dns/response/parse.rs    first_address: skip questions, walk answers
  userland/capsule_net_dns/src/dns/response/record.rs   read_answer: type, TTL, RDLENGTH, bounds
  userland/capsule_net_dns/src/dns/response/answer.rs   the Answer struct
  userland/capsule_net_dns/src/dns/response/error.rs    ParseError
  userland/capsule_net_dns/src/dns/cache/entry.rs       the 128-slot cache table and CacheEntry
  userland/capsule_net_dns/src/dns/cache/ops.rs         lookup, insert, tick, eviction
  userland/capsule_net_dns/src/dns/cache/hash.rs        the case-folding FNV-1a name hash
  userland/capsule_net_dns/src/server/handlers/resolve_common.rs   the exchange loop and parse_response
  userland/capsule_net_dns/src/dhcp_upstream/           net.dhcp.client lease-status upstream discovery
  userland/capsule_net_dns/src/state.rs                 the default upstream and the cache handle
```

Every reference above is verified against those trees.
