---
title: "File I/O, the path prompt, and the clipboard"
description: "This page covers everything the editor does that reaches outside the capsule: the control chords, the on-screen path prompt, the vfs load and save, the clipboard copy and paste,..."
weight: 2
---
This page covers everything the editor does that reaches outside the capsule: the control chords, the
on-screen path prompt, the vfs load and save, the clipboard copy and paste, and the best-effort save
notification to the desktop shell. The in-process editing and view are on the [editing](/docs/userland/text-editor/editing/) page.
For the capsule's identity and mask see the [README](/docs/userland/text-editor/).

It mirrors [`src/editor/on_ctrl.rs`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/on_ctrl.rs), `ctrl_open.rs`, `ctrl_save.rs`, `ctrl_copy.rs`, `ctrl_paste.rs`,
`path_prompt.rs`, `notify.rs`, and `resolve_owner_pid.rs`.

The editor holds no filesystem or clipboard authority of its own. Every action here is an outbound IPC
call to a service that does; the editor marshals the request and renders the reply. The vfs protocol is
documented under [../vfs/README.md](/docs/userland/vfs/).

## The control chords

A key with the Ctrl modifier is routed by `on_ctrl`. Both the upper and lower case code match, so a chord
works regardless of the reported case ([`src/editor/on_ctrl.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/on_ctrl.rs#L24)):

| Chord | Codes | Action | Source |
|-------|-------|--------|--------|
| Ctrl+O | `0x4F`, `0x6F` | open the path prompt for a load | `on_ctrl.rs:27`, `path_prompt.rs:23` |
| Ctrl+S | `0x53`, `0x73` | open the path prompt for a save | `on_ctrl.rs:28`, `path_prompt.rs:23` |
| Ctrl+C | `0x43`, `0x63` | copy the whole buffer to the clipboard | `on_ctrl.rs:26`, `ctrl_copy.rs:21` |
| Ctrl+V | `0x56`, `0x76` | paste clipboard text at the end of the buffer | `on_ctrl.rs:29`, `ctrl_paste.rs:22` |

An unrecognised Ctrl chord returns `Idle` and does nothing ([`src/editor/on_ctrl.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/on_ctrl.rs#L30)).

## The path prompt

Ctrl+O and Ctrl+S do not act immediately. Each calls `path_prompt::start`, which sets a pending
`PromptOp` (`Open` or `Save`) and a status line explaining the keys, then returns `Repaint`
([`src/editor/path_prompt.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/path_prompt.rs#L23)). While the prompt is pending, `on_event` routes every key to
`path_prompt::on_key` and nothing else runs ([`src/editor/event.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/event.rs#L29)).

The prompt is seeded with the current path, which starts at `/notes.txt` ([`src/editor/state.rs:18`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/state.rs#L18),
[`src/editor/state_new.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/state_new.rs#L21)). Inside the prompt ([`src/editor/path_prompt.rs:32`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/path_prompt.rs#L32)):

| Key | Action | Source |
|-----|--------|--------|
| ASCII graphic | append to the path, up to 255 bytes | `path_prompt.rs:51` |
| Backspace | delete the last path character | `path_prompt.rs:39` |
| Enter | clear the prompt and run the load (Open) or write (Save) against the typed path | `path_prompt.rs:44` |
| Esc | cancel the prompt; the status becomes `cancelled` | `path_prompt.rs:35` |

Only `char`s that are ASCII graphic are accepted, and only while the path is shorter than 255 bytes, so a
path cannot carry control bytes or grow without bound; a key carrying the Ctrl modifier is ignored inside
the prompt ([`src/editor/path_prompt.rs:52`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/path_prompt.rs#L52)). The path field is a fixed 256-byte array with its own length
([`src/editor/state.rs:34`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/state.rs#L34)).

## Open a file

On Enter for an `Open`, `ctrl_open` runs ([`src/editor/ctrl_open.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_open.rs#L23)):

1. Resolve the editor's own pid through `resolve_owner_pid`; a failure sets `open failed` and stops
   ([`src/editor/ctrl_open.rs:24`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_open.rs#L24)).
2. `vfs::stat` the path, and if the reported size exceeds the 16 KiB buffer, refuse with `file too large`
   ([`src/editor/ctrl_open.rs:29`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_open.rs#L29)).
3. `vfs::read_file` the path, capped at `CAPACITY` bytes. The bytes are accepted only if they are valid
   UTF-8 and fit the buffer; they are copied in, `len` is set, the status becomes `opened`, and the view
   scrolls to the end ([`src/editor/ctrl_open.rs:35`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_open.rs#L35)).
4. A non-UTF-8 body sets `file is not valid utf-8`; any client error sets `open failed`
   ([`src/editor/ctrl_open.rs:43`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_open.rs#L43)).

`vfs::read_file` opens the path, reads it in chunks advancing the server-side offset, and closes the
handle, returning the assembled bytes ([`userland/app_skeleton/src/clients/vfs/read_file.rs:27`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/clients/vfs/read_file.rs#L27)).
`vfs::stat` returns the size and a directory flag ([`userland/app_skeleton/src/clients/vfs/stat.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/clients/vfs/stat.rs#L22)).

## Save a file

On Enter for a `Save`, `ctrl_save` runs ([`src/editor/ctrl_save.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_save.rs#L22)):

1. Resolve the owner pid; a failure sets `save failed` and stops ([`src/editor/ctrl_save.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_save.rs#L23)).
2. `vfs::write_file` the used portion of the buffer to the path. On success the editor notifies the
   desktop shell and sets `saved`; on failure it sets `save failed` ([`src/editor/ctrl_save.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_save.rs#L28)).

`vfs::write_file` opens the path with create-and-truncate, writes the buffer one chunk at a time
advancing the fd position, and closes; an empty buffer over an `O_TRUNC` open writes nothing and succeeds
([`userland/app_skeleton/src/clients/vfs/write_file.rs:28`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/clients/vfs/write_file.rs#L28)).

Both open and save pass the editor's own pid, resolved once through the discovery client and cached, so
the vfs attributes the operation to this capsule and applies its own per-pid checks
([`src/editor/resolve_owner_pid.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/resolve_owner_pid.rs#L21)). `resolve_owner_pid` looks up `app.text_editor` and caches the
pid; a zero pid means the lookup failed ([`src/editor/resolve_owner_pid.rs:23`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/resolve_owner_pid.rs#L23)).

## Copy and paste

Copy and paste do not use the prompt.

Ctrl+C sends the whole used buffer to the clipboard and sets `copied /notes.txt` on success or
`clipboard unavailable` if the service did not answer ([`src/editor/ctrl_copy.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_copy.rs#L21)). The skeleton's
`clipboard_copy` looks up the `clipboard` port, prefixes a text content-type word, and sends `OP_COPY`,
returning an error on a non-zero status ([`userland/app_skeleton/src/clients/clipboard/copy.rs:25`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/clients/clipboard/copy.rs#L25)).

Ctrl+V pulls up to 512 bytes from the clipboard into a scratch buffer, and appends them only if they are
valid UTF-8 and `insert` accepts them (they fit the remaining buffer). A success sets
`pasted into /notes.txt` and scrolls to the end; content that is not UTF-8 or does not fit sets
`paste rejected`; a service failure sets `clipboard unavailable` ([`src/editor/ctrl_paste.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/ctrl_paste.rs#L22)). The
skeleton's `clipboard_paste` sends `OP_PASTE` and copies the returned text back into the caller's slice
([`userland/app_skeleton/src/clients/clipboard/paste.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/clients/clipboard/paste.rs#L26)).

The clipboard wire uses the `NCLP_MAGIC` fingerprint `0x4342_4930`, `OP_COPY` `0x0002`, and `OP_PASTE`
`0x0003` ([`userland/app_skeleton/src/wire/constants.rs:21`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/wire/constants.rs#L21),
[`userland/app_skeleton/src/clients/clipboard/copy.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/clients/clipboard/copy.rs#L22),
[`userland/app_skeleton/src/clients/clipboard/paste.rs:22`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/clients/clipboard/paste.rs#L22)).

## The save notification

After a successful save the editor tells the desktop shell so a toast can appear. `notify_saved` looks up
`desktop_shell` once and caches the port; if the shell is not registered the notify is skipped and the
save still stands ([`src/editor/notify.rs:30`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/notify.rs#L30)). When the port is known it builds a `saved <path>` string
bounded to 54 bytes and calls `send_notify` ([`src/editor/notify.rs:37`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/notify.rs#L37)).

`send_notify` frames an NDSH message: magic `0x4E44_5348`, version 1, `OP_NOTIFY` `0x0005`, a 20-byte
header, then a level-info word and a length-prefixed body of at most 128 bytes, and fires it with
`mk_ipc_send` ([`src/editor/notify.rs:44`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/notify.rs#L44)). The send is best-effort; its result is dropped and it never
blocks or fails the save ([`src/editor/notify.rs:54`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/notify.rs#L54)).

## Discovery

Every service the editor reaches is found by name through the skeleton's discovery client:
`lookup_service` resolves the editor's own pid for vfs and the shell peer for notify, and `lookup_port`
resolves the clipboard port inside the clipboard client ([`src/editor/resolve_owner_pid.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/resolve_owner_pid.rs#L17),
[`src/editor/notify.rs:17`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/src/editor/notify.rs#L17), [`userland/app_skeleton/src/clients/clipboard/copy.rs:26`](https://github.com/NON-OS/nonos-micro-kernel/blob/main/userland/app_skeleton/src/clients/clipboard/copy.rs#L26)). The editor names no
port numbers of its own for these calls; it asks the registry.

## Source map

```
  src/editor/on_ctrl.rs           the Ctrl chord router (O, S, C, V), case-insensitive
  src/editor/path_prompt.rs       the open/save path-prompt input mode
  src/editor/ctrl_open.rs         open a file through vfs::stat + vfs::read_file
  src/editor/ctrl_save.rs         save the buffer through vfs::write_file, then notify
  src/editor/ctrl_copy.rs         copy the buffer to the clipboard
  src/editor/ctrl_paste.rs        paste clipboard text into the buffer, UTF-8 and bounds checked
  src/editor/notify.rs            the best-effort NDSH save notification to desktop_shell
  src/editor/resolve_owner_pid.rs resolve and cache the editor's own pid for vfs calls
  src/editor/state.rs             the path field, prompt op, and cached ports
  userland/app_skeleton/src/clients/vfs/read_file.rs   the chunked vfs read
  userland/app_skeleton/src/clients/vfs/write_file.rs  the chunked vfs write
  userland/app_skeleton/src/clients/vfs/stat.rs        the vfs stat used to precheck size
  userland/app_skeleton/src/clients/clipboard/copy.rs  clipboard OP_COPY
  userland/app_skeleton/src/clients/clipboard/paste.rs clipboard OP_PASTE
  userland/app_skeleton/src/wire/constants.rs          NCLP_MAGIC
```

Every reference above is verified against those trees.
