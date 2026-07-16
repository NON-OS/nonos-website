---
title: "Debugging capsule_clipboard"
description: "This page lists what the clipboard and its boot path emit, and the concrete failure modes with where to look for each."
weight: 4
---
This page lists what the clipboard and its boot path emit, and the concrete failure modes with where to
look for each. The clipboard is deliberately quiet: it emits no runtime markers of its own, so the whole
observable surface is one boot line and the typed status codes on the wire. For the operations and their
status codes see the [operations and wire](/docs/userland/clipboard/protocol/) page; for the store and the idle wipe see the
[state](/docs/userland/clipboard/state/) page.

## Log markers

The first thing to confirm is that the capsule ran. As it comes up, the kernel install path prints one
spawn line ([`src/kernel_core/process_spawn/capsule_spawn/runner/install/spawn_log.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/install/spawn_log.rs#L17)):

```
  [SPAWN] name=clipboard pid=0x... caps=0x19 entry=0x...
```

`caps=0x19` in that line confirms the capsule was admitted with exactly `CoreExec | IPC | Memory` and
nothing was added at load. If the line is absent the capsule never started, which is the usual signature,
manifest, or capability failure at verified spawn.

The clipboard is also one of the names the spawn tracer prints extra install-stage lines for
([`src/kernel_core/process_spawn/capsule_spawn/runner/install/trace.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/install/trace.rs#L17)), so a stall during its install
shows up as a `[SPAWN] clipboard ...` stage line, for example `[SPAWN] clipboard runqueue ok`
(`install.rs:55`), rather than silence.

There are no other markers. The mask has no Debug bit and the kernel spawn spec sets `debug_tag` to the
empty string ([`src/userspace/capsule_clipboard/spawn.rs:51`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_clipboard/spawn.rs#L51)), so the capsule emits no `MkDebug` output.
This is intentional: nothing about a copied secret reaches the serial log through this capsule. Do not go
looking for a `[CLIPBOARD]` line; there isn't one, and its absence is not a fault.

## Failure modes

Once up, the failure signatures are on the wire, not the console. Every one is a typed `i32` status the
client reads at offset 20 of the reply.

### A copy is rejected

A `COPY` of an entry over `MAX_ENTRY_BYTES = 64 KiB` returns `E_RANGE` (-34) and stores nothing
([`src/server/handlers/copy.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/copy.rs#L27)). A `COPY` with a payload under 4 bytes (no room for the content type)
returns `E_INVAL` (-22, `copy.rs:22`). Neither is a crash; the store is unchanged and the caller sees the
status.

### A paste comes back empty

`OP_PASTE` returns status `0` with no data when no entry of the requested content type exists
([`src/server/handlers/paste.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/paste.rs#L29)). An empty clipboard is a success, not an error, so a caller that finds
nothing after leaving the machine idle is seeing the idle wipe ([`src/state/clipboard/timer.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/clipboard/timer.rs#L26)), not a
failure. If a large entry does not fit the caller's reply buffer, paste returns `E_RANGE` (-34) and keeps
the entry (`paste.rs:34`); the fix is a bigger buffer on the client, not a retry.

### A bad frame

A header whose magic is not `0x43424930` returns `E_BAD_MAGIC` (-71), a version other than 1 returns
`E_BAD_VERSION` (-93), and a buffer shorter than the header or shorter than header-plus-declared-payload
returns `E_BAD_LEN` (-90). These come straight from the parser ([`src/protocol/decode.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/protocol/decode.rs#L19)) and point at
the client's frame encoder, not the store. An op outside 1..7 returns `E_BAD_OP` (-38,
[`src/server/handlers/router.rs:38`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/handlers/router.rs#L38)).

### The service is not there

If a client's `mk_service_lookup("clipboard")` (wrapped by `lookup_port`) returns a zero port or a zero
pid, the service never registered, which means the capsule failed to spawn. The client surfaces this as its
own `"clipboard not available"` ([`userland/app_skeleton/src/clients/clipboard/copy.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/clients/clipboard/copy.rs#L26)), not as an error
from the clipboard. Check the boot log for the `[SPAWN] name=clipboard` line; if it is missing, debug the
spawn, not the wire.

### History looks shorter than expected

The store is a bounded FIFO. `OP_COPY` evicts the oldest entry when either the 16-entry depth or the
256 KiB total is exceeded ([`src/state/clipboard/storage.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/state/clipboard/storage.rs#L24)), so an older entry can simply have been
evicted by newer copies. Separately, the idle wipe empties the whole history after the timeout. Neither is a
bug; `OP_HISTORY_LIST` reports the current shape without touching the timestamp, so it is the safe way to
inspect what is actually held.

## Source map

```
  src/kernel_core/process_spawn/capsule_spawn/runner/install/spawn_log.rs   the [SPAWN] name=clipboard line
  src/kernel_core/process_spawn/capsule_spawn/runner/install/trace.rs       clipboard install-stage lines
  src/userspace/capsule_clipboard/spawn.rs                                  debug_tag empty, caps 0x19
  userland/capsule_clipboard/src/protocol/decode.rs                        E_BAD_MAGIC / E_BAD_VERSION / E_BAD_LEN
  userland/capsule_clipboard/src/protocol/errno.rs                         the typed errno table
  userland/capsule_clipboard/src/server/handlers/copy.rs                   E_RANGE on oversized copy
  userland/capsule_clipboard/src/server/handlers/paste.rs                  empty paste is status 0
  userland/capsule_clipboard/src/state/clipboard/timer.rs                  the idle wipe
  userland/app_skeleton/src/clients/clipboard/copy.rs                      "clipboard not available"
```

Every reference above is verified against those trees.
