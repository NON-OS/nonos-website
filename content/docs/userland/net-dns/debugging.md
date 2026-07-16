---
title: "Debugging capsule_net_dns"
description: "This page lists the boot marker the DNS capsule's spawn path emits, the setup retry loop, and the concrete runtime failure modes with where to look for each."
weight: 5
---
This page lists the boot marker the DNS capsule's spawn path emits, the setup retry loop, and the concrete
runtime failure modes with where to look for each. For the shape of the capsule see the [README](/docs/userland/net-dns/),
the [operations](/docs/userland/net-dns/operations/) page, the [resolver](/docs/userland/net-dns/resolver/) page, and the [transport](/docs/userland/net-dns/transport/)
page.

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel prints
`[NET-DNS] capsule spawned`: the network spawn plan calls `boot::capsule` with the tag `NET-DNS`
([`src/userspace/init/spawn_plan/network/spawn_dns.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_dns.rs#L21)), which forwards to `capsule_boot::boot`
([`src/userspace/init/spawn_plan/boot.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/boot.rs#L26)), whose `Ok` arm calls `boot_log::ok(prefix, "capsule spawned")`
([`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)), which prints `[` + tag + `] ` + message
([`src/sys/boot_log/output.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/sys/boot_log/output.rs#L33)). An absent line means the capsule never started, usually a signature,
manifest, or capability failure; the `Err` arm prints an `[ERROR]` line instead
([`src/userspace/init/capsule_boot/run.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L34)). The line only appears when the kernel is built with the
`nonos-capsule-net-dns` feature, the `cfg` gate on the spawn entry
([`src/userspace/init/spawn_plan/network/spawn_dns.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_dns.rs#L18)), and the DNS capsule is spawned only on the legacy
per-capsule network stack, which is itself gated on `not(feature = "nonos-capsule-net-core")`
([`src/userspace/init/spawn_plan/network/spawn_legacy_stack.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/network/spawn_legacy_stack.rs#L18)). A kernel built with the combined
`net-core` stack does not spawn this capsule.

## Setup never completes (the capsule is spawned but silent)

Unlike a driver, this capsule does not exit on a setup failure. `_start` calls `setup::run` in a loop,
yielding 64 times between attempts and retrying forever until it succeeds ([`src/main.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L41)). So a capsule
that spawned but never answers a request is almost always stuck in that loop because `net.udp` has not come
up. `setup::run` fails for one of two reasons ([`src/setup.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L30)):

- `mk_service_lookup("net.udp")` returned non-zero or a zero port, so the UDP transport is not registered
  yet (`SetupError::UdpMissing`, [`src/setup.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L34)). The fix is upstream: `net.udp`, and the IP and L2
  capsules below it, have to be spawned and registered before DNS can bind to it. This is the expected
  transient at boot, and the retry loop is there precisely to wait it out.
- The lookup succeeded but the local port could not be minted or bound, so `net.udp` answered but the bind
  failed (`SetupError::BindFailed`, [`src/setup.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L37)). Minting the port needs the kernel entropy source, so
  a failure here also points at the `Crypto` right ([`src/state.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state.rs#L32)).

Because the loop retries silently, the way to tell the two apart is to confirm `net.udp` itself is up and
registered. Once it is, the next setup attempt binds the local port, caches the UDP service port, tries the
DHCP upstream, and the server starts.

## Runtime failure modes

After setup succeeds, failures surface as errno words in the response header, not exit codes. Every errno is
the 16-bit value at offset 8 of the reply ([`src/server/respond.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs#L34)).

### A request gets no reply at all

Two request-side conditions produce no reply rather than an errno. A frame that fails to parse (wrong magic,
wrong version, or a length that does not match the body) is dropped in the request loop
([`src/server/runner.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L41)), and a receive with a zero sender pid is skipped (`runner.rs:38`). If a client
sees a silent timeout rather than an errno, the request never parsed or carried no attributable sender.
Confirm the magic is `NDNS` (`0x4E44_4E53`), the version field is `1`, and the `payload_len` field matches
the body actually sent ([`src/server/parse_req.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L27)).

### `E_BAD_OP` (3)

The opcode was not one of the five the dispatch handles ([`src/server/runner.rs:48`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L48)). Only `1` through `5`
are defined ([`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17)).

### `E_BAD_LEN` (4)

The body length was wrong for the op. On the request path this is a `payload_len` that overruns the received
buffer ([`src/server/parse_req.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/parse_req.rs#L40)). The one handler that returns it directly is `OP_SET_UPSTREAM`, which
requires exactly 4 bytes of resolver IPv4 ([`src/server/handlers/upstream.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/upstream.rs#L28)).

### `E_NAME_INVALID` (9)

The host name was empty, longer than 255 bytes, not valid UTF-8, or not encodable as DNS labels. The name
check rejects the first three ([`src/server/handlers/resolve_common.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_common.rs#L29)), and a name that fails to encode
into labels (an empty or over-63-byte label, or a name that overflows the buffer) maps to `E_NAME_INVALID`
on the resolve path ([`src/server/handlers/resolve_a.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_a.rs#L40), [`src/dns/name/encode.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/name/encode.rs#L27)).

### `E_TIMEOUT` (6)

No usable response arrived within the 3000 ms deadline ([`src/server/handlers/resolve_common.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_common.rs#L26)). The
exchange resends the query every 400 ms and only accepts a datagram from the upstream on port 53, so a
timeout means the upstream never answered, the answers came from the wrong source, or every answer failed
the id-and-question binding and the loop ran out the clock (`resolve_common.rs:41`, `resolve_common.rs:48`,
`resolve_common.rs:68`). Confirm the upstream is reachable and that `net.udp` and the IP layer below it have
an address; a resolve cannot succeed before DHCP has bound a lease. It also surfaces if the local port could
not be resolved at exchange time (`resolve_common.rs:38`).

### `E_NXDOMAIN` (7)

The name does not exist. The upstream returned `RCODE_NXDOMAIN`, or it returned `NO_ERROR` with an answer
section that held no A or AAAA record ([`src/server/handlers/resolve_common.rs:71`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_common.rs#L71), `resolve_common.rs:77`,
[`src/dns/response/parse.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/response/parse.rs#L50)). This is a definitive negative answer, not a transport problem.

### `E_SERVFAIL` (8)

The upstream failed or its response could not be used. The response carried a non-zero rcode other than
NXDOMAIN, the response did not parse as a DNS message, or a transaction id could not be minted for the query
([`src/server/handlers/resolve_common.rs:74`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_common.rs#L74), `resolve_common.rs:67`, [`src/server/handlers/resolve_a.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_a.rs#L35)).
On the A path it is also the answer when the exchange succeeded but produced no IPv4
(`resolve_a.rs:47`), and on the AAAA path when it produced no IPv6 (`resolve_aaaa.rs:39`).

### `E_PERM` (10)

The caller is not the `net.admin` principal, and it tried a control op. Both `OP_FLUSH_CACHE` and
`OP_SET_UPSTREAM` deny any caller that is not the registered `net.admin` owner
([`src/server/handlers/flush.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/flush.rs#L24), [`src/server/handlers/upstream.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/upstream.rs#L24), [`src/server/authz.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L38)). Because
no capsule is spawned as `net.admin` today, this is the answer every caller gets for those two ops until such
a principal is registered; it is deny-by-default, not a misconfiguration
([`src/server/authz.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/authz.rs#L34)).

## A stale or wrong cached answer

If a resolve returns an address that should have changed, remember the cache holds A records for their TTL
and evicts round-robin when full ([`src/dns/cache/ops.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/cache/ops.rs#L41)). A cached entry is served until its TTL expires
against the millisecond clock ([`src/dns/cache/ops.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/dns/cache/ops.rs#L31)). The `net.admin` principal can force a full flush
with `OP_FLUSH_CACHE`, which ticks every entry out with `u64::MAX` ([`src/server/handlers/flush.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/flush.rs#L28)). The
AAAA path does not cache, so a AAAA answer is always fresh from the upstream
([`src/server/handlers/resolve_aaaa.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/resolve_aaaa.rs#L23)).

## Source map

```
  src/userspace/init/spawn_plan/network/spawn_dns.rs   the NET-DNS spawn entry and its cfg gate
  src/userspace/init/spawn_plan/network/spawn_legacy_stack.rs   the legacy-stack gate that spawns it
  src/userspace/init/spawn_plan/boot.rs                the boot::capsule forwarder
  src/userspace/init/capsule_boot/run.rs               the capsule-spawned / error boot markers
  src/sys/boot_log/output.rs                           the [TAG] message formatting
  userland/capsule_net_dns/src/main.rs                 the setup retry loop
  userland/capsule_net_dns/src/setup.rs                UdpMissing / BindFailed
  userland/capsule_net_dns/src/server/parse_req.rs     the parse failures behind a dropped request
  userland/capsule_net_dns/src/server/runner.rs        the dispatch and the sender-pid gate
  userland/capsule_net_dns/src/server/authz.rs         the net.admin gate behind E_PERM
  userland/capsule_net_dns/src/protocol/errno.rs       the errno constants
  userland/capsule_net_dns/src/server/handlers/resolve_common.rs   the E_TIMEOUT/E_NXDOMAIN/E_SERVFAIL paths
  userland/capsule_net_dns/src/server/handlers/resolve_a.rs, resolve_aaaa.rs, upstream.rs, flush.rs   the per-op errno paths
  userland/capsule_net_dns/src/dns/name/encode.rs      the E_NAME_INVALID encode failures
  userland/capsule_net_dns/src/dns/cache/ops.rs        the TTL and eviction behind a stale answer
```

Every reference above is verified against those trees.
