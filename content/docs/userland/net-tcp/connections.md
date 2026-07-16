---
title: "The connection state machine"
description: "This page mirrors src/server/tcprx/, the connect handler under src/server/handlers/connect/, and the three server-loop drivers tick.rs, sender.rs, and retransmit.rs."
weight: 3
---
This page mirrors `src/server/tcp_rx/`, the connect handler under `src/server/handlers/connect/`, and the
three server-loop drivers `tick.rs`, `sender.rs`, and `retransmit.rs`. It is the heart of the capsule: the
ten-state machine, the two ways a connection opens, established data flow, the four ways it closes, reset
handling, and the two background pumps that move data and recover loss. For the op that triggers each path,
read the [operations](/docs/userland/net-tcp/operations/) page; for the control block the machine mutates, read the
[state](/docs/userland/net-tcp/state/) page.

## The ten states

The `State` enum is a `repr(u8)` with ten variants, and the numeric discriminant is exactly what `OP_STATE`
returns ([`src/tcp/state.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/state.rs#L17)).

| Code | State | Meaning |
|---|---|---|
| 0 | `Listen` | a passive open waiting for a SYN |
| 1 | `SynSent` | an active open, SYN sent, awaiting SYN-ACK |
| 2 | `SynReceived` | a SYN seen, SYN-ACK sent, awaiting the final ACK |
| 3 | `Established` | the data-transfer state |
| 4 | `CloseWait` | the peer sent FIN; the local side may still send |
| 5 | `FinWait1` | local FIN sent, not yet acked |
| 6 | `FinWait2` | local FIN acked, awaiting the peer FIN |
| 7 | `Closing` | simultaneous close, both FINs in flight |
| 8 | `TimeWait` | both FINs exchanged, holding for 2*MSL |
| 9 | `LastAck` | closing from `CloseWait`, awaiting the final ack |

Two predicates gate the transition dispatch: `accepts_data` is true only in `Established`, and `is_closing`
is true for the five teardown states ([`src/tcp/state.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/state.rs#L33)).

## The receive path

Every inbound segment enters through `drain_one` ([`src/server/tcp_rx/drain.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/drain.rs#L24)). It polls one TCP segment
from `net.ip`, parses and checksum-verifies it, builds the local and remote endpoints from the IPv4 and TCP
headers, and hands them to `existing::update` ([`src/server/tcp_rx/drain.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/drain.rs#L32)). The action `update` returns
decides what leaves next: `Reply` sends a segment on the matched control block, `Rst` sends a reset,
`Reap` and `None` send nothing ([`src/server/tcp_rx/action.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/action.rs#L21)). If no connection matched and the segment
is a bare SYN, `drain_one` runs the passive-open path ([`src/server/tcp_rx/drain.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/drain.rs#L43)).

`existing::update` is the dispatcher ([`src/server/tcp_rx/existing.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/existing.rs#L25)). With the table locked it finds the
matching connection and routes by state:

- No match: a stray RST is dropped, a SYN to a live listener is left for the passive-open path, an ACK gets a
  RST seeded from its ack field, and anything else gets a RST that acks the incoming sequence
  ([`src/server/tcp_rx/existing.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/existing.rs#L31)). This is the standard "reset the stranger" behaviour.
- A match with RST set is reaped if the sequence falls inside the receive window, else ignored
  ([`src/server/tcp_rx/existing.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/existing.rs#L47), [`src/server/tcp_rx/rst.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/rst.rs#L19)).
- `SynSent` routes to the handshake transition, `SynReceived` completes on the final ACK, a closing state
  routes to the closing transition, and an established connection routes to the data transition
  ([`src/server/tcp_rx/existing.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/existing.rs#L49)).

When the final ACK completes a passive open, `update` records the parent listener and child handle and, after
the borrow ends, pushes the child onto the listener's accept queue so `OP_ACCEPT` can return it
([`src/server/tcp_rx/existing.rs:77`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/existing.rs#L77)). A `Reap` action removes the entry and cancels its timers; an armed
deadline sets a TimeWait timer ([`src/server/tcp_rx/existing.rs:82`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/existing.rs#L82)).

## Passive open

A listener is created by `OP_LISTEN`. When a bare SYN arrives for its port, `accept::syn` runs
([`src/server/tcp_rx/accept.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/accept.rs#L20)). If a half-open connection for that four-tuple already exists in
`SynReceived` it re-sends the SYN-ACK; otherwise it finds the listener, derives the ISS for the pair, builds
a `SynReceived` control block with the peer's sequence recorded as `irs` and `rcv.nxt = seq + 1`, inserts it
under the listener's owner and handle, and returns the block for the SYN-ACK ([`src/server/tcp_rx/accept.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/accept.rs#L30)).
The final ACK moves it to `Established` in `existing::update`, which is where the accept-queue push happens.

## Active open

`OP_CONNECT` drives the active path. `open::connection` picks an ephemeral local port, derives the ISS,
builds a control block in `SynSent` with `snd.nxt = iss` for the SYN it is about to send and then advances
`snd.nxt` to `iss + 1` for what follows, and inserts it ([`src/server/handlers/connect/open.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect/open.rs#L20)). The SYN
goes out and `wait::established` spins, draining the receive path and yielding, until the block reaches
`Established` or the deadline passes ([`src/server/handlers/connect/wait.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect/wait.rs#L27)). The deadline is 8000
milliseconds when the clock is live, with a fixed iteration fallback if the clock reads zero
([`src/server/handlers/connect/wait.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/connect/wait.rs#L24)). The `handshake::step` transition matches the SYN-ACK: it checks
the ack equals `snd.nxt`, records the peer sequence as `rcv.nxt`, snapshots the send window and its update
watermarks, moves to `Established`, and replies an ACK ([`src/server/tcp_rx/transitions/handshake.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/transitions/handshake.rs#L23)).

## Established data flow

`established::step` is the data-transfer transition ([`src/server/tcp_rx/transitions/established.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/transitions/established.rs#L23)). In
order it:

1. Rejects an unacceptable sequence with an immediate window-advertising ACK, using the sequence-window test
   ([`src/server/tcp_rx/transitions/established.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/transitions/established.rs#L24), [`src/tcp/seq.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/seq.rs#L33)).
2. On a new ACK, takes an RTT sample from the oldest un-retransmitted segment, advances `snd.una`, drops
   acked segments from the retransmit queue, opens the congestion window, updates the send window under the
   `wl1`/`wl2` watermark rule, and pumps the sender ([`src/server/tcp_rx/transitions/established.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/transitions/established.rs#L28)).
3. On a duplicate ACK with the retransmit queue non-empty, counts it toward fast retransmit and, at the
   threshold, resends the oldest segment ([`src/server/tcp_rx/transitions/established.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/transitions/established.rs#L55)).
4. Delivers in-order payload straight to the receive queue and then drains any now-contiguous out-of-order
   segments; a gap is stashed in the reassembly map ([`src/server/tcp_rx/transitions/established.rs:70`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/transitions/established.rs#L70)).
5. A FIN with an empty reassembly map advances `rcv.nxt` and moves to `CloseWait`
   ([`src/server/tcp_rx/transitions/established.rs:84`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/transitions/established.rs#L84)).

Every established segment replies with an ACK carrying the freshly computed receive window
([`src/server/tcp_rx/transitions/established.rs:88`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/transitions/established.rs#L88)).

## Sending and retransmission

Two pumps run outside the op handlers. `sender::drain_send` walks the send buffer while the usable window is
non-zero, cutting `MSS`-sized segments, sending each with ACK and PSH set, advancing `snd.nxt`, and queuing
each for retransmit ([`src/server/sender.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/sender.rs#L20)). The usable window is the minimum of the peer window and the
congestion window, less what is already in flight ([`src/tcp/window.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/window.rs#L23)). `retransmit::scan` runs each tick:
for every connection with a non-empty retransmit queue whose oldest segment is older than the current RTO it
resends that segment, bumps its transmit count, backs off the RTO, and shrinks the congestion window; a
segment that exceeds `MAX_RETX` transmissions aborts the connection ([`src/server/retransmit.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/retransmit.rs#L22),
[`src/tcp/mod.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/mod.rs#L44)).

## The four close paths

Closing starts either from the local side, when `OP_CLOSE` queues and sends a FIN, or from the peer, when a
FIN drives an established connection to `CloseWait`. `closing::step` handles every segment once a connection
is in a teardown state ([`src/server/tcp_rx/transitions/closing.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/transitions/closing.rs#L23)). It checks acceptability against a
segment length that counts the FIN, notes whether the segment acks the local FIN, and routes by state:

- `FinWait1` with both the ack and a peer FIN goes to `TimeWait`; with only the ack goes to `FinWait2`; with
  only the FIN goes to `Closing` ([`src/server/tcp_rx/transitions/closing.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/transitions/closing.rs#L36)).
- `FinWait2` with a peer FIN goes to `TimeWait` ([`src/server/tcp_rx/transitions/closing.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/transitions/closing.rs#L46)).
- `Closing` with the ack goes to `TimeWait` ([`src/server/tcp_rx/transitions/closing.rs:47`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/transitions/closing.rs#L47)).
- `LastAck` with the ack is reaped ([`src/server/tcp_rx/transitions/closing.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/transitions/closing.rs#L51)).

Entering `TimeWait` acks the peer FIN and arms a timer for `now + 2*MSL`; the tick reaps the entry when the
timer fires ([`src/server/tcp_rx/transitions/closing.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tcp_rx/transitions/closing.rs#L57), [`src/server/tick.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/tick.rs#L31)). `MSL` is thirty
seconds, so the hold is one minute ([`src/tcp/mod.rs:42`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/mod.rs#L42), [`src/tcp/mod.rs:57`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/tcp/mod.rs#L57)).

## Source map

```
  userland/capsule_net_tcp/src/tcp/state.rs                    the ten-state enum and its predicates
  userland/capsule_net_tcp/src/server/tcp_rx/drain.rs          poll, parse, and route one inbound segment
  userland/capsule_net_tcp/src/server/tcp_rx/existing.rs       the per-state dispatcher and the stranger-RST rules
  userland/capsule_net_tcp/src/server/tcp_rx/action.rs         the RxAction the dispatcher returns
  userland/capsule_net_tcp/src/server/tcp_rx/accept.rs         passive open: the SYN handler
  userland/capsule_net_tcp/src/server/tcp_rx/rst.rs            the in-window reset test
  userland/capsule_net_tcp/src/server/tcp_rx/transitions/handshake.rs   the SYN-ACK transition
  userland/capsule_net_tcp/src/server/tcp_rx/transitions/established.rs  data, ACK, dup-ACK, reassembly, FIN
  userland/capsule_net_tcp/src/server/tcp_rx/transitions/closing.rs     the teardown transitions and TimeWait
  userland/capsule_net_tcp/src/server/handlers/connect/open.rs the active-open control block
  userland/capsule_net_tcp/src/server/handlers/connect/wait.rs the established wait and its deadline
  userland/capsule_net_tcp/src/server/sender.rs               the send-buffer pump
  userland/capsule_net_tcp/src/server/retransmit.rs           the RTO scan and abort
  userland/capsule_net_tcp/src/server/tick.rs                 the timer reap that closes TimeWait
```

Every reference above is verified against those trees.
