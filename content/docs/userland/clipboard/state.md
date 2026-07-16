---
title: "Clipboard storage and the idle wipe"
description: "This page is the clipboard's data model: the record one copy produces, the bounded FIFO that holds the history, the eviction that keeps it bounded, the content-type tag, and the..."
weight: 2
---
This page is the clipboard's data model: the record one copy produces, the bounded FIFO that holds the
history, the eviction that keeps it bounded, the content-type tag, and the idle timer that empties the
store after a period of inactivity. It mirrors `userland/capsule_clipboard/src/state/`. The operations that
read and mutate this store are on the [operations and wire](/docs/userland/clipboard/protocol/) page; the identity and mask are on
the [README](/docs/userland/clipboard/).

## The entry

Each stored item is an `Entry` ([`src/state/entry.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/entry.rs#L19)): a `content_type: u32` and a `Vec<u8>` of the
bytes. `Entry::len` (`entry.rs:25`) is the byte length of the data, used by the history-listing op and by
the byte accounting. The content type is an opaque tag. The capsule never interprets it and stores the
bytes unchanged, so there is no format or encoding assumption inside the store.

The one content type in use today is `CONTENT_TYPE_TEXT = 1`, set by the client helpers
([`userland/app_skeleton/src/clients/clipboard/copy.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/clients/clipboard/copy.rs#L23), [`.../paste.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../paste.rs#L23)). Any other `u32` works the
same way. Because `OP_PASTE` matches on the exact type value (see the [protocol](/docs/userland/clipboard/protocol/) page), two
callers using different type tags keep separate most-recent entries inside the one shared FIFO.

## The store

The store is `Clipboard` ([`src/state/clipboard/types.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/clipboard/types.rs#L21)): a `VecDeque<Entry>` named `items`, a running
`total_bytes`, the `max_depth` and `max_total_bytes` caps, the `last_activity_ms` timestamp, and the
`idle_timeout_ms`. All of it lives in the capsule's heap. `Clipboard::new` (`types.rs:31`) is called once
from the server loop with the compile-time bounds and the current time as the initial activity stamp.

The bounds come from [`src/protocol/limits.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs):

```
  MAX_DEPTH             = 16                    (types.rs / limits.rs:18)
  MAX_TOTAL_BYTES       = 256 * 1024            (256 KiB, limits.rs:19)
  MAX_ENTRY_BYTES       = 64 * 1024             (64 KiB, per-entry cap, limits.rs:20)
  IPC_PAYLOAD_MAX       = MAX_ENTRY_BYTES + 32  (recv/reply buffer size, limits.rs:21)
  DEFAULT_IDLE_TIMEOUT_MS = 600000              (10 minutes, limits.rs:22)
  MIN_IDLE_TIMEOUT_MS   = 5000                  (5 seconds, limits.rs:23)
  MAX_IDLE_TIMEOUT_MS   = 86400000              (24 hours, limits.rs:24)
```

`MAX_ENTRY_BYTES` is enforced at the wire, by `OP_COPY`, before an entry ever reaches the store.
`MAX_DEPTH` and `MAX_TOTAL_BYTES` are enforced here, by eviction on every copy. `IPC_PAYLOAD_MAX` sizes the
receive and reply buffers in the server loop so a maximum entry plus the header always fits.

## Copy and eviction

`Clipboard::copy` ([`src/state/clipboard/storage.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/clipboard/storage.rs#L21)) is the only path that grows the store. It pushes
the new entry to the front of the deque, adds its bytes to `total_bytes`, then evicts from the back while
either the depth or the byte total is over cap:

```
  copy(content_type, data, now_ms):
      items.push_front(Entry { content_type, data.to_vec() })
      total_bytes += data.len()
      while items.len() > max_depth or total_bytes > max_total_bytes:
          tail = items.pop_back()
          total_bytes = total_bytes.saturating_sub(tail.len())
      last_activity_ms = now_ms
```

Front is newest, back is oldest, so eviction always drops the least recently copied entries first
(`storage.rs:24`). The byte total is decremented with a saturating subtract (`storage.rs:26`), so the
counter never underflows even under an unexpected sequence, and the loop breaks if the deque somehow
empties mid-eviction (`storage.rs:27`). Copy is the one mutating op that stamps `last_activity_ms` inline
rather than through `touch`.

## Reading the store

Three read paths, none of which mutate:

- `latest_of_type` (`storage.rs:33`) returns the first entry from the front whose `content_type` matches,
  which is the most recent copy of that type. This backs `OP_PASTE`.
- `get_by_index` (`storage.rs:36`) returns the entry at a deque index, where index 0 is the newest. This
  backs `OP_HISTORY_GET`, whose handler maps an out-of-range index to `E_RANGE`.
- `iter` (`storage.rs:39`) walks front to back. This backs `OP_HISTORY_LIST`, which counts the entries and
  emits a `(content_type, len)` pair for each.

`clear` (`storage.rs:42`) drops every entry and resets `total_bytes` to zero. It is called by `OP_CLEAR`
and by the idle timer.

## The idle wipe

The defining behavior is the idle garbage collection ([`src/state/clipboard/timer.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/clipboard/timer.rs)). The activity
timestamp gates it:

- `touch` (`timer.rs:20`) sets `last_activity_ms` to the current time. `OP_COPY` stamps the time inline,
  and `OP_PASTE`, `OP_HISTORY_GET`, and `OP_CLEAR` call `touch` (the last after wiping), so the clipboard
  does not expire while it is being used.
- `idle_for` (`timer.rs:23`) is `now_ms.saturating_sub(last_activity_ms)`, so a clock that appears to move
  backwards reads as zero idle time rather than a huge one.
- `expire_if_idle` (`timer.rs:26`) is the wipe. It returns early without clearing if the timeout is `0` or
  the store is already empty (`timer.rs:27`). Otherwise, if `idle_for` is at least the idle timeout, it
  clears the whole history and reports that it did (`timer.rs:30`).
- `set_idle_timeout_ms` (`timer.rs:36`) replaces the timeout. `OP_SET_IDLE_TIMEOUT` validates the value
  against the 5s..24h band (or accepts `0` to disable) before calling this.

The server loop calls `expire_if_idle` at the top of every iteration, before the blocking receive
([`src/server/runner.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L33)), so a clipboard left untouched past its timeout is emptied on the next wakeup
rather than only when the next request arrives.

`OP_HEALTHCHECK`, `OP_HISTORY_LIST`, and `OP_SET_IDLE_TIMEOUT` deliberately do not touch the timestamp, so
pinging liveness, listing the shape of the history, or changing the window does not extend the retention
window. This is a privacy posture: copied content does not linger indefinitely, and the acts of inspecting
the store's metadata do not keep it alive.

## Source map

```
  userland/capsule_clipboard/src/state/entry.rs               content_type + Vec<u8> record, len()
  userland/capsule_clipboard/src/state/clipboard/types.rs     the VecDeque, byte total, caps, activity stamp
  userland/capsule_clipboard/src/state/clipboard/storage.rs   copy/evict, latest_of_type, get_by_index, iter, clear
  userland/capsule_clipboard/src/state/clipboard/timer.rs     touch, idle_for, expire_if_idle, set_idle_timeout_ms
  userland/capsule_clipboard/src/protocol/limits.rs           depth 16, 256 KiB total, 64 KiB entry, the timeouts
```

Every reference above is verified against those trees.
