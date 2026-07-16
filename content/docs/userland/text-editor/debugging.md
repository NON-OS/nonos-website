---
title: "Debugging capsule_text_editor"
description: "This page lists the boot marker the editor emits, the status-line vocabulary it uses to report each action, and the concrete failure modes with where to look for each."
weight: 4
---
This page lists the boot marker the editor emits, the status-line vocabulary it uses to report each
action, and the concrete failure modes with where to look for each. For the editor model see the
[README](/docs/userland/text-editor/), the [editing](/docs/userland/text-editor/editing/) page, and the [file-io](/docs/userland/text-editor/file-io/) page in this folder.

## The boot marker

The first thing to confirm is that the capsule ran. On a successful boot the kernel logs
`[APP-TEXT-EDITOR] capsule spawned`: the desktop-fleet plan calls `boot` with the tag `APP-TEXT-EDITOR`,
and the `Ok` arm calls `boot_log::ok(prefix, "capsule spawned")`
([`src/userspace/init/spawn_plan/apps_tools.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/spawn_plan/apps_tools.rs#L27), [`src/userspace/init/capsule_boot/run.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L29)). If that
line is absent the capsule never started, and the `Err` arm logged an error line instead
([`src/userspace/init/capsule_boot/run.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/init/capsule_boot/run.rs#L32)), which is the usual signature, manifest, or capability
failure surfaced at verified spawn ([`src/userspace/capsule_text_editor/spawn.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/userspace/capsule_text_editor/spawn.rs#L37)).

## The status line as a probe

The editor reports every action in its status line, drawn near the top of the window each frame
([`src/editor/paint.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/paint.rs#L36)). The status word tells you which stage ran and how it ended, so it is the
fastest diagnostic. The full vocabulary:

| Status | Meaning | Source |
|--------|---------|--------|
| `Ctrl-O open  Ctrl-S save  Ctrl-C copy  Ctrl-V paste` | the initial hint, no action yet | `state_new.rs:30` |
| `edited` | an edit changed the buffer | `event.rs:53` |
| `open path, Enter to load, Esc cancels` | the Open prompt is active | `path_prompt.rs:26` |
| `save path, Enter to write, Esc cancels` | the Save prompt is active | `path_prompt.rs:27` |
| `cancelled` | a prompt was dismissed with Esc | `path_prompt.rs:37` |
| `opened` | a file loaded successfully | `ctrl_open.rs:39` |
| `file too large` | the file exceeds the 16 KiB buffer | `ctrl_open.rs:31` |
| `file is not valid utf-8` | the file loaded but is not text | `ctrl_open.rs:43` |
| `open failed` | pid resolution or the vfs read failed | `ctrl_open.rs:25`, `ctrl_open.rs:44` |
| `saved` | a file wrote successfully | `ctrl_save.rs:32` |
| `save failed` | pid resolution or the vfs write failed | `ctrl_save.rs:24`, `ctrl_save.rs:32` |
| `copied /notes.txt` | the buffer went to the clipboard | `ctrl_copy.rs:23` |
| `pasted into /notes.txt` | clipboard text was appended | `ctrl_paste.rs:26` |
| `paste rejected` | clipboard content was not UTF-8 or did not fit | `ctrl_paste.rs:32` |
| `clipboard unavailable` | the clipboard service did not answer | `ctrl_copy.rs:25`, `ctrl_paste.rs:36` |

## Failure modes

### The editor opens but no key does anything

The window subscribes only to key-down, and `on_event` returns `Idle` for anything that is not a key-down
([`src/editor/manifest.rs:33`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/manifest.rs#L33), [`src/editor/event.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/event.rs#L26)). If keys are dead the editor never sees them, so
the suspect is the input path into the app (compositor, wm, input_router), not the editor. A single key
that seems ignored may instead be consumed by an open prompt: while a prompt is pending every key routes
to the prompt handler, so ordinary editing looks frozen until Enter or Esc clears it
([`src/editor/event.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/event.rs#L29)).

### Open fails

The status word names the stage. `open failed` means the editor could not resolve its own pid or the vfs
read errored ([`src/editor/ctrl_open.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_open.rs#L24), [`src/editor/ctrl_open.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_open.rs#L44)). `file too large` means the
`vfs::stat` size exceeded the 16 KiB buffer, so the read was never attempted
([`src/editor/ctrl_open.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_open.rs#L30)). `file is not valid utf-8` means the bytes loaded but are not text and were
refused before entering the buffer ([`src/editor/ctrl_open.rs:36`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_open.rs#L36), [`src/editor/ctrl_open.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_open.rs#L43)). Because
each is a distinct vfs op, a failing open next to a working save points at the specific op, not the
editor.

### Save fails

`save failed` is the same split: pid resolution or the `vfs::write_file` call
([`src/editor/ctrl_save.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_save.rs#L23), [`src/editor/ctrl_save.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_save.rs#L32)). The editor holds no filesystem authority of
its own, so a denial is the vfs service's decision for this pid, surfaced as a failed write, not a shell
error the editor invents.

### Copy or paste does nothing

`clipboard unavailable` means the clipboard service did not answer the copy or paste call
([`src/editor/ctrl_copy.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_copy.rs#L24), [`src/editor/ctrl_paste.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_paste.rs#L35)). `paste rejected` means the clipboard
returned content that was not valid UTF-8 or did not fit the remaining buffer, so nothing was appended
([`src/editor/ctrl_paste.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_paste.rs#L31)). Paste is capped at 512 bytes per press, so a very large clipboard is
truncated by design ([`src/editor/ctrl_paste.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_paste.rs#L23)).

### A save succeeds but no desktop notification appears

The notify is best-effort and is skipped when `desktop_shell` is not registered, so a missing toast is
expected without the shell and never blocks the save ([`src/editor/notify.rs:31`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/notify.rs#L31), [`src/editor/notify.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/notify.rs#L34)).
The send result is dropped, so a shell that is present but rejects the frame also leaves the save intact
([`src/editor/notify.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/notify.rs#L54)).

### Text looks clipped or wrapped oddly

Wrap columns and visible rows are recomputed from the surface on every paint and the wrap is clamped to
32..160 columns, so an unexpected wrap points at the reported surface size, not a layout bug
([`src/editor/layout.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/layout.rs#L21), [`src/editor/visible_rows.rs:19`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/visible_rows.rs#L19), [`src/editor/paint.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/paint.rs#L27)). A non-ASCII
character renders as `?` by design, so mojibake in the view is expected for multi-byte text, which is
still stored correctly and saved correctly ([`src/editor/paint.rs:55`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/paint.rs#L55)).

## Source map

```
  src/userspace/init/spawn_plan/apps_tools.rs   the APP-TEXT-EDITOR spawn entry
  src/userspace/init/capsule_boot/run.rs        the capsule-spawned / error boot markers
  src/userspace/capsule_text_editor/spawn.rs    the verified spawn that a boot failure comes from
  src/editor/event.rs         the key-down gate and the prompt takeover
  src/editor/ctrl_open.rs     the open stages and their status words
  src/editor/ctrl_save.rs     the save stages and their status words
  src/editor/ctrl_copy.rs     the copy status words
  src/editor/ctrl_paste.rs    the paste status words and the 512-byte cap
  src/editor/notify.rs        the best-effort save notification
  src/editor/paint.rs         the status line and the wrap that a display issue points at
  src/editor/state_new.rs     the initial status hint
  src/editor/path_prompt.rs   the prompt status words
```

Every reference above is verified against those trees.
