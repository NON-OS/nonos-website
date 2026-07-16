---
title: "The File Manager Capsule"
description: "The file manager is the desktop file browser in the NØNOS tree: a signed userland capsule that draws its own window, lists a directory, previews files, and performs the ordinary..."
weight: 400
---
The file manager is the desktop file browser in the NØNOS tree: a signed userland capsule that draws
its own window, lists a directory, previews files, and performs the ordinary create, rename, delete,
copy, move, duplicate, and permission operations. It does none of that itself. Every file operation is
a capability-checked IPC call to the `vfs_pool` service, which holds the real authority. The source is
one top-level module, `fm`, split one unit per file, and this documentation groups those units into the
concerns they form so a page can be read beside the folder it describes.

## Identity

| Field | Value | Source |
|-------|-------|--------|
| Slug | `file-manager` | `userland/capsule_file_manager/Capsule.mk:1` |
| Service handle | `app.file_manager` | `Capsule.mk:2`, [`src/userspace/capsule_file_manager/spawn.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_file_manager/spawn.rs#L31) |
| Namespace | `systems.nonos.app.file_manager` | `Capsule.mk:7` |
| Service endpoint | `service:4724:app.file_manager` | `Capsule.mk:8`, `spawn.rs:32` |
| Reply endpoint | `reply:4725:endpoint.app.file_manager.reply` | `Capsule.mk:9`, `spawn.rs:33` |
| Binary name | `file_manager` | `Capsule.mk:5` |
| Kernel mirror | `src/userspace/capsule_file_manager` | `Capsule.mk:12` |
| Capability mask | `0x1819` | `Capsule.mk:11` |

The mask `0x1819` decomposes into exactly five bits, checked against [`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs):

| Bit | Value | Grants |
|-----|-------|--------|
| CoreExec | `0x0001` | run as a process (`types.rs:56`) |
| IPC | `0x0008` | send and receive on its endpoints (`types.rs:59`) |
| Memory | `0x0010` | map its own heap and stack (`types.rs:60`) |
| GraphicsDisplayQuery | `0x0800` | ask the compositor for the display geometry (`types.rs:67`) |
| GraphicsSurfaceCreate | `0x1000` | create the window surface it draws into (`types.rs:68`) |

`0x1819 = 0x0001 + 0x0008 + 0x0010 + 0x0800 + 0x1000`. The kernel spawn path requests exactly those
five capabilities and no others ([`src/userspace/capsule_file_manager/spawn.rs:49`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_file_manager/spawn.rs#L49)). There is no Network
bit (`0x0004`), no FileSystem bit (`0x0040`), and no hardware, driver, MMIO, or DMA capability. The
capsule cannot read a block device, open a socket, or touch a device register on its own. Every action
that appears to touch a file is an IPC call to the `vfs_pool` service, which holds the real authority.

## The pillars

The source under `userland/capsule_file_manager/src/` is one module, `fm`, with `_start` handing
`FileManager::new` to the app skeleton's `run` ([`src/main.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/main.rs#L28)). The units group into five concerns.
An event comes in through the input layer, may run an action or open a prompt, both of which mutate the
model through the vfs, and the model is what the renderer draws. The preview is its own full-window
takeover.

```
  input     ->   actions    ->   listing    ->   rendering
  event_*        clipboard       refresh /       paint_* /
  routing        duplicate       entries /       layout /
                 perms /         view /          theme /
                 selection /     filter /        manifest /
                 prompt          sort            help
                                    |
                                 preview
                                 preview_*
```

| Page | Mirrors | What it covers |
|------|---------|----------------|
| [input.md](/docs/userland/file-manager/input/) | `event_dispatch.rs`, `event_mode.rs`, `event_modes.rs`, `event_browse.rs`, `event_actions.rs`, `event_mouse.rs`, `event_move.rs`, `event_open.rs`, `event_parent.rs`, `scroll.rs` | The event router, the mouse row select, the browse keys, navigation and opening, and the mode switches. |
| [actions.md](/docs/userland/file-manager/actions/) | `selection*.rs`, `clipboard.rs`, `clipboard_paste.rs`, `duplicate.rs`, `perms.rs`, `prompt*.rs` | The file operations: the checkbox selection and acting set, copy and cut, paste, in-place duplicate, the read-only toggle, and the name prompts (new file, mkdir, rename, delete). |
| [listing.md](/docs/userland/file-manager/listing/) | `state.rs`, `state_new.rs`, `entries.rs`, `refresh.rs`, `refresh_meta.rs`, `view*.rs`, `filter.rs`, `sort_*.rs` | The `State` model, the vfs directory refresh and per-file stat, and the filtered and sorted view. |
| [preview.md](/docs/userland/file-manager/preview/) | `preview.rs`, `preview_hex.rs`, `preview_text.rs`, `preview_is_binary.rs`, `preview_key.rs`, `preview_paint.rs`, `preview_clip.rs`, `preview_info.rs` | The file preview: reading a file through the vfs, the text and hexdump renderers, scrolling, and the truncation notice. |
| [rendering.md](/docs/userland/file-manager/rendering/) | `manifest.rs`, `paint.rs`, `paint_*.rs`, `layout.rs`, `theme.rs`, `help.rs`, plus the file-decoration units | The window manifest, the paint pass (title, header, rows, footer), the row geometry, the palette, and the help overlay. |
| [contributing.md](/docs/userland/file-manager/contributing/) | the whole tree | Where to work, how to add an action or a prompt, the build and sign steps, and the code standards. |
| [debugging.md](/docs/userland/file-manager/debugging/) | runtime | The boot marker, the status-line failure modes, and where to look when the listing, an action, or the preview misbehaves. |

The vfs client the actions and the listing call lives outside the capsule, in the app skeleton at
`userland/app_skeleton/src/clients/vfs/`; the opcodes it uses are named on both [actions.md](/docs/userland/file-manager/actions/)
and [listing.md](/docs/userland/file-manager/listing/) and defined in that client's `types.rs`.

## Lifecycle

The file manager is spawned through [verified spawn](https://github.com/NON-OS/nonos-micro-kernel/blob/main/security/capsules-and-trust.md): its
signature and attestation are checked, its requested capabilities are held against its manifest ceiling,
and only then is its ELF mapped ([`src/userspace/capsule_file_manager/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_file_manager/spawn.rs#L37)). It registers
`app.file_manager` at port 4724, and the skeleton `run` creates the window from the manifest and enters
the input-driven paint loop. `FileManager::new` does an initial `refresh` so the window shows the root
directory as soon as it appears ([`src/fm/app.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/fm/app.rs#L32)). A successful spawn prints
`[APP-FILE-MANAGER] capsule spawned` on the boot log
([`src/userspace/init/spawn_plan/apps.rs:101`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps.rs#L101)); the [debugging](/docs/userland/file-manager/debugging/) page covers the runtime
markers.

## Source map

Everything here is drawn from `userland/capsule_file_manager/` (the capsule source and its `Capsule.mk`),
[`src/capabilities/types.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/capabilities/types.rs) (the capability bits), the kernel spawn mirror under
`src/userspace/capsule_file_manager/`, and the shared vfs client under
`userland/app_skeleton/src/clients/vfs/`. Every reference above is verified against those trees.
