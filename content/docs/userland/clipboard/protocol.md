---
title: "Clipboard operations and wire format"
description: "This page is the clipboard's protocol: the frame every request and reply carries, the parser and reply builders that read and write it, the seven operations with their opcodes a..."
weight: 1
---
This page is the clipboard's protocol: the frame every request and reply carries, the parser and reply
builders that read and write it, the seven operations with their opcodes and reply layouts, the typed
errno table, and the server loop that drives all of it. It mirrors `userland/capsule_clipboard/src/protocol/`
and `userland/capsule_clipboard/src/server/`. The store the handlers read and mutate is on the
[state](/docs/userland/clipboard/state/) page; the capsule identity and mask are on the [README](/docs/userland/clipboard/).

## The frame

Every request and reply starts with a fixed 20-byte header (`HDR_LEN = 20`, [`src/protocol/header.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L19)),
all fields little-endian:

```
  offset  size  field
  0       4     magic        0x43424930
  4       2     version      1
  6       2     op
  8       2     flags
  10      2     reserved     (zeroed in replies)
  12      4     request_id
  16      4     payload_len
```

The magic is `MAGIC = 0x4342_4930` ([`src/protocol/header.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L17)), which is the ASCII bytes `43 42 49 30`,
that is `CBI0`, the NØNOS clipboard interface tag. `VERSION = 1` ([`src/protocol/header.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/header.rs#L18)). The client
side carries the same constant under the name `NCLP_MAGIC = 0x4342_4930`
([`userland/app_skeleton/src/wire/constants.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/wire/constants.rs#L21)), so the two ends agree by construction.

## Parsing a request

`parse` ([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19)) decodes a request by explicit little-endian indexing through
`u16_le` and `u32_le` ([`src/protocol/decode.rs:46`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L46), `:50`), never by `try_into().unwrap()`, so a short or
malformed buffer is a typed error rather than a panic. It checks in order:

1. The buffer holds at least the 20-byte header, else `E_BAD_LEN` (`decode.rs:20`).
2. The magic at offset 0 matches `MAGIC`, else `E_BAD_MAGIC` (`decode.rs:28`).
3. The version at offset 4 matches `VERSION`, else `E_BAD_VERSION` (`decode.rs:32`).
4. The buffer holds `HDR_LEN + payload_len` bytes, else `E_BAD_LEN` (`decode.rs:36`).

On success it returns the parsed `Request { op, flags, request_id }` and a slice over exactly the declared
payload (`decode.rs:39`). The op, flags, and request id are read at offsets 6, 8, and 12 before the magic
and version checks (`decode.rs:23`), so even an error reply echoes the caller's op and request id back;
only a buffer too short to hold a header falls back to a zeroed `Request` (`decode.rs:21`, `:42`).

## Building a reply

Every reply is built by the `respond` module ([`src/server/respond.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/respond.rs)) on top of two encoders. The reply
header ([`src/protocol/encode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/encode.rs#L19), `response_header`) copies the request's op, flags, and request id
back, zeroes the reserved field, and sets `payload_len`. `write_status` (`encode.rs:29`) writes a 4-byte
signed `i32` status at offset 20 (`STATUS_LEN = 4`, [`src/protocol/limits.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/limits.rs#L17)).

- `respond::status` (`respond.rs:19`) writes the header plus the status and returns
  `HDR_LEN + STATUS_LEN = 24` bytes. This is the shape of every error reply and of every op that returns
  no data.
- `respond::with_payload` (`respond.rs:26`) writes the header, the status, and `payload_extra` more bytes,
  and returns `HDR_LEN + STATUS_LEN + payload_extra`. The handler has already laid the extra bytes into the
  output buffer past offset 24.

The status is `0` on success or a negative errno on failure. So a client can always read a signed `i32`
status at offset 20, and for the read operations, op-specific data after it.

## The server loop

`server::run` ([`src/server/runner.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L27)) is the entry point `main.rs` hands control to, and it never
returns. It builds the `Clipboard` with the compile-time bounds (`MAX_DEPTH`, `MAX_TOTAL_BYTES`,
`DEFAULT_IDLE_TIMEOUT_MS`), allocates a receive and a reply buffer of `IPC_PAYLOAD_MAX` bytes each, and
loops:

```
  run():
      clipboard = Clipboard::new(MAX_DEPTH 16, MAX_TOTAL_BYTES 256 KiB, DEFAULT_IDLE_TIMEOUT_MS 600000, now)
      in_buf  = vec![0; IPC_PAYLOAD_MAX]      // 64 KiB + 32
      out_buf = vec![0; IPC_PAYLOAD_MAX]
      loop:
          clipboard.expire_if_idle(read_time())          // clear the whole history if idle too long
          received = mk_ipc_recv_from(port 4414, in_buf, timeout 0, &sender_pid)
          if received <= 0 or sender_pid == 0: mk_yield(); continue
          n = route(&mut clipboard, &in_buf[..received], &mut out_buf, read_time())
          if n > 0: mk_ipc_reply(sender_pid, &out_buf[..n])
```

The port is `SERVICE_PORT = 4414` (`runner.rs:24`) and the receive timeout is `RECV_TIMEOUT_MS = 0`
(`runner.rs:25`), so a receive that returns nothing or a zero sender pid yields the CPU and loops rather
than spinning (`runner.rs:42`). `read_time` (`runner.rs:55`) reads `mk_time_millis` and floors a negative
return to `0`, so a clock error cannot make the idle math run backwards. The idle check runs at the top of
every iteration, before the blocking receive, so a clipboard that sits untouched past its timeout is
emptied on the next wakeup. A reply of zero length is never sent (`runner.rs:49`), though every handler
returns at least a 24-byte status reply, so that guard is defensive.

The sender pid is used only to address the reply (`mk_ipc_reply`, `runner.rs:50`). It is never checked
against any notion of entry ownership; the store is system-wide.

## The operations

Seven operations, dispatched by `route` ([`src/server/handlers/router.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/router.rs#L25)), which parses the frame once
and then matches on `req.op`. The opcodes are in [`src/protocol/ops.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/ops.rs#L17):

```
  OP_HEALTHCHECK      = 0x0001
  OP_COPY             = 0x0002
  OP_PASTE            = 0x0003
  OP_HISTORY_LIST     = 0x0004
  OP_HISTORY_GET      = 0x0005
  OP_CLEAR            = 0x0006
  OP_SET_IDLE_TIMEOUT = 0x0007
```

Any op outside this set returns `E_BAD_OP` (`router.rs:38`) with no state change. Three columns matter for
each op: what it takes, what it returns after the status, and whether it touches the activity timestamp
that gates the idle wipe.

| Op | Payload in | Reply after status | Touches activity | Handler |
|----|-----------|--------------------|-----------------|---------|
| `OP_HEALTHCHECK` | none | nothing | no | `health.rs:20` |
| `OP_COPY` | `content_type: u32`, then bytes | nothing | yes | `copy.rs:21` |
| `OP_PASTE` | `content_type: u32` | `len: u32`, then data | yes | `paste.rs:21` |
| `OP_HISTORY_LIST` | none | `count: u32`, then `count` pairs of `(content_type: u32, len: u32)` | no | `history_list.rs:21` |
| `OP_HISTORY_GET` | `index: u32` | `content_type: u32`, `len: u32`, then data | yes | `history_get.rs:21` |
| `OP_CLEAR` | none | nothing | yes (after wipe) | `clear.rs:21` |
| `OP_SET_IDLE_TIMEOUT` | `timeout_ms: u64` | nothing | no | `set_idle_timeout.rs:23` |

### OP_HEALTHCHECK

A liveness ping ([`src/server/handlers/health.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/health.rs#L20)). It touches no state, does not touch the activity
timestamp, and returns status `0` and nothing else. A caller uses it to confirm the service is up without
extending the retention window or reading any content.

### OP_COPY

Takes a payload of `content_type: u32` followed by the content bytes ([`src/server/handlers/copy.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/copy.rs#L21)). It
rejects a payload shorter than 4 bytes with `E_INVAL` (`copy.rs:22`), and rejects content longer than
`MAX_ENTRY_BYTES = 64 KiB` with `E_RANGE` (`copy.rs:27`). Otherwise it pushes the entry to the front of the
FIFO and returns status `0` (`copy.rs:30`). The push and eviction live in `state/` and are covered on the
[state](/docs/userland/clipboard/state/) page; copy is the only op that grows the store.

### OP_PASTE

Takes a `content_type: u32`, touches the activity timestamp, and returns the most recent entry of that
content type ([`src/server/handlers/paste.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/paste.rs#L21)). The reply after the status is `len: u32` followed by the
data (`paste.rs:36`). If no entry of that type exists it returns status `0` with no data (`paste.rs:29`),
so an empty clipboard is a success, not an error. A payload under 4 bytes is `E_INVAL` (`paste.rs:22`), and
an entry that does not fit the output buffer is `E_RANGE` and the entry is kept (`paste.rs:34`). Matching is
on the exact type value, so two callers using different type tags recall separate most-recent entries from
the same FIFO.

### OP_HISTORY_LIST

Takes no payload and does not touch the timestamp ([`src/server/handlers/history_list.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/history_list.rs#L21)). It returns
`count: u32` followed by `count` pairs of `(content_type: u32, len: u32)`, one per stored entry in
front-to-back order (`history_list.rs:27`). If the list would not fit in the output buffer it returns
`E_RANGE` (`history_list.rs:24`). This op exposes the shape of the whole history without exposing the
bytes; the bytes come from `OP_HISTORY_GET`.

### OP_HISTORY_GET

Takes an `index: u32`, touches the activity timestamp, and returns the entry at that index as
`content_type: u32`, `len: u32`, then the data ([`src/server/handlers/history_get.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/history_get.rs#L21), `:36`). Index 0 is
the most recent entry. An out-of-range index is `E_RANGE` (`history_get.rs:29`), a payload under 4 bytes is
`E_INVAL` (`history_get.rs:22`), and an entry that does not fit the output buffer is `E_RANGE`
(`history_get.rs:33`).

### OP_CLEAR

Drops every entry and resets the byte total, then touches the activity timestamp, and returns status `0`
([`src/server/handlers/clear.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/clear.rs#L21)). There is no payload. It touches the timestamp after wiping so a clear
does not immediately look idle.

### OP_SET_IDLE_TIMEOUT

Takes a `timeout_ms: u64` ([`src/server/handlers/set_idle_timeout.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/set_idle_timeout.rs#L23)). A payload under 8 bytes is
`E_INVAL` (`set_idle_timeout.rs:24`). The value `0` is accepted and disables the idle wipe. Any nonzero
value must fall within `MIN_IDLE_TIMEOUT_MS = 5000` (5 seconds) and `MAX_IDLE_TIMEOUT_MS = 86400000` (24
hours) or it returns `E_RANGE` and leaves the current timeout unchanged (`set_idle_timeout.rs:31`). On
success it updates the timeout and returns status `0`. This op deliberately does not touch the activity
timestamp, so shortening the window cannot itself extend it.

## The errno table

Every failure is a typed status on the reply, not a panic or a dropped connection. The values are in
[`src/protocol/errno.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/errno.rs#L17):

```
  E_INVAL       = -22   payload too short for the op (copy/paste/history_get under 4 bytes,
                        set_idle_timeout under 8)
  E_RANGE       = -34   entry over 64 KiB on copy; index out of range on history_get;
                        reply would not fit the output buffer; idle timeout out of the 5s..24h band
  E_BAD_OP      = -38   op not in 1..7
  E_BAD_MAGIC   = -71   header magic not 0x43424930
  E_BAD_LEN     = -90   buffer shorter than the header, or shorter than header + declared payload_len
  E_BAD_VERSION = -93   header version not 1
```

Beyond the wire, the only other failure is heap init at startup, which exits with status `1`
([`src/main.rs:14`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L14)). A receive that returns nothing or a zero sender pid is not an error; the loop yields
and retries.

## Security notes

The clipboard is a cross-capsule data channel, so its boundary is worth stating plainly.

- No persistence. The mask carries no `FileSystem` bit, and the store is a `VecDeque` in the capsule's heap
  (see the [state](/docs/userland/clipboard/state/) page). Copied content lives only in RAM, is gone when the capsule exits, and
  the idle wipe empties the whole history after the timeout even while the capsule keeps running.
- Bounded, so it cannot be flooded. `OP_COPY` rejects any single entry over 64 KiB (`copy.rs:27`) and the
  storage layer evicts the oldest entry when either the 16-entry depth or the 256 KiB total is exceeded, so
  a caller cannot grow the store without bound or exhaust the heap with one paste.
- No per-caller isolation. This is the honest boundary. The store is system-wide and the handlers do not
  check `sender_pid` against any notion of entry ownership; the sender pid is used only to address the
  reply (`runner.rs:50`). Any capsule that can reach port 4414 can `OP_PASTE`, `OP_HISTORY_LIST`, or
  `OP_HISTORY_GET` whatever another capsule copied, and can `OP_CLEAR` another capsule's content or shorten
  the retention window with `OP_SET_IDLE_TIMEOUT`. Reaching the port at all requires the IPC capability
  (`install.rs:50` stamps `Capability::IPC` on the endpoint), but there is no ownership check beyond that.
  Callers that handle secrets should treat the clipboard as a shared, world-readable channel among all
  IPC-capable capsules: clear it (`OP_CLEAR`) or keep the retention window short rather than relying on the
  store to keep one caller's data from another.
- No content interpretation. Bytes go in and come back unchanged; the content type is an opaque tag and the
  capsule never parses the payload, so there is no format-confusion or injection surface inside the service
  itself. Callers do their own validation (the editor checks UTF-8, the terminal filters to printable
  ASCII).

## How clients speak the wire

Clients do not build the frame by hand. They go through `nonos_app_skeleton`, which exposes `clipboard_copy`
and `clipboard_paste` ([`userland/app_skeleton/src/clients/clipboard/mod.rs:20`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/clients/clipboard/mod.rs#L20)).

`clipboard_copy` ([`.../copy.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../copy.rs#L25)) looks up the `clipboard` service with `lookup_port(b"clipboard")`
([`userland/app_skeleton/src/discover/lookup.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/discover/lookup.rs#L19), backed by `mk_service_lookup`), builds a payload of
`CONTENT_TYPE_TEXT = 1` plus the bytes, and sends `OP_COPY` through `call_status`
([`userland/app_skeleton/src/wire/call.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/wire/call.rs#L25), backed by `mk_ipc_call`). A nonzero status surfaces as
`"clipboard rejected copy"`, a missing service as `"clipboard not available"`.

`clipboard_paste` ([`.../paste.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../paste.rs#L26)) looks up the port the same way, sends `OP_PASTE` with the text
content type through `call_payload` ([`userland/app_skeleton/src/wire/call_payload.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/wire/call_payload.rs#L23)), reads the
`len: u32` after the status, and copies out the smaller of the reported length, the available bytes, and
the caller's buffer (`paste.rs:37`). An empty clipboard returns `Ok(0)`.

Two real capsules drive these helpers today. The text editor copies its buffer on Ctrl+C
([`userland/capsule_text_editor/src/editor/ctrl_copy.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_text_editor/src/editor/ctrl_copy.rs#L22)) and pastes on Ctrl+V, validating the pasted
bytes as UTF-8 before inserting ([`.../ctrl_paste.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../ctrl_paste.rs#L25)). The terminal copies the current line
([`userland/capsule_terminal/src/event/copy_line.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/capsule_terminal/src/event/copy_line.rs#L22)) and pastes into its input, keeping only printable
ASCII in the `0x20..=0x7E` range ([`.../paste_clipboard.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/.../paste_clipboard.rs#L30)). Both treat a clipboard error as a
non-fatal, best-effort outcome rather than a crash.

## Source map

```
  userland/capsule_clipboard/src/protocol/header.rs           magic 0x43424930 = CBI0, version 1, HDR_LEN 20
  userland/capsule_clipboard/src/protocol/ops.rs              the seven opcodes
  userland/capsule_clipboard/src/protocol/errno.rs            the typed errno table
  userland/capsule_clipboard/src/protocol/limits.rs           STATUS_LEN, IPC_PAYLOAD_MAX, the timeouts
  userland/capsule_clipboard/src/protocol/decode.rs           bounds-checked LE request parse
  userland/capsule_clipboard/src/protocol/encode.rs           reply header + status writers
  userland/capsule_clipboard/src/server/runner.rs             the port-4414 loop and idle GC
  userland/capsule_clipboard/src/server/respond.rs            status and payload reply builders
  userland/capsule_clipboard/src/server/handlers/router.rs    op dispatch and E_BAD_OP
  userland/capsule_clipboard/src/server/handlers/health.rs    liveness ping
  userland/capsule_clipboard/src/server/handlers/copy.rs      bounds check, then FIFO push
  userland/capsule_clipboard/src/server/handlers/paste.rs     latest-of-type recall
  userland/capsule_clipboard/src/server/handlers/history_list.rs   (content_type, len) pairs
  userland/capsule_clipboard/src/server/handlers/history_get.rs    entry by index
  userland/capsule_clipboard/src/server/handlers/clear.rs     wipe every entry
  userland/capsule_clipboard/src/server/handlers/set_idle_timeout.rs   idle bound 5s..24h, 0 disables
  userland/app_skeleton/src/clients/clipboard/                the clipboard_copy / clipboard_paste helpers
```

Every reference above is verified against those trees.
