---
title: "The Clipboard Capsule"
description: "The clipboard is a signed userland service that holds copied content behind an IPC port."
weight: 400
---
The clipboard is a signed userland service that holds copied content behind an IPC port. It keeps a
bounded history of copy entries, hands them back on paste, and wipes the whole store after a period of
inactivity. It never touches the screen, the disk, or a device: the only way in or out is a request on its
port, and the kernel never carries clipboard bytes itself. Any capsule that needs cut, copy, or paste
talks to it over IPC.

The source under `userland/capsule_clipboard/src/` is three top-level modules, and this documentation
mirrors that structure so a page can be read beside the folder it describes. `protocol/` is the wire and
the operation set, `server/` is the loop and the handlers, and `state/` is the store and the idle timer.

## Identity

| Field | Value | Source |
|-------|-------|--------|
| Slug | `clipboard` | `userland/capsule_clipboard/Capsule.mk:1` |
| Service handle | `clipboard` | `Capsule.mk:2` |
| Domain | `systems.nonos` | `Capsule.mk:3` |
| Namespace | `systems.nonos.clipboard` | `Capsule.mk:7` |
| Service endpoint | `service:4414:clipboard` | `Capsule.mk:8` |
| Reply endpoint | `reply:4415:endpoint.clipboard.reply` | `Capsule.mk:9` |
| Capability mask | `0x19` | `Capsule.mk:13` |

The mask decomposes into three bits, checked against [`src/capabilities/types.rs:56`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs#L56):

| Bit | Value | Grants |
|-----|-------|--------|
| CoreExec | `0x01` | run as a process |
| IPC | `0x08` | receive on its port and reply to callers |
| Memory | `0x10` | map its own heap for the store |

`0x01 | 0x08 | 0x10 = 0x19`. That is the minimum a service leaf needs: run, speak IPC, and hold a heap.
The clipboard holds no graphics, filesystem, network, driver, crypto, or debug capability of its own. The
kernel mirror asserts the same value (`REQUIRED_CAPS = 0x19`, [`src/userspace/capsule_clipboard/spawn.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_clipboard/spawn.rs#L35)),
and the Debug bit is deliberately absent so the capsule emits no `MkDebug` markers and no copied byte ever
reaches the serial log through it (`Capsule.mk:11`, `spawn.rs:51`). Compromising the clipboard yields the
clipboard's mask and nothing more.

Because the store is a single system-wide FIFO with no per-caller ownership, every IPC-capable capsule
that can reach port 4414 can read everything anyone else has copied since the last wipe. That boundary is
covered in full on the [operations and wire](/docs/userland/clipboard/protocol/) page under the security notes.

## The three pillars

Data flows in one direction: a request arrives on the port, `server/` parses it and dispatches, a handler
reads or mutates `state/`, and `server/` writes the reply. `protocol/` defines the shape of both ends.

```
  protocol/   <->   server/   <->   state/
  wire + ops        loop +          the store
  + errno           handlers        + idle timer
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [protocol.md](/docs/userland/clipboard/protocol/) | `src/protocol/` and `src/server/` | The 20-byte frame, the request parser and reply builders, the seven operations with opcode and reply layout, the errno table, and the server loop that ties them together. |
| [state.md](/docs/userland/clipboard/state/) | `src/state/` | The entry record, the bounded FIFO and its eviction policy, the content-type model, the byte and depth limits, and the idle wipe. |
| [contributing.md](/docs/userland/clipboard/contributing/) | the whole tree | Where the source lives, the module map, how to add an operation, the build and sign targets for the `clipboard` slug, and the code standards. |
| [debugging.md](/docs/userland/clipboard/debugging/) | runtime | The one spawn marker, why there are no runtime markers, and reading the wire status codes as the whole observable surface. |

## Lifecycle

The clipboard is spawned through verified spawn: `spawn_clipboard_capsule`
([`src/userspace/capsule_clipboard/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_clipboard/spawn.rs#L37)) decodes the baked trust anchor, then hands a
`CapsuleSpecVerified` to `spawn_verified`, which checks the signature and attestation, holds the requested
`0x19` mask against the manifest ceiling, and only then maps the embedded ELF. The install path registers
the service name `clipboard` on port 4414 and the reply inbox `endpoint.clipboard.reply` on port 4415, and
stamps `Capability::IPC` on the endpoint ([`src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs:50`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/kernel_core/process_spawn/capsule_spawn/runner/install/install.rs#L50)),
so a caller needs the IPC capability even to send to the port.

Inside the capsule, `_start` ([`src/main.rs:13`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L13)) initializes the userland heap through
`nonos_libc::heap_init` and exits with status `1` if that fails, otherwise it hands control to
`server::run` ([`src/server/runner.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/server/runner.rs#L27)), which never returns. The loop wipes the store if it has gone
idle, blocks on the port, dispatches one request, and replies. A successful spawn prints one line on the
boot log; the [debugging](/docs/userland/clipboard/debugging/) page covers what it means and why it is the only line.

## Source map

```
  userland/capsule_clipboard/src/main.rs                   _start, heap init, hand-off to server::run
  userland/capsule_clipboard/src/protocol/                 the wire: header, ops, limits, errno, decode, encode
  userland/capsule_clipboard/src/server/                   the port-4414 loop, respond builders, op handlers
  userland/capsule_clipboard/src/state/                    the entry record, the FIFO store, the idle timer
  userland/capsule_clipboard/Capsule.mk                    slug, endpoints 4414/4415, mask 0x19
  src/userspace/capsule_clipboard/spawn.rs                 kernel spawn spec, caps 0x19, ports 4414/4415
  src/kernel_core/process_spawn/capsule_spawn/runner/install/   endpoint registration + spawn log + trace
  src/capabilities/types.rs                                CoreExec | IPC | Memory bit values
  userland/app_skeleton/src/clients/clipboard/             the clipboard_copy / clipboard_paste helpers
```

Every reference above is verified against those trees.
