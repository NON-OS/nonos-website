---
title: "The segment engine"
description: "This page mirrors src/tcp/, the module that turns control-block variables into wire bytes and back, and holds the arithmetic the state machine leans on: header build and parse, ..."
weight: 4
---
This page mirrors `src/tcp/`, the module that turns control-block variables into wire bytes and back, and
holds the arithmetic the state machine leans on: header build and parse, the mandatory checksum, the
sequence algebra, the SipHash initial sequence number, the RTT estimator, the Reno congestion controller, and
the send-window math. It is pure protocol code with no IPC in it; the [ip-link](/docs/userland/net-tcp/ip-link/) page covers how a
built segment reaches `net.ip`, and the [connections](/docs/userland/net-tcp/connections/) page covers who calls each function.

## The header and its flags

A TCP header is modeled as a plain struct of the fields the machine reads, `src_port`, `dst_port`, `seq`,
`ack`, `flags`, and `window`, plus a `has_flag` helper ([`src/tcp/header.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/header.rs#L26)). The five flag bits are
`FIN`, `SYN`, `RST`, `PSH`, and `ACK`, matching their RFC 793 positions ([`src/tcp/header.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/header.rs#L20)). The
minimum header length is twenty bytes and the checksum sits at offset sixteen ([`src/tcp/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/header.rs#L17)).

## Build

`build` serializes a `BuildRequest`, the source and destination IPv4 addresses, the ports, sequence and ack
numbers, flags, window, and payload, into a caller-provided buffer ([`src/tcp/build.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/build.rs#L38)). It writes the
ports, sequence, and ack big-endian, sets the data-offset nibble to 5 (a twenty-byte header, no options),
writes the flags and window, zeroes the checksum and the urgent pointer, copies the payload, then computes
and writes the checksum over the finished segment ([`src/tcp/build.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/build.rs#L43)). It refuses a buffer smaller than
the header plus payload with `OutputTooSmall`. Every segment this capsule emits carries no options; the fixed
data offset of 5 is why.

## Parse

`parse` takes the source and destination IPv4 addresses and the raw segment and returns the header and the
payload slice ([`src/tcp/parse.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/parse.rs#L27)). It rejects a segment shorter than twenty bytes as `TooShort`, a
data-offset nibble below 5 or one that runs past the buffer as `BadDataOffset`, and a segment whose checksum
does not verify to zero as `BadChecksum` ([`src/tcp/parse.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/parse.rs#L32)). It reads the ports, sequence, ack, flags,
and window big-endian and returns the payload as the bytes past the header length, so options, if a peer
sent any, are skipped rather than parsed ([`src/tcp/parse.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/parse.rs#L46)).

## Checksum

The checksum is the RFC 793 / 1071 sixteen-bit ones-complement fold over the IPv4 pseudo-header, the source
and destination addresses, a zero byte, the protocol number 6, and the TCP length, followed by the segment
itself ([`src/tcp/checksum.rs:39`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/checksum.rs#L39)). Bytes are summed big-endian in pairs with a final odd byte padded, the
carries are folded, and the result is complemented ([`src/tcp/checksum.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/checksum.rs#L24)). Verification reuses the same
function: a correct segment sums to zero, which is exactly what `parse` checks. The module comment records
the rule that, unlike UDP, a TCP checksum is mandatory and a zero on the wire is a protocol error
([`src/tcp/checksum.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/checksum.rs#L17)).

## Sequence algebra

TCP sequence numbers are a 32-bit modular space, so comparisons are done as signed differences. `lt`, `leq`,
and `gt` compare by casting the wrapped difference to `i32`; `between` tests a half-open interval; and
`acceptable` is the RFC 793 receive-window acceptability test, split by whether the segment has length and
whether the window is zero ([`src/tcp/seq.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/seq.rs#L17)). These are the functions the established and closing
transitions call before they trust a segment's sequence.

## The initial sequence number

Each connection's ISS is not a counter; it is a keyed hash of the four-tuple mixed with the clock, which is
what makes it hard to guess off-path. `iss_for` builds a twelve-byte buffer from the local IP and port and
the remote IP and port, hashes it with SipHash-2-4 under a per-boot key, and adds the low bits of the
millisecond clock ([`src/tcp/iss.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/iss.rs#L20)). The key is sixteen bytes drawn from `crypto_random` at setup, which
is what the `Crypto` capability buys the capsule ([`src/setup.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/setup.rs#L33)). `siphash24` is a direct implementation
of SipHash-2-4: the four-word state seeded from the key and the constants, two compression rounds per
eight-byte block, a length-tagged final block, and four finalization rounds ([`src/tcp/siphash.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/siphash.rs#L40)).

## The RTT estimator

`Rtt` is the RFC 6298 smoothed round-trip estimator ([`src/tcp/rtt.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/rtt.rs#L19)). The first sample seeds `srtt` to
the measurement and `rttvar` to half of it; later samples update `rttvar` with a one-quarter gain on the
deviation and `srtt` with a one-eighth gain, then set the RTO to `srtt + 4*rttvar` clamped to `[200,
60000]` milliseconds ([`src/tcp/rtt.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/rtt.rs#L35)). `backoff` doubles the RTO on a timeout, capped at the maximum,
which is Karn's exponential backoff ([`src/tcp/rtt.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/rtt.rs#L49)). The initial RTO before any sample is one second
([`src/tcp/mod.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/mod.rs#L55)).

## The congestion controller

`Cc` is NewReno-style congestion control ([`src/tcp/cc.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/cc.rs#L19)). It starts with a congestion window of three
maximum segments and an effectively infinite slow-start threshold ([`src/tcp/cc.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/cc.rs#L26)). A new ACK adds one
MSS in slow start and one MSS-per-window in congestion avoidance ([`src/tcp/cc.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/cc.rs#L32)). A timeout halves the
slow-start threshold to at least two segments and drops the window to one segment ([`src/tcp/cc.rs:41`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/cc.rs#L41)). The
third duplicate ACK enters fast recovery, halving the threshold and inflating the window; further duplicates
inflate it by one MSS each, the standard fast-retransmit / fast-recovery inflation
([`src/tcp/cc.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/cc.rs#L47)). The dup-ACK threshold is three ([`src/tcp/mod.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/mod.rs#L51)).

## The send window

`window::usable` returns how many new bytes may be sent: the minimum of the peer's advertised window and the
congestion window, less the bytes already in flight ([`src/tcp/window.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/window.rs#L23)). `should_update` is the RFC 793
window-update test, taking a new window only when the segment is newer by the `wl1`/`wl2` watermarks
([`src/tcp/window.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/window.rs#L19)). These are the two functions the sender and the established transition use to decide
how much to put on the wire.

## Sizing constants

The tunables live at the top of the module ([`src/tcp/mod.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/mod.rs#L38)). `MSS` is the segment payload cap of 1460.
`RWND_MAX` is the receive-window ceiling, the receive-queue depth times the MSS. `SND_BUF_MAX` is a 64 KiB
send buffer. `MAX_RETX` is eight transmissions before abort. `REASM_MAX_SEGS` bounds the reassembly map at
thirty-two out-of-order segments, and `MAX_CONN_PER_PID` caps a single client at thirty-two connections.
`INIT_CWND` is three MSS. Every one of these is a per-connection or per-client bound, which is what keeps a
hostile or buggy peer from growing this capsule's memory without limit.

## Source map

```
  userland/capsule_net_tcp/src/tcp/mod.rs        the re-exports and the sizing constants
  userland/capsule_net_tcp/src/tcp/header.rs     the TcpHeader struct and the flag bits
  userland/capsule_net_tcp/src/tcp/build.rs      segment serialization
  userland/capsule_net_tcp/src/tcp/parse.rs      segment deserialization and validation
  userland/capsule_net_tcp/src/tcp/checksum.rs   the IPv4 pseudo-header ones-complement checksum
  userland/capsule_net_tcp/src/tcp/seq.rs        the modular sequence comparisons and acceptability test
  userland/capsule_net_tcp/src/tcp/iss.rs        the SipHash-keyed initial sequence number
  userland/capsule_net_tcp/src/tcp/siphash.rs    the SipHash-2-4 implementation
  userland/capsule_net_tcp/src/tcp/rtt.rs        the RFC 6298 RTT estimator and Karn backoff
  userland/capsule_net_tcp/src/tcp/cc.rs         the NewReno congestion controller
  userland/capsule_net_tcp/src/tcp/window.rs     the usable-window and window-update math
  userland/capsule_net_tcp/src/tcp/tcb.rs        the Tcb, SendVars, RecvVars, and Endpoint4 layout
```

Every reference above is verified against those trees.
