---
title: "The connection table and its queues"
description: "This page mirrors src/state/, the module that holds every byte of TCP state the capsule owns: the control block per connection, the process-global table with its handle and quot..."
weight: 5
---
This page mirrors `src/state/`, the module that holds every byte of TCP state the capsule owns: the control
block per connection, the process-global table with its handle and quota model, the retransmit queue, the
out-of-order reassembly map, the TimeWait timer set, and the process-global network locals. The kernel owns
none of this; that is the whole point of a userland transport. The [connections](/docs/userland/net-tcp/connections/) page drives
this state, and the [segments](/docs/userland/net-tcp/segments/) page owns the `Tcb` fields it stores.

## The control block

`Tcb` is the transmission control block: the local and remote endpoints, the current `State`, and the send
and receive variable sets ([`src/tcp/tcb.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/tcb.rs#L42)). `SendVars` holds `una`, `nxt`, `wnd`, `iss`, and the
window-update watermarks `wl1` and `wl2`; `RecvVars` holds `nxt`, `wnd`, and `irs`
([`src/tcp/tcb.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/tcb.rs#L25)). `Tcb::listen` builds a fresh block in `State::Listen` with a zeroed remote, and
`matches` is the four-tuple test the table uses, treating a listener as matching any remote
([`src/tcp/tcb.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/tcb.rs#L51)).

## The entry

An `Entry` wraps a `Tcb` with the runtime queues a live connection needs ([`src/state/entry.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/entry.rs#L24)):

- `owner_pid` and `handle` identify the connection to its client; `parent` links a child to the listener that
  accepted it.
- `rx` is the received-payload queue an `OP_RECV` pops from, bounded at `RX_DEPTH = 32`
  ([`src/state/entry.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/entry.rs#L22), [`src/state/entry.rs:78`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/entry.rs#L78)).
- `accept` is the queue of child handles an `OP_ACCEPT` pops from, same bound ([`src/state/entry.rs:86`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/entry.rs#L86)).
- `snd_buf` is the byte stream the sender pump drains; `enqueue_send` refuses bytes that would exceed
  `SND_BUF_MAX` and is what makes `OP_SEND` return `E_TIMEOUT` under backpressure ([`src/state/entry.rs:65`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/entry.rs#L65)).
- `retx` is the retransmit queue, `rtt` the estimator, `reasm` the reassembly map, and `cc` the congestion
  controller, one of each per connection ([`src/state/entry.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/entry.rs#L32)).

`rwnd` computes the advertised receive window as the ceiling less the bytes already queued, which is how
backpressure reaches the peer: a full receive queue advertises a smaller window ([`src/state/entry.rs:73`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/entry.rs#L73)).
`retx_push` stamps a segment with the current clock and a transmit count of one when it enters the retransmit
queue ([`src/state/entry.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/entry.rs#L55)).

## The table

`TABLE` is a single process-global `Mutex<Table>` ([`src/state/table/types.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table/types.rs#L25)). The table holds the entry
vector, the next handle to mint, the timer set, and the ISS key ([`src/state/table/types.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table/types.rs#L27)). It is capped
at `TABLE_CAP = 256` total connections ([`src/state/table/types.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table/types.rs#L24)). `seed_iss` stores the SipHash key set
at setup, and `iss_for_pair` derives a connection's ISS from that key and the four-tuple
([`src/state/table/types.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table/types.rs#L44)).

Lookups are linear scans over the entry vector ([`src/state/table/lookup.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table/lookup.rs#L22)): `owned_mut` finds a
connection by owner and handle, the ownership check behind every op; `by_handle_mut` finds one by handle
regardless of owner, used to reach a listener from a child; `listener_for_mut` finds the `Listen` entry on a
port; and `connection_match_mut` finds a non-listener whose four-tuple matches an inbound segment. The
ownership scan is what enforces that a client can only act on handles it opened, so `OP_SEND` or `OP_CLOSE`
against another client's handle returns `E_NO_SOCKET`.

Mutation is in one file ([`src/state/table/mutate.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table/mutate.rs#L26)). `insert` refuses a new connection when the table is
at `TABLE_CAP` or when the owner already holds `MAX_CONN_PER_PID = 32` connections, mints a monotonic handle
that skips zero, and appends the entry ([`src/state/table/mutate.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table/mutate.rs#L31)). `remove` deletes by owner and
handle; `remove_by_handle` deletes by handle alone, used when the receive path reaps a connection whose
client is not in scope; `is_idle` reports whether the table and timers are both empty, which is what parks
the server loop; and `entries_mut` exposes the slice the retransmit scan walks
([`src/state/table/mutate.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/table/mutate.rs#L44)). The per-pid quota is the bound that stops one client from exhausting the
table.

## The retransmit queue

`RetxQueue` is a FIFO of `RetxSeg`, each carrying the segment's sequence, flags, payload, send timestamp, and
transmit count ([`src/state/retx.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/retx.rs#L22)). `push` appends, `oldest_mut` returns the front for the RTO scan and
fast retransmit, and `ack` pops every fully-acknowledged segment off the front, counting a FIN as one
sequence unit so a FIN is retired correctly ([`src/state/retx.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/retx.rs#L51)). The scan in
[`src/server/retransmit.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/retransmit.rs) reads `oldest_mut`, and the established transition calls `ack` on every new ACK.

## Reassembly

`Reasm` is a `BTreeMap` keyed by sequence number, holding out-of-order segments until the gap ahead of them
fills ([`src/state/reasm.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/reasm.rs#L22)). `insert` drops empty segments and refuses to grow past `REASM_MAX_SEGS`,
the bound that caps out-of-order memory ([`src/state/reasm.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/reasm.rs#L35)). `drain_contiguous` walks the map from the
low key, splicing every segment that starts at or before `rcv.nxt` into a contiguous run and trimming any
overlap, and stops at the first gap ([`src/state/reasm.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/reasm.rs#L42)). The established transition stashes a gapped
segment with `insert` and, after an in-order delivery, calls `drain_contiguous` to release whatever the new
bytes just made contiguous.

## Timers

`Timers` is a small vector of `(handle, kind, deadline)` entries, and the only kind is `TimeWait`
([`src/state/timers.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/timers.rs#L19)). `arm` sets or updates a handle's deadline, `cancel_all` drops every timer for a
handle, `next_deadline` is the minimum deadline the server loop uses to size its receive budget, and
`drain_due` pops and returns every timer at or before a given time ([`src/state/timers.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/timers.rs#L40)). The tick reaps
the connection behind each due TimeWait timer.

## Process locals

`globals.rs` holds the three pieces of state that are process-wide rather than per-connection
([`src/state/globals.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/globals.rs#L20)): the `net.ip` service port, the local IPv4 address, and the next ephemeral port.
The IP port is an atomic, the local IP a small mutex, and the ephemeral port an atomic counter that starts at
49152 and wraps back into the ephemeral range, which is what `open::connection` draws a local port from
([`src/state/globals.rs:40`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/globals.rs#L40)). Setup writes the IP port and local IP once the `net.ip` lookup and config read
succeed.

## Source map

```
  userland/capsule_net_tcp/src/tcp/tcb.rs             the Tcb, SendVars, RecvVars, Endpoint4, and matches
  userland/capsule_net_tcp/src/state/entry.rs         the Entry control block and its bounded queues
  userland/capsule_net_tcp/src/state/table/types.rs   the TABLE mutex, its caps, and the ISS key
  userland/capsule_net_tcp/src/state/table/lookup.rs  the owner, handle, listener, and four-tuple scans
  userland/capsule_net_tcp/src/state/table/mutate.rs  insert with quota, remove, is_idle, entries_mut
  userland/capsule_net_tcp/src/state/retx.rs          the retransmit FIFO and its ack retirement
  userland/capsule_net_tcp/src/state/reasm.rs         the out-of-order reassembly map
  userland/capsule_net_tcp/src/state/timers.rs        the TimeWait timer set
  userland/capsule_net_tcp/src/state/globals.rs       the IP port, local IP, and ephemeral-port locals
```

Every reference above is verified against those trees.
